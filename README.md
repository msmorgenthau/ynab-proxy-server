# YNAB TypingMind Proxy Server

A proxy server that enables YNAB API access from TypingMind plugins, featuring delta sync support and rate limiting.

## Features

- ✅ CORS support for TypingMind
- ✅ Rate limiting (200 requests/hour per user)
- ✅ Delta sync support for efficient API usage
- ✅ Response caching to reduce API calls
- ✅ Automatic cleanup of old data

## Deployment on Render

1. Create a new Web Service on Render
2. Connect this GitHub repository
3. Use the following settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment: Node

## Environment Variables

Optional:
- `ADMIN_KEY` - Set this to enable cache clearing endpoint

## Endpoints

- `/ynab/*` - Proxy all YNAB API requests
- `/health` - Health check endpoint
- `/cache/clear` - Clear cache (requires ADMIN_KEY)

## Usage

Point your TypingMind plugin to:
```
https://your-app.onrender.com/ynab/[endpoint]
```

The proxy will forward requests to:
```
https://api.youneedabudget.com/v1/[endpoint]
```