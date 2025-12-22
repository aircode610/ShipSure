"""
Flask server for ShipSure PR Risk Intelligence
Handles repo listing, PR fetching, and async analysis
"""

import os
import json
import time
import threading
from pathlib import Path
from flask import Flask, jsonify, send_from_directory, request
from flask_cors import CORS
from dotenv import load_dotenv

# Import backend modules
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from backend.github_client import GitHubAPIClient
from backend.test_runner import TestRunner
from backend.gpt_analyzer import GPTAnalyzer
from backend.pr_processor import PRProcessor
import logging

load_dotenv()

app = Flask(__name__, static_folder='frontend', static_url_path='')
CORS(app)  # Enable CORS for frontend

# Analysis jobs storage (in production, use Redis or database)
analysis_jobs = {}
OUTPUT_DIR = Path('output')
OUTPUT_DIR.mkdir(exist_ok=True)

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@app.route('/')
def index():
    """Serve the frontend HTML"""
    return send_from_directory('frontend', 'index.html')


@app.route('/app.js')
def serve_app_js():
    """Serve app.js"""
    return send_from_directory('frontend', 'app.js', mimetype='application/javascript')


@app.route('/app.css')
def serve_app_css():
    """Serve app.css"""
    return send_from_directory('frontend', 'app.css', mimetype='text/css')


@app.route('/icon.png')
def serve_icon():
    """Serve icon"""
    return send_from_directory('frontend', 'icon.png', mimetype='image/png')


@app.route('/api/repos', methods=['GET'])
def get_repos():
    """Fetch all repositories for the authenticated user"""
    github_token = request.args.get('token')
    
    if not github_token:
        return jsonify({"error": "GitHub token is required"}), 400
    
    try:
        client = GitHubAPIClient(token=github_token)
        
        # Fetch user's repos
        url = f"{client.base_url}/user/repos"
        params = {
            "sort": "updated",
            "affiliation": "owner,collaborator"
        }
        response = client._make_request(url, params=params)
        
        repos = []
        for repo in response:
            repos.append({
                "id": repo["id"],
                "name": repo["name"],
                "full_name": repo["full_name"],
                "owner": repo["owner"]["login"],
                "description": repo.get("description", ""),
                "private": repo["private"],
                "updated_at": repo["updated_at"]
            })
        
        return jsonify({"repos": repos})
    
    except Exception as e:
        logger.error(f"Error fetching repos: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/repos/<owner>/<repo>/prs', methods=['GET'])
def get_prs(owner, repo):
    """Fetch all PRs for a repository"""
    github_token = request.args.get('token')
    
    if not github_token:
        return jsonify({"error": "GitHub token is required"}), 400
    
    try:
        client = GitHubAPIClient(token=github_token)
        state = request.args.get('state', 'open')
        
        prs = client.list_prs(owner, repo, state=state)
        
        # Filter out test PRs created by Coderabbit
        def is_test_pr(pr):
            title = pr.get('title', '').lower()
            user = pr.get('user', {}).get('login', '').lower()
            return ('coderabbit' in user or 'bot' in user) and any(
                keyword in title for keyword in [
                    'coderabbit generated unit tests',
                    'generated unit tests',
                    'unit test',
                    'test for pr'
                ]
            )
        
        filtered_prs = [pr for pr in prs if not is_test_pr(pr)]
        
        pr_list = []
        for pr in filtered_prs:
            pr_list.append({
                "number": pr["number"],
                "title": pr.get("title", ""),
                "state": pr.get("state", ""),
                "html_url": pr.get("html_url", ""),
                "user": pr.get("user", {}).get("login", ""),
                "created_at": pr.get("created_at", ""),
                "updated_at": pr.get("updated_at", "")
            })
        
        return jsonify({"prs": pr_list})
    
    except Exception as e:
        logger.error(f"Error fetching PRs: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/analyze', methods=['POST'])
def analyze():
    """Start async analysis for PRs"""
    data = request.json
    
    github_token = data.get('githubToken')
    daytona_api_key = data.get('daytonaApiKey')
    openai_api_key = data.get('openaiApiKey')
    owner = data.get('owner')
    repo = data.get('repo')
    pr_numbers = data.get('prNumbers', [])
    
    if not all([github_token, daytona_api_key, openai_api_key, owner, repo]):
        return jsonify({"error": "Missing required parameters"}), 400
    
    if not pr_numbers:
        return jsonify({"error": "No PRs selected for analysis"}), 400
    
    # Create job ID
    job_id = f"{owner}_{repo}_{int(time.time())}"
    
    # Initialize job BEFORE starting thread to avoid race condition
    analysis_jobs[job_id] = {
        "status": "started",
        "progress": 0,
        "message": "Analysis started",
        "started_at": time.time()
    }
    
    # Start analysis in background thread
    thread = threading.Thread(
        target=run_analysis,
        args=(job_id, github_token, daytona_api_key, openai_api_key, owner, repo, pr_numbers)
    )
    thread.daemon = True
    thread.start()
    
    return jsonify({
        "jobId": job_id,
        "status": "started",
        "message": "Analysis started. Poll /api/analyze/<jobId>/status for updates."
    })


@app.route('/api/analyze/<job_id>/status', methods=['GET'])
def get_analysis_status(job_id):
    """Get analysis job status"""
    if job_id not in analysis_jobs:
        return jsonify({"error": "Job not found"}), 404
    
    job = analysis_jobs[job_id]
    return jsonify(job)


@app.route('/api/analyze/<job_id>/results', methods=['GET'])
def get_analysis_results(job_id):
    """Get analysis results"""
    if job_id not in analysis_jobs:
        return jsonify({"error": "Job not found"}), 404
    
    job = analysis_jobs[job_id]
    
    if job["status"] != "completed":
        return jsonify({"error": "Analysis not completed yet"}), 400
    
    results_file = OUTPUT_DIR / f"results_{job_id}.json"
    if not results_file.exists():
        return jsonify({"error": "Results file not found"}), 404
    
    try:
        with open(results_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return jsonify(data)
    except Exception as e:
        logger.error(f"Error reading results: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


def run_analysis(job_id, github_token, daytona_api_key, openai_api_key, owner, repo, pr_numbers):
    """Run the full analysis workflow"""
    try:
        analysis_jobs[job_id]["status"] = "initializing"
        analysis_jobs[job_id]["message"] = "Initializing clients..."
        analysis_jobs[job_id]["progress"] = 5
        
        # Initialize clients
        github_client = GitHubAPIClient(token=github_token)
        test_runner = TestRunner(api_key=daytona_api_key)
        gpt_analyzer = GPTAnalyzer(api_key=openai_api_key)
        
        processor = PRProcessor(
            github_client=github_client,
            test_runner=test_runner,
            gpt_analyzer=gpt_analyzer,
            logger=logger
        )
        
        # Step 1: Request CodeRabbit to generate tests for all PRs
        analysis_jobs[job_id]["status"] = "requesting_tests"
        analysis_jobs[job_id]["message"] = f"Requesting unit test generation for {len(pr_numbers)} PR(s)..."
        analysis_jobs[job_id]["progress"] = 10
        
        test_prs = {}
        requested_count = 0
        skipped_count = 0
        
        for pr_number in pr_numbers:
            try:
                # First check if test PR already exists
                existing_test_pr = github_client.find_coderabbit_test_pr(owner, repo, pr_number)
                if existing_test_pr:
                    test_prs[pr_number] = existing_test_pr['number']
                    logger.info(f"Test PR #{existing_test_pr['number']} already exists for PR #{pr_number}, skipping request")
                    skipped_count += 1
                    continue
                
                # Check if request was already made
                if github_client.has_test_generation_request(owner, repo, pr_number):
                    logger.info(f"Test generation already requested for PR #{pr_number}, skipping duplicate request")
                    skipped_count += 1
                    continue
                
                # Request test generation
                comment = github_client.trigger_unit_test_generation(owner, repo, pr_number, force=False)
                if comment:
                    logger.info(f"Test generation requested for PR #{pr_number}")
                    requested_count += 1
                else:
                    logger.info(f"Test generation skipped for PR #{pr_number} (already exists or requested)")
                    skipped_count += 1
            except Exception as e:
                logger.error(f"Error requesting tests for PR #{pr_number}: {e}")
        
        if requested_count > 0:
            logger.info(f"Requested test generation for {requested_count} PR(s), skipped {skipped_count} (already exist/requested)")
        else:
            logger.info(f"No new test generation requests needed. {skipped_count} PR(s) already have tests or requests pending.")
        
        # Step 2: Poll for test PRs (check every minute for up to 15 minutes)
        analysis_jobs[job_id]["status"] = "waiting_for_tests"
        analysis_jobs[job_id]["message"] = "Waiting for CodeRabbit to generate tests (checking every minute)..."
        analysis_jobs[job_id]["progress"] = 20
        
        max_wait_time = 15 * 60  # 15 minutes
        check_interval = 60  # 1 minute
        start_time = time.time()
        
        while time.time() - start_time < max_wait_time:
            all_tests_ready = True
            for pr_number in pr_numbers:
                if pr_number not in test_prs:
                    test_pr = github_client.find_coderabbit_test_pr(owner, repo, pr_number)
                    if test_pr:
                        test_prs[pr_number] = test_pr['number']
                        logger.info(f"Found test PR #{test_pr['number']} for PR #{pr_number}")
                    else:
                        all_tests_ready = False
            
            if all_tests_ready and len(test_prs) == len(pr_numbers):
                break
            
            elapsed = int(time.time() - start_time)
            remaining = max_wait_time - elapsed
            analysis_jobs[job_id]["message"] = f"Waiting for tests... ({elapsed//60}m elapsed, checking every minute)"
            time.sleep(check_interval)
        
        if len(test_prs) < len(pr_numbers):
            analysis_jobs[job_id]["message"] = f"Warning: Only {len(test_prs)}/{len(pr_numbers)} test PRs found. Continuing with available tests."
        
        # Step 3: Process each PR
        results = {
            "repository": f"{owner}/{repo}",
            "processedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "pullRequests": []
        }
        
        total_prs = len(pr_numbers)
        for idx, pr_number in enumerate(pr_numbers):
            progress_base = 30
            progress_per_pr = 60 / total_prs
            analysis_jobs[job_id]["progress"] = progress_base + int((idx / total_prs) * progress_per_pr)
            analysis_jobs[job_id]["message"] = f"Processing PR #{pr_number} ({idx+1}/{total_prs})..."
            
            try:
                pr_result = processor.process_pr(
                    owner=owner,
                    repo=repo,
                    pr_number=pr_number,
                    skip_tests=(pr_number not in test_prs),
                    skip_gpt=False
                )
                
                # If we have a test PR, run tests in Daytona
                if pr_number in test_prs:
                    test_pr_number = test_prs[pr_number]
                    analysis_jobs[job_id]["message"] = f"Running tests for PR #{pr_number} in Daytona..."
                    
                    test_results = processor._run_tests_in_daytona(
                        owner, repo, pr_number, test_pr_number
                    )
                    pr_result["testResults"] = test_results
                    pr_result["generatedTests"] = test_results.get("generatedTests", [])
                
                # Analyze with GPT
                analysis_jobs[job_id]["message"] = f"Analyzing PR #{pr_number} with GPT..."
                pr_info = github_client.get_pr_info(owner, repo, pr_number)
                code_files = processor._get_pr_files(owner, repo, pr_number)
                
                analysis = gpt_analyzer.analyze_pr(
                    pr_info=pr_info,
                    coderabbit_reviews=pr_result.get("coderabbitReviews", []),
                    test_results=pr_result.get("testResults"),
                    code_files=code_files
                )
                
                pr_result["risk"] = analysis.get("risk", 0)
                
                # Store risk categories and specific risks if available
                if "riskCategories" in analysis:
                    pr_result["riskCategories"] = analysis["riskCategories"]
                if "specificRisks" in analysis:
                    pr_result["specificRisks"] = analysis["specificRisks"]
                
                # Update reviews with GPT analysis
                for review in pr_result.get("coderabbitReviews", []):
                    review_name = review.get("name")
                    if review_name in analysis.get("reviewUpdates", {}):
                        review.update(analysis["reviewUpdates"][review_name])
                
                results["pullRequests"].append(pr_result)
            
            except Exception as e:
                logger.error(f"Error processing PR #{pr_number}: {e}", exc_info=True)
                results["pullRequests"].append({
                    "id": pr_number,
                    "title": f"PR #{pr_number}",
                    "link": f"https://github.com/{owner}/{repo}/pull/{pr_number}",
                    "error": str(e),
                    "risk": 0
                })
        
        # Save results
        results_file = OUTPUT_DIR / f"results_{job_id}.json"
        with open(results_file, 'w', encoding='utf-8') as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        
        analysis_jobs[job_id]["status"] = "completed"
        analysis_jobs[job_id]["progress"] = 100
        analysis_jobs[job_id]["message"] = f"Analysis complete! Processed {len(results['pullRequests'])} PR(s)."
        analysis_jobs[job_id]["resultsFile"] = str(results_file)
    
    except Exception as e:
        logger.error(f"Analysis error: {e}", exc_info=True)
        analysis_jobs[job_id]["status"] = "error"
        analysis_jobs[job_id]["message"] = f"Error: {str(e)}"
        analysis_jobs[job_id]["progress"] = 0


if __name__ == '__main__':
    print("=" * 60)
    print("ShipSure PR Risk Intelligence Server")
    print("=" * 60)
    print(f"\nServing frontend at: http://localhost:5000")
    print(f"API endpoints:")
    print(f"  GET  /api/repos?token=<github_token>")
    print(f"  GET  /api/repos/<owner>/<repo>/prs?token=<github_token>")
    print(f"  POST /api/analyze")
    print(f"  GET  /api/analyze/<jobId>/status")
    print(f"  GET  /api/analyze/<jobId>/results")
    print("\nPress Ctrl+C to stop the server")
    print("=" * 60)
    
    app.run(debug=True, port=5000, threaded=True)
