"""
Test Runner - Wrapper for Daytona test execution
"""

import os
import json
import base64
from typing import Optional, Dict, List
from dotenv import load_dotenv
from daytona import Daytona, DaytonaConfig

load_dotenv()


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
        self.sandbox = self.daytona.create()
        return self.sandbox
    
    def install_dependencies(self, packages: List[str] = None):
        """Install Python packages in the sandbox"""
        if packages is None:
            packages = ['pytest']
        
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
        return response.exit_code == 0
    
    def setup_environment(self, code_files: Dict[str, str], test_files: Dict[str, str]):
        """Setup the test environment with code and test files"""
        all_files = {**code_files, **test_files}
        files_json = json.dumps(all_files, ensure_ascii=False)
        files_b64 = base64.b64encode(files_json.encode('utf-8')).decode('ascii')
        
        setup_code = f"""import os
import json
import base64

files_data = json.loads(base64.b64decode('{files_b64}').decode('utf-8'))

created_count = 0
for file_path, content in files_data.items():
    dir_path = os.path.dirname(file_path) if os.path.dirname(file_path) else '.'
    if dir_path != '.':
        os.makedirs(dir_path, exist_ok=True)
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    created_count += 1

print(f"Created {{created_count}} file(s)")
"""
        
        response = self.sandbox.process.code_run(setup_code)
        return response.exit_code == 0
    
    def run_tests(self, test_command: str = "python -m pytest") -> Dict:
        """Run tests in the sandbox"""
        escaped_command = test_command.replace("'", "'\"'\"'")
        test_code = f"""import subprocess
import sys

try:
    result = subprocess.run(
        '{escaped_command}',
        shell=True,
        capture_output=True,
        text=True,
        timeout=300
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
        
        return {
            "exit_code": response.exit_code,
            "result": response.result
        }
    
    def cleanup(self):
        """Clean up the sandbox"""
        if self.sandbox:
            try:
                self.sandbox.delete()
            except Exception as e:
                pass  # Ignore cleanup errors
