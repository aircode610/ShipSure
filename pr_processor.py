"""
PR Processor - Handles processing of individual PRs
"""

import os
import logging
import time
import re
from typing import Dict, Optional
from github_client import GitHubAPIClient
from test_runner import TestRunner
from gpt_analyzer import GPTAnalyzer


class PRProcessor:
    """Processes individual PRs through the full workflow"""
    
    def __init__(
        self,
        github_client: GitHubAPIClient,
        test_runner: Optional[TestRunner],
        gpt_analyzer: Optional[GPTAnalyzer],
        logger: logging.Logger
    ):
        self.github_client = github_client
        self.test_runner = test_runner
        self.gpt_analyzer = gpt_analyzer
        self.logger = logger
    
    def process_pr(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        skip_tests: bool = False,
        skip_gpt: bool = False
    ) -> Dict:
        """Process a single PR through the full workflow"""
        
        # Get PR info
        pr_info = self.github_client.get_pr_info(owner, repo, pr_number)
        
        result = {
            "id": pr_number,
            "title": pr_info.get('title', 'N/A'),
            "link": pr_info.get('html_url', ''),
            "risk": 0,
            "coderabbitReviews": [],
            "generatedTests": [],
            "testResults": None
        }
        
        # Step 1: Check for Coderabbit reviews
        self.logger.info("Checking for Coderabbit reviews...")
        has_review = self.github_client.check_coderabbit_review(owner, repo, pr_number)
        
        if has_review:
            coderabbit_comments = self.github_client.get_coderabbit_comments(owner, repo, pr_number)
            self.logger.info(f"Found {len(coderabbit_comments)} Coderabbit comment(s)")
            
            # Extract review information from comments
            for comment in coderabbit_comments:
                review_info = self._extract_review_info(comment)
                if review_info:
                    result["coderabbitReviews"].append(review_info)
        
        # Step 2: Generate unit tests (if not skipped)
        if not skip_tests and self.test_runner:
            self.logger.info("Triggering unit test generation...")
            try:
                comment = self.github_client.trigger_unit_test_generation(owner, repo, pr_number)
                self.logger.info(f"Unit test generation triggered: {comment.get('html_url')}")
                
                # Wait a bit for Coderabbit to process
                self.logger.info("Waiting for Coderabbit to generate tests...")
                time.sleep(10)  # Wait 10 seconds
                
                # Find test PR
                test_pr = self.github_client.find_coderabbit_test_pr(owner, repo, pr_number)
                
                if test_pr:
                    test_pr_number = test_pr['number']
                    self.logger.info(f"Found test PR #{test_pr_number}")
                    
                    # Step 3: Run tests in Daytona
                    test_results = self._run_tests_in_daytona(
                        owner, repo, pr_number, test_pr_number
                    )
                    
                    result["testResults"] = test_results
                    result["generatedTests"] = test_results.get("generatedTests", [])
                else:
                    self.logger.warning("Test PR not found yet, may need more time")
            
            except Exception as e:
                self.logger.error(f"Error in test generation/execution: {e}", exc_info=True)
                result["testError"] = str(e)
        
        # Step 4: GPT Analysis (if not skipped)
        if not skip_gpt and self.gpt_analyzer:
            self.logger.info("Analyzing with GPT...")
            try:
                analysis = self.gpt_analyzer.analyze_pr(
                    pr_info=pr_info,
                    coderabbit_reviews=result["coderabbitReviews"],
                    test_results=result.get("testResults"),
                    code_files=self._get_pr_files(owner, repo, pr_number)
                )
                
                result["risk"] = analysis.get("risk", 0)
                
                # Update reviews with GPT analysis
                for review in result["coderabbitReviews"]:
                    if review.get("name") in analysis.get("reviewUpdates", {}):
                        review.update(analysis["reviewUpdates"][review["name"]])
            
            except Exception as e:
                self.logger.error(f"Error in GPT analysis: {e}", exc_info=True)
                result["gptError"] = str(e)
        
        return result
    
    def _extract_review_info(self, comment: Dict) -> Optional[Dict]:
        """Extract review information from Coderabbit comment"""
        body = comment.get('body', '')
        user = comment.get('user', {}).get('login', '')
        
        if 'coderabbit' not in user.lower():
            return None
        
        # Try to extract review name from markdown headers or first line
        import re
        name = "Coderabbit Review"
        
        # Look for markdown headers
        header_match = re.search(r'^##\s+(.+)$', body, re.MULTILINE)
        if header_match:
            name = header_match.group(1).strip()
        else:
            # Look for bold text at start
            bold_match = re.search(r'\*\*(.+?)\*\*', body)
            if bold_match:
                name = bold_match.group(1).strip()
        
        # Clean up name
        name = re.sub(r'[^\w\s-]', '', name)[:50]  # Remove special chars, limit length
        
        # Determine type and risk
        body_lower = body.lower()
        review_type = "info"
        risk = 0
        
        # Check for danger indicators
        if any(keyword in body_lower for keyword in [
            'error', 'bug', 'security', 'vulnerability', 'injection', 
            'sql injection', 'xss', 'csrf', 'authentication', 'authorization'
        ]):
            review_type = "danger"
            risk = 85  # Default high risk for security issues
        elif any(keyword in body_lower for keyword in [
            'warning', 'suggestion', 'improvement', 'potential', 'consider'
        ]):
            review_type = "warning"
            risk = 55  # Default medium risk for warnings
        elif any(keyword in body_lower for keyword in [
            'good', 'approved', 'passed', 'success', 'build', 'lint'
        ]):
            review_type = "success"
            risk = 0  # No risk for passed checks
        
        # Adjust risk based on severity keywords
        if 'critical' in body_lower or 'major' in body_lower:
            risk = max(risk, 90)
        elif 'minor' in body_lower:
            risk = min(risk, 40)
        
        # Clean description (remove markdown, limit length)
        description = body
        # Remove markdown code blocks
        description = re.sub(r'```[\s\S]*?```', '', description)
        # Remove HTML comments
        description = re.sub(r'<!--[\s\S]*?-->', '', description)
        # Limit length
        description = description.strip()[:300] + "..." if len(description) > 300 else description.strip()
        
        review_info = {
            "name": name or "Coderabbit Review",
            "type": review_type,
            "risk": risk,
            "description": description
        }
        
        return review_info
    
    def _run_tests_in_daytona(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        test_pr_number: int
    ) -> Dict:
        """Run tests in Daytona sandbox"""
        from run_tests_daytona import (
            prepare_files_from_pr,
            parse_imports_from_test_files,
            fetch_source_files_from_imports,
            detect_test_command
        )
        
        result = {
            "status": "unknown",
            "exitCode": None,
            "output": "",
            "generatedTests": []
        }
        
        try:
            # Get code files from original PR
            code_files = prepare_files_from_pr(
                self.github_client, owner, repo, pr_number, fetch_all=True
            )
            
            # Get test files from test PR
            test_files = prepare_files_from_pr(
                self.github_client, owner, repo, test_pr_number
            )
            
            if not test_files:
                result["status"] = "no_tests"
                return result
            
            # Parse imports and fetch source files
            imported_modules = parse_imports_from_test_files(test_files)
            if imported_modules:
                source_files = fetch_source_files_from_imports(
                    self.github_client, owner, repo, pr_number,
                    imported_modules, code_files
                )
                code_files.update(source_files)
            
            # Create sandbox and run tests
            self.test_runner.create_sandbox()
            
            try:
                self.test_runner.setup_environment(code_files, test_files)
                self.test_runner.install_dependencies()
                
                test_command = detect_test_command({**code_files, **test_files})
                test_result = self.test_runner.run_tests(test_command)
                
                result["status"] = "passed" if test_result["exit_code"] == 0 else "failed"
                result["exitCode"] = test_result["exit_code"]
                result["output"] = test_result["result"]
                
                # Extract generated test names from test files
                for file_path, content in test_files.items():
                    if 'test' in file_path.lower() and file_path.endswith('.py'):
                        # Try to extract test function names
                        import re
                        test_functions = re.findall(r'def\s+(test_\w+)', content)
                        for test_func in test_functions:
                            result["generatedTests"].append({
                                "test": test_func.replace('_', ' ').title(),
                                "reason": "Generated by Coderabbit based on code analysis"
                            })
                        
                        # If no test functions found, use filename
                        if not test_functions:
                            test_name = os.path.basename(file_path).replace('_', ' ').replace('.py', '').title()
                            result["generatedTests"].append({
                                "test": test_name,
                                "reason": "Generated by Coderabbit"
                            })
            
            finally:
                self.test_runner.cleanup()
        
        except Exception as e:
            self.logger.error(f"Error running tests: {e}", exc_info=True)
            result["status"] = "error"
            result["error"] = str(e)
        
        return result
    
    def _get_pr_files(self, owner: str, repo: str, pr_number: int) -> Dict:
        """Get PR files for GPT analysis"""
        from run_tests_daytona import prepare_files_from_pr
        return prepare_files_from_pr(
            self.github_client, owner, repo, pr_number, fetch_all=True
        )
