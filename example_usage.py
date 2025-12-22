"""
Example script showing how to use the GitHubAPIClient programmatically.
"""

import os
from dotenv import load_dotenv
from github_client import GitHubAPIClient

# Load environment variables from .env file
load_dotenv()


def example_usage():
    """Example of using the client programmatically"""
    
    # Initialize client
    client = GitHubAPIClient()
    
    # Define PR information
    owner = "aircode610"
    repo = "startup"
    pr_number = 3
    
    # Fetch PR info
    print(f"Fetching PR #{pr_number}...")
    pr_data = client.get_pr_info(owner, repo, pr_number)
    print(f"PR Title: {pr_data.get('title')}")
    print(f"PR URL: {pr_data.get('html_url')}")
    
    # Check for Coderabbit review
    print("\nChecking for Coderabbit review...")
    has_review = client.check_coderabbit_review(owner, repo, pr_number)
    print(f"Has Coderabbit review: {has_review}")
    
    if has_review:
        # Get Coderabbit comments
        comments = client.get_coderabbit_comments(owner, repo, pr_number)
        print(f"Found {len(comments)} Coderabbit comment(s)")
    
    # Trigger unit test generation
    print("\nTriggering unit test generation...")
    comment = client.trigger_unit_test_generation(owner, repo, pr_number)
    print(f"Comment posted: {comment.get('html_url')}")


if __name__ == "__main__":
    # Make sure GITHUB_TOKEN is set
    if not os.getenv('GITHUB_TOKEN'):
        print("Error: GITHUB_TOKEN not set")
        print("Set it in .env file, environment variable, or export GITHUB_TOKEN=your_token_here")
        exit(1)
    
    example_usage()
