"""
Simple Flask server to serve PR analysis results to the frontend
"""

import os
import json
from pathlib import Path
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder='front-end', static_url_path='')
CORS(app)  # Enable CORS for frontend

# Serve static files from front-end directory
@app.route('/app.js')
def serve_app_js():
    """Serve app.js"""
    return send_from_directory('front-end', 'app.js', mimetype='application/javascript')

# Default output directory
OUTPUT_DIR = Path('output')


def find_latest_results():
    """Find the most recent results JSON file"""
    if not OUTPUT_DIR.exists():
        return None
    
    json_files = list(OUTPUT_DIR.glob('results_*.json'))
    if not json_files:
        return None
    
    # Sort by modification time, get most recent
    latest = max(json_files, key=lambda p: p.stat().st_mtime)
    return latest


@app.route('/')
def index():
    """Serve the frontend HTML"""
    print("[Server] Serving index.html")
    return send_from_directory('front-end', 'index.html')

@app.route('/test')
def test():
    """Test page to verify API"""
    return send_from_directory('.', 'test_api.html')


@app.route('/api/pull-requests')
def get_pull_requests():
    """API endpoint to get PR analysis results"""
    print("\n[API] /api/pull-requests called")
    results_file = find_latest_results()
    
    if not results_file:
        print("[API] No results file found")
        return jsonify({
            "error": "No results found. Run the analysis first with: python main.py owner/repo"
        }), 404
    
    print(f"[API] Reading from: {results_file.name}")
    
    try:
        with open(results_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Ensure the format matches what frontend expects
        # Frontend expects: { pullRequests: [...] }
        pull_requests = data.get("pullRequests", [])
        print(f"[API] Found {len(pull_requests)} PR(s) in file")
        
        # Ensure all reviews have risk scores
        for pr in pull_requests:
            for review in pr.get("coderabbitReviews", []):
                # Add default risk if missing
                if "risk" not in review:
                    # Set risk based on type
                    if review.get("type") == "danger":
                        review["risk"] = 85
                    elif review.get("type") == "warning":
                        review["risk"] = 55
                    elif review.get("type") == "success":
                        review["risk"] = 0
                    else:
                        review["risk"] = 30
        
        response = {
            "pullRequests": pull_requests
        }
        
        print(f"[API] Returning {len(pull_requests)} PR(s) with risk scores added")
        return jsonify(response)
    
    except Exception as e:
        print(f"[API] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "error": f"Error reading results: {str(e)}"
        }), 500


@app.route('/api/results/list')
def list_results():
    """List all available result files"""
    if not OUTPUT_DIR.exists():
        return jsonify({"results": []})
    
    json_files = sorted(
        OUTPUT_DIR.glob('results_*.json'),
        key=lambda p: p.stat().st_mtime,
        reverse=True
    )
    
    results = [
        {
            "filename": f.name,
            "path": str(f),
            "modified": f.stat().st_mtime,
            "size": f.stat().st_size
        }
        for f in json_files
    ]
    
    return jsonify({"results": results})


@app.route('/api/results/<filename>')
def get_specific_results(filename):
    """Get results from a specific file"""
    results_file = OUTPUT_DIR / filename
    
    if not results_file.exists():
        return jsonify({"error": "File not found"}), 404
    
    try:
        with open(results_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        response = {
            "pullRequests": data.get("pullRequests", [])
        }
        
        return jsonify(response)
    
    except Exception as e:
        return jsonify({
            "error": f"Error reading file: {str(e)}"
        }), 500


if __name__ == '__main__':
    print("=" * 60)
    print("ShipSure Frontend Server")
    print("=" * 60)
    print(f"\nServing frontend at: http://localhost:5000")
    print(f"API endpoint: http://localhost:5000/api/pull-requests")
    print(f"\nResults directory: {OUTPUT_DIR.absolute()}")
    
    latest = find_latest_results()
    if latest:
        print(f"Latest results: {latest.name}")
    else:
        print("⚠ No results found. Run analysis first:")
        print("  python main.py owner/repo")
    
    print("\nPress Ctrl+C to stop the server")
    print("=" * 60)
    
    app.run(debug=True, port=5000)
