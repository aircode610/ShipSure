# Quick Start Guide

## 1. Setup

```bash
# Install dependencies
pip install -r requirements.txt

# Create .env file
echo "GITHUB_TOKEN=your_token" > .env
echo "DAYTONA_API_KEY=your_key" >> .env
echo "OPENAI_API_KEY=your_key" >> .env
```

## 2. Run Analysis

```bash
python main.py owner/repo
```

Example:
```bash
python main.py aircode610/startup
```

Wait for the analysis to complete. Results will be saved to `output/results_*.json`

## 3. Start Frontend Server

```bash
python server.py
```

## 4. View Dashboard

Open your browser:
```
http://localhost:5000
```

The dashboard will automatically load and display your PR analysis results!

## Tips

- Use `--max-prs 5` to test with fewer PRs first
- Use `--skip-tests` to skip test execution (faster, GPT only)
- Check `output/logs/` for detailed operation logs
- Results are saved with timestamps, so you can run multiple analyses
