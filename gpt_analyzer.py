"""
GPT Analyzer - Analyzes PRs and test results using GPT API
"""

import os
import json
from typing import Dict, List, Optional
from dotenv import load_dotenv
import openai

load_dotenv()


class GPTAnalyzer:
    """Analyzes PRs and test results using GPT API"""
    
    def __init__(self, api_key: Optional[str] = None):
        """Initialize GPT analyzer"""
        self.api_key = api_key or os.getenv('OPENAI_API_KEY')
        if not self.api_key:
            raise ValueError(
                "OpenAI API key is required. Set OPENAI_API_KEY in .env file or environment variable."
            )
        self.client = openai.OpenAI(api_key=self.api_key)
    
    def analyze_pr(
        self,
        pr_info: Dict,
        coderabbit_reviews: List[Dict],
        test_results: Optional[Dict],
        code_files: Dict[str, str]
    ) -> Dict:
        """
        Analyze PR and return risk assessment
        
        Returns:
            Dict with risk score, confidence, and review updates
        """
        
        # Build prompt
        prompt = self._build_analysis_prompt(
            pr_info, coderabbit_reviews, test_results, code_files
        )
        
        try:
            response = self.client.chat.completions.create(
                model="gpt-4",
                messages=[
                    {
                        "role": "system",
                        "content": "You are a security and code quality analyst. Analyze pull requests and provide risk assessments based on code type, test coverage, and Coderabbit reviews."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.3,
                response_format={"type": "json_object"}
            )
            
            result_text = response.choices[0].message.content
            analysis = json.loads(result_text)
            
            return analysis
        
        except Exception as e:
            # Return default analysis on error
            return {
                "risk": 50,
                "confidence": 0,
                "reasoning": f"Error in GPT analysis: {str(e)}"
            }
    
    def _build_analysis_prompt(
        self,
        pr_info: Dict,
        coderabbit_reviews: List[Dict],
        test_results: Optional[Dict],
        code_files: Dict[str, str]
    ) -> str:
        """Build the analysis prompt for GPT"""
        
        # Analyze code type
        code_type = self._analyze_code_type(code_files)
        
        # Count tests
        test_count = 0
        passed_tests = 0
        failed_tests = 0
        
        if test_results:
            output = test_results.get("output", "")
            # Try to extract test counts from pytest output
            if "passed" in output:
                import re
                passed_match = re.search(r'(\d+)\s+passed', output)
                if passed_match:
                    passed_tests = int(passed_match.group(1))
                    test_count += passed_tests
            
            if "failed" in output:
                import re
                failed_match = re.search(r'(\d+)\s+failed', output)
                if failed_match:
                    failed_tests = int(failed_match.group(1))
                    test_count += failed_tests
            
            test_count = passed_tests + failed_tests
        
        prompt = f"""Analyze this pull request and provide a risk assessment.

PR Information:
- Title: {pr_info.get('title', 'N/A')}
- Description: {pr_info.get('body', 'N/A')[:500]}
- Code Type: {code_type}

Coderabbit Reviews ({len(coderabbit_reviews)}):
{json.dumps(coderabbit_reviews, indent=2)}

Test Results:
- Status: {test_results.get('status', 'unknown') if test_results else 'no_tests'}
- Total Tests: {test_count}
- Passed: {passed_tests}
- Failed: {failed_tests}
- Output: {test_results.get('output', '')[:1000] if test_results else 'N/A'}

Code Files ({len(code_files)}):
{', '.join(list(code_files.keys())[:10])}

Provide a JSON response with the following structure:
{{
    "risk": <number 0-100>,
    "confidence": <number 0-100>,
    "reasoning": "<explanation>",
    "reviewUpdates": {{
        "<review_name>": {{
            "risk": <number 0-100>,
            "type": "<danger|warning|success|info>",
            "description": "<updated description>"
        }}
    }}
}}

IMPORTANT: The reviewUpdates should match the review names from the Coderabbit reviews provided above. Update each review with appropriate risk scores and descriptions based on your analysis.

Risk Assessment Guidelines:
- Critical (80-100): Authentication, database operations, payment processing, security-sensitive code
- High (60-79): API endpoints, data validation, file operations
- Medium (40-59): Business logic, utilities, helpers
- Low (0-39): UI changes, documentation, configuration

Confidence Guidelines:
- High (80-100): Many tests passed, comprehensive coverage
- Medium (50-79): Some tests passed, moderate coverage
- Low (0-49): Few/no tests passed, limited coverage

Analyze each Coderabbit review and update risk scores based on:
1. Code type (auth/DB = critical)
2. Test coverage (more passed = higher confidence)
3. Review severity (danger = high risk, warning = medium, success = low)
"""
        
        return prompt
    
    def _analyze_code_type(self, code_files: Dict[str, str]) -> str:
        """Analyze code type from file names and content"""
        file_names = ' '.join(code_files.keys()).lower()
        content_sample = ' '.join(list(code_files.values())[:3]).lower() if code_files else ''
        combined = file_names + ' ' + content_sample
        
        if any(keyword in combined for keyword in ['auth', 'login', 'token', 'password', 'session']):
            return "authentication"
        elif any(keyword in combined for keyword in ['db', 'database', 'sql', 'query', 'model']):
            return "database"
        elif any(keyword in combined for keyword in ['api', 'endpoint', 'route', 'handler']):
            return "api"
        elif any(keyword in combined for keyword in ['payment', 'stripe', 'paypal', 'billing']):
            return "payment"
        else:
            return "general"
