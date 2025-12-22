"""
Script to run tests in Daytona container.
Fetches code changes from PR and tests from Coderabbit-generated PR,
then runs them in a Daytona sandbox.
"""

import os
import sys
import json
import base64
import re
import ast
from typing import Optional, Dict, List, Set
from dotenv import load_dotenv
import requests
from daytona import Daytona, DaytonaConfig

# Load environment variables from .env file
load_dotenv()

from github_client import GitHubAPIClient


class TestRunner:
    """Manages test execution in Daytona"""
    
    def __init__(self, api_key: Optional[str] = None):
        """Initialize Daytona test runner"""
        self.api_key = api_key or os.getenv('DAYTONA_API_KEY')
        if not self.api_key:
            raise ValueError(
                "Daytona API key is required. Set DAYTONA_API_KEY in .env file or environment variable. "
                "Get key from: https://app.daytona.io/"
            )
        config = DaytonaConfig(api_key=self.api_key)
        self.daytona = Daytona(config)
        self.sandbox = None
    
    def create_sandbox(self):
        """Create a new Daytona sandbox"""
        print("Creating Daytona sandbox...")
        self.sandbox = self.daytona.create()
        print(f"✓ Sandbox created: {self.sandbox.id if hasattr(self.sandbox, 'id') else 'N/A'}")
        return self.sandbox
    
    def install_dependencies(self, packages: List[str] = None):
        """
        Install Python packages in the sandbox.
        
        Args:
            packages: List of package names to install (default: ['pytest'])
        """
        if packages is None:
            packages = ['pytest']
        
        print(f"\nInstalling dependencies: {', '.join(packages)}...")
        
        install_code = f"""import subprocess
import sys

packages = {packages}
for package in packages:
    try:
        result = subprocess.run(
            [sys.executable, '-m', 'pip', 'install', package],
            capture_output=True,
            text=True,
            timeout=120
        )
        if result.returncode == 0:
            print(f"✓ Installed {{package}}")
        else:
            print(f"⚠ Failed to install {{package}}: {{result.stderr}}", file=sys.stderr)
    except Exception as e:
        print(f"⚠ Error installing {{package}}: {{e}}", file=sys.stderr)
"""
        
        response = self.sandbox.process.code_run(install_code)
        if response.exit_code != 0:
            print(f"  ⚠ Installation warning: {response.result}")
        else:
            print(f"  ✓ Dependencies installed")
            if response.result:
                print(f"  {response.result}")
    
    def setup_environment(self, code_files: Dict[str, str], test_files: Dict[str, str]):
        """
        Setup the test environment with code and test files.
        
        Args:
            code_files: Dict mapping file paths to file contents
            test_files: Dict mapping file paths to test file contents
        """
        print("\nSetting up test environment...")
        
        # Combine all files
        all_files = {**code_files, **test_files}
        
        # Create Python script to set up files
        # We'll encode the files as JSON and decode them in the sandbox
        # Use ensure_ascii=False to preserve unicode characters
        files_json = json.dumps(all_files, ensure_ascii=False)
        files_b64 = base64.b64encode(files_json.encode('utf-8')).decode('ascii')
        
        setup_code = f"""import os
import json
import base64

# Decode files data
files_data = json.loads(base64.b64decode('{files_b64}').decode('utf-8'))

# Create directories and write files
created_count = 0
for file_path, content in files_data.items():
    # Ensure directory exists
    dir_path = os.path.dirname(file_path) if os.path.dirname(file_path) else '.'
    if dir_path != '.':
        os.makedirs(dir_path, exist_ok=True)
    
    # Write file content
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    created_count += 1

print(f"Created {{created_count}} file(s)")
"""
        
        # Run setup in sandbox
        print("  Uploading files...")
        response = self.sandbox.process.code_run(setup_code)
        if response.exit_code != 0:
            print(f"  ⚠ Setup warning: {response.result}")
        else:
            print(f"  ✓ Files uploaded: {response.result.strip() if response.result else 'Success'}")
    
    def run_tests(self, test_command: str = "python -m pytest") -> Dict:
        """
        Run tests in the sandbox.
        
        Args:
            test_command: Command to run tests (default: pytest)
        
        Returns:
            Dict with exit_code and result
        """
        print(f"\nRunning tests: {test_command}")
        
        # Execute shell command using Python subprocess
        # Escape single quotes in the command
        escaped_command = test_command.replace("'", "'\"'\"'")
        test_code = f"""import subprocess
import sys

try:
    result = subprocess.run(
        '{escaped_command}',
        shell=True,
        capture_output=True,
        text=True,
        timeout=300  # 5 minute timeout
    )
    print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    sys.exit(result.returncode)
except subprocess.TimeoutExpired:
    print("Test execution timed out after 5 minutes", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"Error running tests: {{e}}", file=sys.stderr)
    sys.exit(1)
"""
        
        response = self.sandbox.process.code_run(test_code)
        
        result = {
            "exit_code": response.exit_code,
            "result": response.result
        }
        
        if response.exit_code == 0:
            print("✓ Tests passed!")
        else:
            print(f"✗ Tests failed with exit code {response.exit_code}")
        
        return result
    
    def cleanup(self):
        """Clean up the sandbox"""
        if self.sandbox:
            print("\nCleaning up sandbox...")
            try:
                self.sandbox.delete()
                print("✓ Sandbox deleted")
            except Exception as e:
                print(f"⚠ Error deleting sandbox: {e}")


def prepare_files_from_pr(client: GitHubAPIClient, owner: str, repo: str, pr_number: int, fetch_all: bool = False) -> Dict[str, str]:
    """
    Prepare files from a PR.
    
    Args:
        client: GitHub API client
        owner: Repository owner
        repo: Repository name
        pr_number: PR number
        fetch_all: If True, fetch all Python files from PR branch, not just changed ones
    
    Returns:
        Dict mapping file paths to file contents
    """
    print(f"\nFetching files from PR #{pr_number}...")
    pr_info = client.get_pr_info(owner, repo, pr_number)
    head_sha = pr_info['head']['sha']
    head_ref = pr_info['head']['ref']
    
    files = {}
    
    if fetch_all:
        # Fetch all Python files from the PR branch using GitHub API
        # This requires getting the tree recursively
        print("  Fetching all Python files from PR branch...")
        try:
            # Get all files from the PR's head branch
            # We'll use the GitHub API to get the tree
            import requests
            url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{head_sha}?recursive=1"
            headers = client.headers
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            tree_data = response.json()
            
            # Filter for Python files
            for item in tree_data.get('tree', []):
                file_path = item['path']
                if file_path.endswith('.py') and 'test' not in file_path.lower():
                    try:
                        content = client.get_file_content(owner, repo, file_path, ref=head_sha)
                        files[file_path] = content
                        print(f"  ✓ {file_path}")
                    except Exception as e:
                        print(f"  ⚠ Could not fetch {file_path}: {e}")
        except Exception as e:
            print(f"  ⚠ Could not fetch all files: {e}, falling back to changed files only")
            fetch_all = False
    
    if not fetch_all:
        # Only get changed files
        pr_files = client.get_pr_files(owner, repo, pr_number)
        for file_info in pr_files:
            file_path = file_info['filename']
            status = file_info['status']
            
            # Only get added or modified files (skip deleted)
            if status in ['added', 'modified']:
                try:
                    content = client.get_file_content(owner, repo, file_path, ref=head_sha)
                    files[file_path] = content
                    print(f"  ✓ {file_path} ({status})")
                except Exception as e:
                    print(f"  ⚠ Could not fetch {file_path}: {e}")
    
    return files


def display_fetched_files(files: Dict[str, str], file_type: str = "Files"):
    """
    Display the contents of fetched files.
    
    Args:
        files: Dict mapping file paths to file contents
        file_type: Type label for the files (e.g., "Test Files", "Code Files")
    """
    if not files:
        return
    
    print(f"\n{'=' * 60}")
    print(f"{file_type} Fetched from PR")
    print("=" * 60)
    
    for file_path, content in files.items():
        print(f"\n📄 {file_path}")
        print("-" * 60)
        
        # Show first 50 lines or full content if less
        lines = content.split('\n')
        if len(lines) > 50:
            preview = '\n'.join(lines[:50])
            print(preview)
            print(f"\n... ({len(lines) - 50} more lines)")
        else:
            print(content)
        
        print("-" * 60)
    
    print(f"\nTotal: {len(files)} file(s)")
    print("=" * 60)


def parse_imports_from_test_files(test_files: Dict[str, str]) -> Set[str]:
    """
    Parse import statements from test files to find source modules.
    
    Args:
        test_files: Dict mapping file paths to test file contents
    
    Returns:
        Set of module/package names (including package paths like 'app.auth')
    """
    imported_modules = set()
    
    for file_path, content in test_files.items():
        if not file_path.endswith('.py'):
            continue
        
        try:
            # Parse the Python file to extract imports
            tree = ast.parse(content, filename=file_path)
            
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        # Add full module path and first part
                        module_name = alias.name
                        imported_modules.add(module_name)
                        # Also add first part for directory matching
                        if '.' in module_name:
                            imported_modules.add(module_name.split('.')[0])
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        # Add full module path and first part
                        imported_modules.add(node.module)
                        if '.' in node.module:
                            imported_modules.add(node.module.split('.')[0])
        except SyntaxError:
            # If parsing fails, try regex as fallback
            # Match: import module, from module import ...
            import_pattern = r'^(?:from\s+)?([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)'
            for line in content.split('\n'):
                match = re.match(import_pattern, line.strip())
                if match:
                    module = match.group(1)
                    imported_modules.add(module)
                    if '.' in module:
                        imported_modules.add(module.split('.')[0])
    
    return imported_modules


def fetch_source_files_from_imports(
    client: GitHubAPIClient,
    owner: str,
    repo: str,
    pr_number: int,
    imported_modules: Set[str],
    existing_files: Dict[str, str]
) -> Dict[str, str]:
    """
    Fetch source files from PR based on imported module names.
    Fetches ALL files from the PR branch (not just changed ones) to find matching modules.
    
    Args:
        client: GitHub API client
        owner: Repository owner
        repo: Repository name
        pr_number: PR number (the original PR with source code)
        imported_modules: Set of module/package names to look for
        existing_files: Already fetched files (to avoid duplicates)
    
    Returns:
        Dict mapping file paths to file contents
    """
    if not imported_modules:
        return {}
    
    print(f"\nFetching source files from original PR #{pr_number} based on imports: {', '.join(sorted(imported_modules))}...")
    
    pr_info = client.get_pr_info(owner, repo, pr_number)
    head_sha = pr_info['head']['sha']
    
    source_files = {}
    matched_modules = set()
    
    # Filter out standard library modules
    filtered_modules = {m for m in imported_modules 
                       if m not in ['sys', 'os', 'json', 'base64', 'subprocess', 'unittest', 'pytest', 'typing', 're', 'ast', 'collections', 'datetime', 'time', 'random', 'math']}
    
    if not filtered_modules:
        return {}
    
    # Fetch ALL files from the PR branch (not just changed ones)
    print("  Fetching all Python files from original PR branch...")
    try:
        # Get all files from the PR's head branch using tree API
        url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{head_sha}?recursive=1"
        headers = client.headers
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        tree_data = response.json()
        
        # Filter for Python files that match imports
        for item in tree_data.get('tree', []):
            file_path = item['path']
            
            # Skip if already fetched
            if file_path in existing_files or file_path in source_files:
                continue
            
            # Skip test files
            if 'test' in file_path.lower() or file_path.endswith('_test.py') or file_path.endswith('tests.py'):
                continue
            
            # Only process Python files
            if not file_path.endswith('.py'):
                continue
            
            # Check if file matches any imported module
            file_name = os.path.basename(file_path)
            file_name_no_ext = os.path.splitext(file_name)[0]
            path_parts = file_path.replace('\\', '/').split('/')
            
            for module in filtered_modules:
                # Match exact filename (e.g., module.py for import module)
                if file_name_no_ext == module or file_name == f"{module}.py":
                    try:
                        content = client.get_file_content(owner, repo, file_path, ref=head_sha)
                        source_files[file_path] = content
                        matched_modules.add(module)
                        print(f"  ✓ {file_path} (matched import: {module})")
                        break
                    except Exception as e:
                        print(f"  ⚠ Could not fetch {file_path}: {e}")
                
                # Match package directory (e.g., app/ for import app or from app.auth)
                elif module in path_parts:
                    # Check if file is in a directory that matches the module
                    # e.g., app/auth.py matches 'app' or 'app.auth'
                    try:
                        content = client.get_file_content(owner, repo, file_path, ref=head_sha)
                        source_files[file_path] = content
                        matched_modules.add(module)
                        print(f"  ✓ {file_path} (matched package: {module})")
                        break
                    except Exception as e:
                        print(f"  ⚠ Could not fetch {file_path}: {e}")
    
    except Exception as e:
        print(f"  ⚠ Could not fetch all files from PR branch: {e}")
        print("  Falling back to changed files only...")
        # Fallback to changed files only
        pr_files = client.get_pr_files(owner, repo, pr_number)
        for file_info in pr_files:
            file_path = file_info['filename']
            
            if file_path in existing_files or file_path in source_files:
                continue
            
            if 'test' in file_path.lower():
                continue
            
            if not file_path.endswith('.py'):
                continue
            
            file_name = os.path.basename(file_path)
            file_name_no_ext = os.path.splitext(file_name)[0]
            path_parts = file_path.replace('\\', '/').split('/')
            
            for module in filtered_modules:
                if file_name_no_ext == module or file_name == f"{module}.py" or module in path_parts:
                    try:
                        content = client.get_file_content(owner, repo, file_path, ref=head_sha)
                        source_files[file_path] = content
                        print(f"  ✓ {file_path} (matched: {module})")
                        break
                    except Exception as e:
                        print(f"  ⚠ Could not fetch {file_path}: {e}")
    
    return source_files


def detect_test_command(files: Dict[str, str]) -> str:
    """Detect the appropriate test command based on files"""
    # Check for common test frameworks
    test_files = [f for f in files.keys() if 'test' in f.lower() or 'spec' in f.lower()]
    
    if any(f.endswith('.py') for f in test_files):
        # Check for pytest
        if any('pytest' in files.get(f, '') or 'import pytest' in files.get(f, '') for f in test_files):
            return "python -m pytest"
        # Check for unittest
        elif any('unittest' in files.get(f, '') or 'import unittest' in files.get(f, '') for f in test_files):
            return "python -m unittest discover"
        else:
            return "python -m pytest"  # Default to pytest
    
    elif any(f.endswith('.js') or f.endswith('.ts') for f in test_files):
        return "npm test"
    
    elif any(f.endswith('.java') for f in test_files):
        return "mvn test"
    
    else:
        return "python -m pytest"  # Default


def main():
    """Main function"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Run tests in Daytona container using PR code and Coderabbit-generated tests"
    )
    parser.add_argument('owner', help='Repository owner')
    parser.add_argument('repo', help='Repository name')
    parser.add_argument('pr_number', type=int, help='Original PR number')
    parser.add_argument('--test-pr', type=int, help='Test PR number (if not provided, will search for Coderabbit PR)')
    parser.add_argument('--test-command', help='Command to run tests (auto-detected if not provided)')
    parser.add_argument('--keep-sandbox', action='store_true', help='Keep sandbox after tests (for debugging)')
    parser.add_argument('--show-code-files', action='store_true', help='Also display code files fetched from original PR')
    
    args = parser.parse_args()
    
    try:
        # Initialize clients
        print("=" * 60)
        print("Daytona Test Runner")
        print("=" * 60)
        
        github_client = GitHubAPIClient()
        test_runner = TestRunner()
        
        # Get code files from original PR (fetch all Python files, not just changed ones)
        code_files = prepare_files_from_pr(
            github_client, args.owner, args.repo, args.pr_number, fetch_all=True
        )
        
        if not code_files:
            print("⚠ No code files found in PR")
            return
        
        # Display fetched code files if requested
        if args.show_code_files:
            display_fetched_files(code_files, "Code Files")
        
        # Find or use test PR
        if args.test_pr:
            print(f"\nUsing specified test PR #{args.test_pr}")
            test_pr_number = args.test_pr
        else:
            print("\nSearching for Coderabbit test PR...")
            test_pr = github_client.find_coderabbit_test_pr(
                args.owner, args.repo, args.pr_number
            )
            if test_pr:
                test_pr_number = test_pr['number']
                print(f"✓ Found test PR #{test_pr_number}: {test_pr.get('title', 'N/A')}")
            else:
                print("⚠ No Coderabbit test PR found. Please specify --test-pr")
                return
        
        # Get test files from test PR
        test_files = prepare_files_from_pr(
            github_client, args.owner, args.repo, test_pr_number
        )
        
        if not test_files:
            print("⚠ No test files found in test PR")
            return
        
        # Display fetched test files
        display_fetched_files(test_files, "Test Files")
        
        # Parse imports from test files and fetch corresponding source files
        imported_modules = parse_imports_from_test_files(test_files)
        if imported_modules:
            source_files_from_imports = fetch_source_files_from_imports(
                github_client, args.owner, args.repo, args.pr_number,
                imported_modules, code_files
            )
            # Merge with existing code files
            code_files.update(source_files_from_imports)
            if source_files_from_imports:
                print(f"\n✓ Added {len(source_files_from_imports)} source file(s) based on test imports")
        
        # Create sandbox
        test_runner.create_sandbox()
        
        try:
            # Setup environment
            test_runner.setup_environment(code_files, test_files)
            
            # Install dependencies (pytest, etc.)
            test_runner.install_dependencies()
            
            # Detect test command if not provided
            test_command = args.test_command
            if not test_command:
                test_command = detect_test_command({**code_files, **test_files})
                print(f"\nDetected test command: {test_command}")
            
            # Run tests
            result = test_runner.run_tests(test_command)
            
            # Print results
            print("\n" + "=" * 60)
            print("Test Results")
            print("=" * 60)
            print(result['result'])
            print("=" * 60)
            
            if result['exit_code'] != 0:
                sys.exit(result['exit_code'])
        
        finally:
            # Cleanup
            if not args.keep_sandbox:
                test_runner.cleanup()
            else:
                print("\n⚠ Sandbox kept (use --keep-sandbox=false to auto-delete)")
    
    except ValueError as e:
        print(f"\n❌ Error: {e}", file=sys.stderr)
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        print(f"\n❌ GitHub API Error: {e}", file=sys.stderr)
        if hasattr(e.response, 'text'):
            print(f"   Details: {e.response.text}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
