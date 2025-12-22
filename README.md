# ShipSure - PR Risk Analysis Tool

ShipSure analyzes pull requests, generates tests, runs them in secure sandboxes, and provides AI-powered risk assessments.

## Features

- 🔍 Fetches all PRs from a repository
- 🤖 Detects Coderabbit reviews automatically
- 🧪 Triggers unit test generation via Coderabbit
- 🏃 Runs tests in Daytona sandbox containers
- 🧠 GPT-powered risk analysis based on code type and test coverage
- 📊 Beautiful frontend dashboard to visualize results
- 📝 Complete logging of all operations

## Prerequisites

1. **Python 3.7+** installed
2. **API Keys** (add to `.env` file):
   - `GITHUB_TOKEN` - GitHub Personal Access Token
   - `DAYTONA_API_KEY` - Daytona API Key
   - `OPENAI_API_KEY` - OpenAI API Key

## Installation

1. **Clone/Download** this repository

2. **Install dependencies**:
```bash
pip install -r requirements.txt
```

3. **Create `.env` file** in the project root:
```env
GITHUB_TOKEN=your_github_token_here
DAYTONA_API_KEY=your_daytona_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
```

## Usage

### Step 1: Run Analysis

Analyze PRs in a repository:

```bash
# Analyze all open PRs
python main.py owner/repo

# Analyze closed PRs
python main.py owner/repo --state closed

# Analyze all PRs (open + closed)
python main.py owner/repo --state all

# Limit number of PRs
python main.py owner/repo --max-prs 10

# Skip test execution (GPT analysis only)
python main.py owner/repo --skip-tests

# Skip GPT analysis (tests only)
python main.py owner/repo --skip-gpt
```

**Example**:
```bash
python main.py aircode610/startup
```

This will:
1. Fetch all PRs from the repository
2. For each PR:
   - Check for Coderabbit reviews
   - Trigger unit test generation
   - Run tests in Daytona
   - Analyze with GPT for risk assessment
3. Save results to `output/results_YYYYMMDD_HHMMSS.json`
4. Save logs to `output/logs/shipSure_YYYYMMDD_HHMMSS.log`

### Step 2: View Results in Frontend

Start the web server:

```bash
python server.py
```

Then open your browser to:
```
http://localhost:5000
```

The frontend will automatically load the latest results and display them in an interactive dashboard.

## Output Format

Results are saved as JSON with this structure:

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

## Project Structure

```
ShipSure/
├── main.py              # Main orchestrator
├── server.py            # Flask server for frontend
├── pr_processor.py      # PR processing logic
├── test_runner.py       # Daytona test execution
├── gpt_analyzer.py     # GPT risk analysis
├── github_client.py    # GitHub API client
├── run_tests_daytona.py # Detailed test runner
├── front-end/          # Frontend dashboard
│   ├── index.html
│   └── app.js
├── output/             # Generated results (auto-created)
│   ├── results_*.json
│   └── logs/
└── .env                # API keys (create this)
```

## How It Works

1. **PR Fetching**: Gets all PRs from the repository
2. **Coderabbit Detection**: Checks for existing Coderabbit reviews
3. **Test Generation**: Triggers `@coderabbitai generate unit tests` comment
4. **Test Execution**: 
   - Fetches code and test files from PRs
   - Creates Daytona sandbox
   - Installs dependencies (pytest, etc.)
   - Runs tests and captures output
5. **Risk Analysis**: 
   - Analyzes code type (auth/DB = critical)
   - Evaluates test coverage
   - Calculates risk scores (0-100)
   - Determines confidence levels
6. **Visualization**: Frontend displays results with filtering and sorting

## Risk Assessment

- **Critical (80-100)**: Authentication, database operations, payment processing
- **High (60-79)**: API endpoints, data validation, file operations
- **Medium (40-59)**: Business logic, utilities, helpers
- **Low (0-39)**: UI changes, documentation, configuration

## Troubleshooting

### No results in frontend
- Make sure you've run `python main.py owner/repo` first
- Check that `output/results_*.json` files exist
- Check server logs for errors

### Tests failing
- Ensure Daytona API key is valid
- Check that pytest is installing correctly
- Review test output in logs

### GPT analysis errors
- Verify OpenAI API key is set
- Check API quota/limits
- Review error messages in logs

## License

MIT
