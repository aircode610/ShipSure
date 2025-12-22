# ShipSure Project Structure

## Overview

ShipSure is a comprehensive PR analysis tool that:
1. Fetches all PRs from a repository
2. Checks for Coderabbit reviews
3. Generates unit tests via Coderabbit
4. Runs tests in Daytona sandbox
5. Analyzes results with GPT for risk assessment
6. Outputs structured JSON results

## File Structure

```
ShipSure/
├── main.py                 # Main orchestrator script
├── pr_processor.py         # Processes individual PRs
├── test_runner.py          # Daytona test execution wrapper
├── gpt_analyzer.py         # GPT API integration for risk analysis
├── github_client.py        # GitHub API client
├── run_tests_daytona.py    # Detailed test runner (used by pr_processor)
├── example_usage.py        # Example script for manual PR processing
├── requirements.txt        # Python dependencies
├── .env                    # Environment variables (not in git)
├── .gitignore             # Git ignore rules
├── README.md              # Main documentation
└── output/                # Generated output (not in git)
    ├── results_*.json     # Analysis results
    └── logs/              # Log files
```

## Usage

### Basic Usage

```bash
# Analyze all open PRs
python main.py owner/repo

# Analyze with options
python main.py owner/repo --state all --max-prs 10
```

### Environment Setup

Create a `.env` file with:

```env
GITHUB_TOKEN=your_github_token_here
DAYTONA_API_KEY=your_daytona_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
```

## Workflow

1. **Fetch PRs**: Gets all PRs from the repository
2. **For each PR**:
   - Extract Coderabbit reviews
   - Trigger unit test generation
   - Wait for Coderabbit to create test PR
   - Run tests in Daytona sandbox
   - Analyze with GPT API
3. **Output**: Saves JSON results to `output/` directory

## Output Format

Results are saved as JSON with the following structure:

```json
{
  "repository": "owner/repo",
  "processedAt": "2024-01-01T12:00:00",
  "pullRequests": [
    {
      "id": 42,
      "title": "Fix auth bypass in login",
      "link": "https://github.com/org/repo/pull/42",
      "risk": 85,
      "coderabbitReviews": [
        {
          "name": "SQL Injection check",
          "type": "danger",
          "risk": 85,
          "description": "Unsafe query construction detected"
        }
      ],
      "generatedTests": [
        {
          "test": "Expired Token Validation",
          "reason": "Auth expiry path lacks coverage"
        }
      ],
      "testResults": {
        "status": "passed",
        "exitCode": 0,
        "output": "..."
      }
    }
  ]
}
```

## Modules

### main.py
- Entry point
- Parses command-line arguments
- Orchestrates the entire workflow
- Handles logging and output

### pr_processor.py
- Processes individual PRs
- Coordinates Coderabbit, Daytona, and GPT
- Extracts review information
- Formats results

### test_runner.py
- Wraps Daytona API
- Manages sandbox lifecycle
- Handles test execution

### gpt_analyzer.py
- Integrates with OpenAI API
- Analyzes code type and risk
- Provides risk scores and confidence

### github_client.py
- GitHub API interactions
- PR fetching and management
- Coderabbit review detection

## Logging

All operations are logged to:
- Console (stdout)
- File: `output/logs/shipSure_YYYYMMDD_HHMMSS.log`

## Error Handling

- Individual PR failures don't stop the entire process
- Errors are logged and included in output JSON
- Sandbox cleanup is always attempted
