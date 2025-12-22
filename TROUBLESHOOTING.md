# Troubleshooting Guide

## UI Not Showing Data

### Step 1: Check Browser Console

1. Open your browser to `http://localhost:5000`
2. Press `F12` to open Developer Tools
3. Go to the **Console** tab
4. Look for:
   - `"DOM loaded, initializing..."`
   - `"Fetching PRs from /api/pull-requests..."`
   - `"Fetched data: ..."`
   - Any error messages in red

### Step 2: Check Network Tab

1. In Developer Tools, go to **Network** tab
2. Refresh the page
3. Look for:
   - `GET /api/pull-requests` request
   - Check if it returns `200` status
   - Click on it to see the response

### Step 3: Check Server Logs

In the terminal where `server.py` is running, you should see:
```
[API] /api/pull-requests called
[API] Reading from: results_XXXXXX.json
[API] Found X PR(s) in file
[API] Returning X PR(s) with risk scores added
```

### Step 4: Test API Directly

1. Open `http://localhost:5000/test` in your browser
2. This will show the raw API response
3. Verify the data structure matches what frontend expects

### Step 5: Verify Data Format

The API should return:
```json
{
  "pullRequests": [
    {
      "id": 6,
      "title": "...",
      "link": "...",
      "risk": 50,
      "coderabbitReviews": [
        {
          "name": "...",
          "type": "danger|warning|success",
          "risk": 85,
          "description": "..."
        }
      ],
      "generatedTests": [...]
    }
  ]
}
```

## Common Issues

### Issue: "No data received from API"
**Solution**: 
- Check server is running
- Check `output/results_*.json` exists
- Check browser console for fetch errors

### Issue: "Empty pullRequests array"
**Solution**:
- Verify the JSON file has `"pullRequests"` key
- Check the array is not empty
- Re-run analysis: `python main.py owner/repo`

### Issue: API returns 404
**Solution**:
- Make sure you've run the analysis first
- Check `output/` directory exists
- Verify `results_*.json` files exist

### Issue: CORS errors
**Solution**:
- Flask-CORS is already enabled
- If still seeing CORS errors, check server logs

### Issue: Reviews don't show risk scores
**Solution**:
- The server automatically adds risk scores if missing
- Check server logs for `[API] Returning X PR(s) with risk scores added`

## Debug Checklist

- [ ] Server is running (`python server.py`)
- [ ] Results file exists in `output/` directory
- [ ] Browser console shows no errors
- [ ] Network tab shows successful API call
- [ ] API returns data in correct format
- [ ] Frontend JavaScript loads without errors

## Manual API Test

Test the API directly:
```bash
curl http://localhost:5000/api/pull-requests
```

Or open in browser:
```
http://localhost:5000/api/pull-requests
```

You should see JSON data with `pullRequests` array.
