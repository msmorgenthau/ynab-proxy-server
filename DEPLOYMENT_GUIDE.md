# YNAB Proxy Server Deployment Guide

## What I've Done:
✅ Created a new YNAB proxy server in `/Users/michaelmorgenthau/ynab-proxy-server`
✅ Implemented delta sync, rate limiting, and caching
✅ Initialized git repository with initial commit
✅ Ready for deployment to Render

## Next Steps You Need to Do:

### Option 1: Deploy as a New Service on Render

1. **Create GitHub Repository**:
   ```bash
   # In your browser, create a new repo on GitHub (e.g., "ynab-proxy-server")
   # Then in terminal:
   cd /Users/michaelmorgenthau/ynab-proxy-server
   git remote add origin https://github.com/YOUR_USERNAME/ynab-proxy-server.git
   git branch -M main
   git push -u origin main
   ```

2. **Deploy on Render**:
   - Go to https://dashboard.render.com
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Name: `ynab-proxy` (or keep `plugins-server-7x3r` if updating)
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Click "Create Web Service"

3. **Update TypingMind Plugin**:
   - Change server URL to your new Render URL
   - Or keep existing URL if you're updating the current service

### Option 2: Update Existing Render Service

If `plugins-server-7x3r` is meant for this YNAB proxy:

1. **Check Current Repository**:
   - Go to your Render dashboard
   - Find `plugins-server-7x3r`
   - Check which GitHub repo it's connected to

2. **Update That Repository**:
   - Copy the server.js and package.json to that repo
   - Commit and push
   - Render will auto-deploy

## Test Your Deployment

Once deployed, test it:
```bash
curl https://your-service.onrender.com/health
```

Should return:
```json
{
  "status": "healthy",
  "timestamp": "...",
  "cache_size": 0,
  "rate_limit_trackers": 0
}
```

## Environment Variables (Optional)

In Render dashboard, you can add:
- `ADMIN_KEY`: Any secret string to protect cache clearing endpoint

## File Locations

Your new proxy server files are at:
- `/Users/michaelmorgenthau/ynab-proxy-server/server.js`
- `/Users/michaelmorgenthau/ynab-proxy-server/package.json`
- `/Users/michaelmorgenthau/ynab-proxy-server/README.md`