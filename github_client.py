"""
GitHub API client for interacting with GitHub repositories and PRs.
"""

import os
import requests
from typing import Optional, Dict, List
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


class GitHubAPIClient:
    """Client for interacting with GitHub API"""
    
    def __init__(self, token: Optional[str] = None):
        """
        Initialize GitHub API client.
        
        Args:
            token: GitHub personal access token. If None, tries to get from GITHUB_TOKEN env var
                   or .env file.
        """
        self.token = token or os.getenv('GITHUB_TOKEN')
        if not self.token:
            raise ValueError(
                "GitHub token is required. Set GITHUB_TOKEN in .env file, environment variable "
                "or pass token parameter. Get token from: https://github.com/settings/tokens"
            )
        self.base_url = "https://api.github.com"
        self.headers = {
            "Authorization": f"token {self.token}",
            "Accept": "application/vnd.github.v3+json",
            "X-GitHub-Api-Version": "2022-11-28"
        }
    
    def get_pr_info(self, owner: str, repo: str, pr_number: int) -> Dict:
        """Fetch PR information from GitHub"""
        url = f"{self.base_url}/repos/{owner}/{repo}/pulls/{pr_number}"
        response = requests.get(url, headers=self.headers)
        response.raise_for_status()
        return response.json()
    
    def get_pr_comments(self, owner: str, repo: str, pr_number: int) -> List[Dict]:
        """Get all comments on a PR"""
        url = f"{self.base_url}/repos/{owner}/{repo}/pulls/{pr_number}/comments"
        response = requests.get(url, headers=self.headers)
        response.raise_for_status()
        return response.json()
    
    def get_pr_issue_comments(self, owner: str, repo: str, pr_number: int) -> List[Dict]:
        """Get all issue comments on a PR (includes review comments)"""
        url = f"{self.base_url}/repos/{owner}/{repo}/issues/{pr_number}/comments"
        response = requests.get(url, headers=self.headers)
        response.raise_for_status()
        return response.json()
    
    def get_pr_reviews(self, owner: str, repo: str, pr_number: int) -> List[Dict]:
        """Get all reviews on a PR"""
        url = f"{self.base_url}/repos/{owner}/{repo}/pulls/{pr_number}/reviews"
        response = requests.get(url, headers=self.headers)
        response.raise_for_status()
        return response.json()
    
    def check_coderabbit_review(self, owner: str, repo: str, pr_number: int) -> bool:
        """
        Check if PR has a Coderabbit review.
        
        Coderabbit typically:
        - Posts comments as 'coderabbitai' or 'coderabbit[bot]'
        - Creates reviews
        """
        # Check comments
        comments = self.get_pr_issue_comments(owner, repo, pr_number)
        for comment in comments:
            user = comment.get('user', {}).get('login', '').lower()
            if 'coderabbit' in user:
                return True
        
        # Check review comments
        review_comments = self.get_pr_comments(owner, repo, pr_number)
        for comment in review_comments:
            user = comment.get('user', {}).get('login', '').lower()
            if 'coderabbit' in user:
                return True
        
        # Check reviews
        reviews = self.get_pr_reviews(owner, repo, pr_number)
        for review in reviews:
            user = review.get('user', {}).get('login', '').lower()
            if 'coderabbit' in user:
                return True
        
        return False
    
    def trigger_unit_test_generation(self, owner: str, repo: str, pr_number: int) -> Dict:
        """
        Trigger Coderabbit unit test generation by posting a comment.
        
        According to Coderabbit docs, posting '@coderabbitai generate unit tests'
        triggers the unit test generation feature.
        """
        url = f"{self.base_url}/repos/{owner}/{repo}/issues/{pr_number}/comments"
        payload = {
            "body": "@coderabbitai generate unit tests"
        }
        response = requests.post(url, headers=self.headers, json=payload)
        response.raise_for_status()
        return response.json()
    
    def get_coderabbit_comments(self, owner: str, repo: str, pr_number: int) -> List[Dict]:
        """Get all Coderabbit-related comments on the PR"""
        coderabbit_comments = []
        
        # Check issue comments
        comments = self.get_pr_issue_comments(owner, repo, pr_number)
        for comment in comments:
            user = comment.get('user', {}).get('login', '').lower()
            if 'coderabbit' in user:
                coderabbit_comments.append(comment)
        
        # Check review comments
        review_comments = self.get_pr_comments(owner, repo, pr_number)
        for comment in review_comments:
            user = comment.get('user', {}).get('login', '').lower()
            if 'coderabbit' in user:
                coderabbit_comments.append(comment)
        
        return coderabbit_comments
    
    def get_pr_files(self, owner: str, repo: str, pr_number: int) -> List[Dict]:
        """Get list of files changed in a PR"""
        url = f"{self.base_url}/repos/{owner}/{repo}/pulls/{pr_number}/files"
        response = requests.get(url, headers=self.headers)
        response.raise_for_status()
        return response.json()
    
    def get_file_content(self, owner: str, repo: str, path: str, ref: str = "main") -> str:
        """Get file content from repository"""
        url = f"{self.base_url}/repos/{owner}/{repo}/contents/{path}"
        params = {"ref": ref}
        response = requests.get(url, headers=self.headers, params=params)
        response.raise_for_status()
        content_data = response.json()
        
        # Decode base64 content
        import base64
        content = base64.b64decode(content_data['content']).decode('utf-8')
        return content
    
    def list_prs(self, owner: str, repo: str, state: str = "open", head: Optional[str] = None) -> List[Dict]:
        """List pull requests"""
        url = f"{self.base_url}/repos/{owner}/{repo}/pulls"
        params = {"state": state}
        if head:
            params["head"] = head
        response = requests.get(url, headers=self.headers, params=params)
        response.raise_for_status()
        return response.json()
    
    def find_coderabbit_test_pr(self, owner: str, repo: str, original_pr_number: int) -> Optional[Dict]:
        """
        Find the Coderabbit-generated test PR.
        Coderabbit typically creates PRs with titles like:
        - "Add unit tests for PR #X"
        - "Unit tests for PR #X"
        - "Generated unit tests"
        """
        # Get original PR info to find the branch
        original_pr = self.get_pr_info(owner, repo, original_pr_number)
        
        # Search for PRs that might be test PRs
        # Check open PRs first
        prs = self.list_prs(owner, repo, state="open")
        
        for pr in prs:
            title = pr.get('title', '').lower()
            body = pr.get('body', '').lower()
            pr_number = pr.get('number')
            
            # Skip the original PR
            if pr_number == original_pr_number:
                continue
            
            # Check if it's a Coderabbit test PR
            if any(keyword in title or keyword in body for keyword in [
                'unit test',
                'test for pr',
                'generated test',
                'coderabbit',
                f'pr #{original_pr_number}',
                f'pr {original_pr_number}'
            ]):
                # Check if it's created by Coderabbit
                user = pr.get('user', {}).get('login', '').lower()
                if 'coderabbit' in user or 'bot' in user:
                    return pr
        
        # Also check closed PRs
        prs = self.list_prs(owner, repo, state="closed")
        for pr in prs[:10]:  # Check recent closed PRs
            title = pr.get('title', '').lower()
            body = pr.get('body', '').lower()
            pr_number = pr.get('number')
            
            if pr_number == original_pr_number:
                continue
            
            if any(keyword in title or keyword in body for keyword in [
                'unit test',
                'test for pr',
                'generated test',
                'coderabbit',
                f'pr #{original_pr_number}',
                f'pr {original_pr_number}'
            ]):
                user = pr.get('user', {}).get('login', '').lower()
                if 'coderabbit' in user or 'bot' in user:
                    return pr
        
        return None
