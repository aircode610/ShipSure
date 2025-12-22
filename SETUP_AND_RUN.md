# Complete Setup and Run Guide

## Prerequisites

1. **Python 3.7+** installed
2. **Get API Keys**:
   - GitHub: https://github.com/settings/tokens
   - Daytona: https://app.daytona.io/
   - OpenAI: https://platform.openai.com/api-keys

## Step-by-Step Setup

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Create `.env` File

Create a file named `.env` in the project root:

```env
GITHUB_TOKEN=ghp_your_github_token_here
DAYTONA_API_KEY=your_daytona_api_key_here
OPENAI_API_KEY=sk-your_openai_api_key_here
```

### 3. Run Analysis

```bash
python main.py owner/repo
```

**Example**:
```bash
python main.py aircode610/startup
```

**Options**:
- `--state open|closed|all` - PR state to analyze (default: open)
- `--max-prs N` - Limit number of PRs to process
- `--skip-tests` - Skip test generation/execution
- `--skip-gpt` - Skip GPT analysis
- `--output-dir DIR` - Custom output directory

**What happens**:
1. Fetches all PRs from the repository
2. For each PR:
   - Checks for Coderabbit reviews
   - Triggers unit test generation
   - Waits for Coderabbit to create test PR
   - Runs tests in Daytona sandbox
   - Analyzes with GPT API
3. Saves results to `output/results_YYYYMMDD_HHMMSS.json`
4. Saves logs to `output/logs/shipSure_YYYYMMDD_HHMMSS.log`

### 4. Start Frontend Server

In a **new terminal**:

```bash
python server.py
```

You should see:
```
============================================================
ShipSure Frontend Server
============================================================

Serving frontend at: http://localhost:5000
API endpoint: http://localhost:5000/api/pull-requests

Results directory: C:\Users\YRC\Desktop\ShipSure\output
Latest results: results_20251219_213440.json

Press Ctrl+C to stop the server
============================================================
```

### 5. View Dashboard

Open your browser and go to:
```
http://localhost:5000
```

The dashboard will automatically:
- Load the latest results JSON file
- Display all PRs with risk scores
- Show Coderabbit reviews
- Display generated tests
- Allow filtering and sorting

## Frontend Features

- **Filter**: Show only high-risk PRs
- **Sort**: By risk, errors, warnings, or confidence
- **Expand**: Click any PR to see details
- **Auto-expand**: High-risk PRs are automatically expanded

## Troubleshooting

### "No results found" in frontend
- Make sure you ran `python main.py owner/repo` first
- Check that `output/results_*.json` files exist
- Verify the server is reading from the correct directory

### Import errors
- Run `pip install -r requirements.txt` again
- Make sure you're in a virtual environment (recommended)
- Check Python version: `python --version` (should be 3.7+)

### API errors
- Verify all API keys are correct in `.env`
- Check API quotas/limits
- Review error messages in `output/logs/`

### Tests not running
- Verify Daytona API key is valid
- Check that Coderabbit has generated test PRs
- Review test output in logs

## File Structure

```
ShipSure/
├── main.py              # Run analysis: python main.py owner/repo
├── server.py            # Start frontend: python server.py
├── output/              # Generated files
│   ├── results_*.json   # Analysis results
│   └── logs/            # Operation logs
└── front-end/           # Frontend dashboard
    ├── index.html
    └── app.js
```

## Quick Test

To test with minimal PRs:

```bash
# Analyze only 2 PRs
python main.py owner/repo --max-prs 2

# Start server
python server.py

# Open http://localhost:5000
```

## Next Steps

- Review results in the dashboard
- Check logs for detailed information
- Export JSON results for further analysis
- Run analysis on different repositories
