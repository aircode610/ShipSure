# Coderabbit Unit Test Generator Trigger

This program allows you to trigger Coderabbit's "Create PR with unit tests" feature via the GitHub API.

## Features

- Fetches PR information from GitHub
- Checks if the PR has an existing Coderabbit review
- Triggers unit test generation by posting a comment to the PR

## Prerequisites

1. **Python 3.7+** installed
2. **GitHub Personal Access Token** with the following permissions:
   - `repo` (for private repos) or `public_repo` (for public repos)
   - `read:org` (if accessing organization repos)

   Get your token from: https://github.com/settings/tokens

## Installation

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Set your GitHub token. You can do this in one of three ways:

   **Option 1: Using .env file (Recommended)**
   
   Create a `.env` file in the project root and add your token:
   ```
   GITHUB_TOKEN=your_token_here
   ```
   
   Example `.env` file:
   ```env
   # GitHub Personal Access Token
   # Get your token from: https://github.com/settings/tokens
   GITHUB_TOKEN=ghp_your_actual_token_here
   ```
   
   The `.env` file is automatically loaded by the scripts and is ignored by git for security.

   **Option 2: Environment variable**
   ```bash
   # Windows (PowerShell)
   $env:GITHUB_TOKEN="your_token_here"
   
   # Windows (CMD)
   set GITHUB_TOKEN=your_token_here
   
   # Linux/Mac
   export GITHUB_TOKEN="your_token_here"
   ```

   **Option 3: Command-line argument (CLI only)**
   ```bash
   python trigger_coderabbit_tests_cli.py owner repo 123 --token your_token_here
   ```

## Usage

### Interactive Mode

Run the interactive program:
```bash
python trigger_coderabbit_tests.py
```

The program will prompt you for:
1. Repository owner (username or organization)
2. Repository name
3. PR number

Example:
```
Enter repository owner (username or organization): octocat
Enter repository name: Hello-World
Enter PR number: 123
```

### Command-Line Mode

For automation and scripting, use the CLI version:
```bash
python trigger_coderabbit_tests_cli.py <owner> <repo> <pr_number> [options]
```

Examples:
```bash
# Basic usage
python trigger_coderabbit_tests_cli.py octocat Hello-World 123

# With explicit token
python trigger_coderabbit_tests_cli.py owner repo 456 --token ghp_xxxxx

# Skip Coderabbit review check
python trigger_coderabbit_tests_cli.py owner repo 789 --skip-check

# Quiet mode (only outputs comment URL)
python trigger_coderabbit_tests_cli.py owner repo 123 --quiet
```

Options:
- `--token TOKEN`: GitHub personal access token (overrides .env file and GITHUB_TOKEN env var)
- `--skip-check`: Skip checking for existing Coderabbit review
- `--quiet, -q`: Suppress non-error output (useful for scripting)

**Note:** The token is loaded in this priority order:
1. Command-line `--token` argument (CLI only)
2. Environment variable `GITHUB_TOKEN`
3. `.env` file `GITHUB_TOKEN` value

## How It Works

1. The program fetches the PR information from GitHub
2. It checks for existing Coderabbit reviews/comments
3. It posts a comment `@coderabbitai generate unit tests` to trigger the unit test generation
4. Coderabbit will process the request and generate unit tests according to your configuration

## Coderabbit Configuration

To customize unit test generation, create a `.coderabbit.yaml` file in your repository root:

```yaml
code_generation:
  unit_tests:
    path_instructions:
      - path: "**/*.ts"
        instructions: |
          Use vitest for testing framework.
          Generate comprehensive test cases including edge cases and error conditions.
          Do not omit the imports; the test file must be valid.
```

## Notes

- This feature requires Coderabbit Pro plan
- The unit tests can be generated in:
  - A separate pull request
  - The same PR as a new commit
  - As a comment with copyable code
- Coderabbit will analyze your code and GitHub checks to ensure tests pass

## Error Handling

The program handles:
- Missing GitHub token
- Invalid PR information
- API errors
- Network issues

## License

MIT
