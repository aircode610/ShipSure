"""
Main orchestrator script for ShipSure.
Processes all PRs in a repository, generates tests, runs them in Daytona,
and analyzes results with GPT for risk assessment.
"""

import os
import sys
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dotenv import load_dotenv

from backend.github_client import GitHubAPIClient
from backend.test_runner import TestRunner
from backend.gpt_analyzer import GPTAnalyzer
from backend.pr_processor import PRProcessor

# Load environment variables
load_dotenv()

# Setup logging
def setup_logging(output_dir: Path):
    """Setup logging to both file and console"""
    log_dir = output_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    
    log_file = log_dir / f"shipSure_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler(sys.stdout)
        ]
    )
    
    return logging.getLogger(__name__)


def parse_repo_name(repo_name: str) -> Tuple[str, str]:
    """
    Parse repository name into owner and repo.
    Supports formats: 'owner/repo' or 'owner/repo'
    """
    if '/' in repo_name:
        parts = repo_name.split('/')
        if len(parts) == 2:
            return parts[0], parts[1]
    
    raise ValueError(f"Invalid repo format: {repo_name}. Expected format: 'owner/repo'")


def save_results(output_dir: Path, results: Dict):
    """Save results to JSON file"""
    output_file = output_dir / f"results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    
    logging.info(f"Results saved to {output_file}")
    return output_file


def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description="ShipSure - Analyze PRs, generate tests, and assess risk"
    )
    parser.add_argument('repo', help='Repository name in format: owner/repo')
    parser.add_argument('--output-dir', default='output', help='Output directory for results (default: output)')
    parser.add_argument('--state', choices=['open', 'closed', 'all'], default='open',
                       help='PR state to process (default: open)')
    parser.add_argument('--max-prs', type=int, help='Maximum number of PRs to process')
    parser.add_argument('--skip-tests', action='store_true', help='Skip test generation and execution')
    parser.add_argument('--skip-gpt', action='store_true', help='Skip GPT analysis')
    
    args = parser.parse_args()
    
    # Parse repo name
    try:
        owner, repo = parse_repo_name(args.repo)
    except ValueError as e:
        print(f"❌ Error: {e}")
        sys.exit(1)
    
    # Create output directory
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Setup logging
    logger = setup_logging(output_dir)
    logger.info(f"Starting ShipSure analysis for {owner}/{repo}")
    
    try:
        # Initialize clients
        logger.info("Initializing clients...")
        github_client = GitHubAPIClient()
        test_runner = TestRunner() if not args.skip_tests else None
        gpt_analyzer = GPTAnalyzer() if not args.skip_gpt else None
        
        # Initialize PR processor
        processor = PRProcessor(
            github_client=github_client,
            test_runner=test_runner,
            gpt_analyzer=gpt_analyzer,
            logger=logger
        )
        
        # Fetch all PRs
        logger.info(f"Fetching {args.state} PRs from {owner}/{repo}...")
        
        if args.state == "all":
            # Fetch both open and closed PRs
            open_prs = github_client.list_prs(owner, repo, state="open")
            closed_prs = github_client.list_prs(owner, repo, state="closed")
            prs = open_prs + closed_prs
        else:
            prs = github_client.list_prs(owner, repo, state=args.state)
        
        # Filter out test PRs (PRs created by Coderabbit for unit tests)
        def is_test_pr(pr: Dict) -> bool:
            """Check if a PR is a test PR created by Coderabbit"""
            title = pr.get('title', '').lower()
            body = pr.get('body', '').lower()
            user = pr.get('user', {}).get('login', '').lower()
            
            # Check if it's created by Coderabbit/bot
            if 'coderabbit' in user or 'bot' in user:
                # Check for test-related keywords in title
                test_keywords = [
                    'coderabbit generated unit tests',
                    'generated unit tests',
                    'unit test',
                    'test for pr',
                    'test suite for',
                    'comprehensive test suite'
                ]
                if any(keyword in title for keyword in test_keywords):
                    return True
            
            return False
        
        # Filter out test PRs
        original_prs = [pr for pr in prs if not is_test_pr(pr)]
        filtered_count = len(prs) - len(original_prs)
        
        if filtered_count > 0:
            logger.info(f"Filtered out {filtered_count} test PR(s) (Coderabbit generated)")
        
        prs = original_prs
        
        if args.max_prs:
            prs = prs[:args.max_prs]
        
        logger.info(f"Found {len(prs)} PR(s) to process")
        
        # Process each PR
        results = {
            "repository": f"{owner}/{repo}",
            "processedAt": datetime.now().isoformat(),
            "pullRequests": []
        }
        
        for i, pr in enumerate(prs, 1):
            pr_number = pr['number']
            pr_title = pr.get('title', 'N/A')
            logger.info(f"\n{'='*60}")
            logger.info(f"Processing PR #{pr_number}/{len(prs)}: {pr_title}")
            logger.info(f"{'='*60}")
            
            try:
                pr_result = processor.process_pr(
                    owner=owner,
                    repo=repo,
                    pr_number=pr_number,
                    skip_tests=args.skip_tests,
                    skip_gpt=args.skip_gpt
                )
                
                results["pullRequests"].append(pr_result)
                
                # Save intermediate results
                if i % 5 == 0:  # Save every 5 PRs
                    save_results(output_dir, results)
                    logger.info(f"Intermediate results saved (processed {i}/{len(prs)} PRs)")
            
            except Exception as e:
                logger.error(f"Error processing PR #{pr_number}: {e}", exc_info=True)
                # Add error entry
                results["pullRequests"].append({
                    "id": pr_number,
                    "title": pr_title,
                    "link": pr.get('html_url', ''),
                    "error": str(e),
                    "risk": 0
                })
        
        # Save final results
        final_file = save_results(output_dir, results)
        
        logger.info(f"\n{'='*60}")
        logger.info("Analysis complete!")
        logger.info(f"Processed {len(results['pullRequests'])} PR(s)")
        logger.info(f"Results saved to: {final_file}")
        logger.info(f"{'='*60}")
        
        # Print summary
        successful = sum(1 for pr in results["pullRequests"] if "error" not in pr)
        failed = len(results["pullRequests"]) - successful
        
        print(f"\n✅ Successfully processed: {successful}")
        if failed > 0:
            print(f"❌ Failed: {failed}")
        
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
