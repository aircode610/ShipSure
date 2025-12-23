# ShipSure - PR Risk Intelligence
# 1- Analyzing
![Alt Text for Screen Readers](https://github.com/danialeyz/ShipSure/blob/main/analyzing.png)

# 2- Loaded PRs
![Alt Text for Screen Readers](https://github.com/danialeyz/ShipSure/blob/main/loaded.png)

# 3- Analysis Example 
![Alt Text for Screen Readers](https://github.com/danialeyz/ShipSure/blob/main/example.png)

ShipSure is an AI-powered pull request risk analysis tool that automatically analyzes GitHub pull requests, generates unit tests using CodeRabbit, runs them in Daytona sandboxes, and provides comprehensive risk assessments using GPT.

## Features

- 🔍 **Repository & PR Selection**: Search and select repositories, then choose PRs to analyze
- 🤖 **Automated Test Generation**: Requests CodeRabbit to generate unit tests for selected PRs
- 🧪 **Test Execution**: Runs generated tests in isolated Daytona sandboxes
- 🧠 **AI Risk Analysis**: Uses GPT to analyze code, tests, and reviews for comprehensive risk assessment
- 📊 **Risk Categories**: Provides detailed risk breakdown across Security, Performance, Maintainability, Reliability, and Compatibility
- ⚠️ **Specific Risk Identification**: Identifies and categorizes specific risks with severity levels and recommendations
- 🎨 **Beautiful UI**: Modern, cyber-themed interface with real-time progress tracking

## Prerequisites

- Python 3.8+
- GitHub Personal Access Token (with repo access)
- Daytona API Key
- OpenAI API Key

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd ShipSure
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

## Running the Application

1. Start the server:
```bash
python server.py
```

2. Open your browser and navigate to:
```
http://localhost:5000
```
Or if you are using Live server extension for running front end:
```
http://localhost:5500
```

3. In the web interface:
   - Enter your **GitHub Token** and click **Load Repos**
   - Search and select a repository
   - Select the pull requests you want to analyze
   - Enter your **Daytona API Key** and **OpenAI API Key**
   - Click **Analyze**

## How It Works

1. **Repository Selection**: Fetches all repositories accessible with your GitHub token
2. **PR Selection**: Lists all open pull requests for the selected repository
3. **Test Generation**: Requests CodeRabbit to generate unit tests for selected PRs
4. **Test Execution**: Waits for CodeRabbit to create test PRs (polls every minute for up to 15 minutes)
5. **Daytona Testing**: Runs the generated tests in isolated Daytona sandboxes
6. **AI Analysis**: Analyzes code, test results, and CodeRabbit reviews using GPT
7. **Results Display**: Shows comprehensive risk analysis with categories, specific risks, and recommendations

## Project Structure

```
ShipSure/
├── backend/           # Backend Python modules
│   ├── github_client.py      # GitHub API client
│   ├── gpt_analyzer.py       # GPT risk analysis
│   ├── pr_processor.py       # PR processing logic
│   ├── test_runner.py        # Daytona test execution
│   └── run_tests_daytona.py  # Test file preparation
├── frontend/          # Frontend web application
│   ├── index.html     # Main HTML
│   ├── app.js         # Frontend logic
│   └── app.css        # Styling
├── server.py          # Flask server
└── requirements.txt   # Python dependencies
```

## API Endpoints

- `GET /api/repos?token=<github_token>` - Fetch user repositories
- `GET /api/repos/<owner>/<repo>/prs?token=<github_token>` - Fetch PRs for a repository
- `POST /api/analyze` - Start analysis (returns jobId)
- `GET /api/analyze/<jobId>/status` - Get analysis status
- `GET /api/analyze/<jobId>/results` - Get analysis results

## Notes

- The analysis process can take 10-15 minutes as it waits for CodeRabbit to generate tests
- Test generation requests are deduplicated - if a test PR already exists or a request was already made, it won't create duplicates
- Results are saved to the `output/` directory
- The application uses async processing - you can monitor progress in real-time

## License

[Add your license here]
