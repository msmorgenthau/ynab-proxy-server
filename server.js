// YNAB Proxy Server for TypingMind Plugin
// Deploy this on your Render instance

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for TypingMind
app.use(cors({
  origin: [
    'https://www.typingmind.com',
    'https://typingmind.com',
    'http://localhost:3000', // for testing
    'http://localhost:*',
    'file://*' // for local file testing
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Rate-Limit-Count', 'X-Use-Delta'],
  exposedHeaders: ['X-Rate-Limit-Remaining', 'X-Rate-Limit-Reset', 'X-Cache'],
  maxAge: 86400 // Cache preflight for 24 hours
}));

app.use(express.json());

// Explicit OPTIONS handler for preflight requests
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Rate-Limit-Count, X-Use-Delta');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(204);
});

// Rate limit tracking per API key
const rateLimitMap = new Map();
const RATE_LIMIT = 200;
const RATE_LIMIT_WINDOW = 3600000; // 1 hour in ms
// Cache for frequently accessed data
const dataCache = new Map();
const CACHE_TTL = {
  budgets: 600000,      // 10 minutes
  accounts: 180000,     // 3 minutes  
  categories: 300000,   // 5 minutes
  transactions: 60000   // 1 minute
};

// Delta sync tracking
const deltaSyncMap = new Map();

// Helper to get user key from API token
function getUserKey(authHeader) {
  if (!authHeader) return null;
  return crypto.createHash('md5').update(authHeader).digest('hex');
}

// Rate limit middleware
function rateLimitMiddleware(req, res, next) {
  const userKey = getUserKey(req.headers.authorization);
  if (!userKey) {
    return res.status(401).json({ error: 'Authorization required' });
  }
  
  // Get or create rate limit tracker
  let tracker = rateLimitMap.get(userKey);  if (!tracker) {
    tracker = {
      requests: [],
      resetTime: Date.now() + RATE_LIMIT_WINDOW
    };
    rateLimitMap.set(userKey, tracker);
  }
  
  // Clean old requests
  const now = Date.now();
  tracker.requests = tracker.requests.filter(t => t > now - RATE_LIMIT_WINDOW);
  
  // Check limit
  if (tracker.requests.length >= RATE_LIMIT - 5) {
    const oldestRequest = Math.min(...tracker.requests);
    const resetIn = Math.ceil((oldestRequest + RATE_LIMIT_WINDOW - now) / 1000);
    
    res.setHeader('X-Rate-Limit-Remaining', Math.max(0, RATE_LIMIT - tracker.requests.length));
    res.setHeader('X-Rate-Limit-Reset', Math.floor((oldestRequest + RATE_LIMIT_WINDOW) / 1000));
    
    if (tracker.requests.length >= RATE_LIMIT) {
      return res.status(429).json({
        error: {
          id: 'rate_limit',
          name: 'Rate limit exceeded',
          detail: `API rate limit of ${RATE_LIMIT} requests per hour exceeded. Resets in ${resetIn} seconds.`
        },
        resetIn: resetIn
      });
    }
  }  
  // Track this request
  tracker.requests.push(now);
  
  // Add rate limit headers
  res.setHeader('X-Rate-Limit-Limit', RATE_LIMIT);
  res.setHeader('X-Rate-Limit-Remaining', RATE_LIMIT - tracker.requests.length);
  res.setHeader('X-Rate-Limit-Reset', Math.floor(tracker.resetTime / 1000));
  
  next();
}

// Cache helper functions
function getCacheKey(userKey, endpoint) {
  return `${userKey}_${endpoint}`;
}

function getCachedData(userKey, endpoint, maxAge) {
  const key = getCacheKey(userKey, endpoint);
  const cached = dataCache.get(key);
  
  if (cached && cached.timestamp > Date.now() - maxAge) {
    return cached.data;
  }
  
  return null;
}

function setCachedData(userKey, endpoint, data) {
  const key = getCacheKey(userKey, endpoint);
  dataCache.set(key, {
    data: data,
    timestamp: Date.now()
  });  
  // Clean old cache entries periodically
  if (dataCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of dataCache.entries()) {
      if (v.timestamp < now - 3600000) {
        dataCache.delete(k);
      }
    }
  }
}

// YNAB API proxy endpoint
app.use('/ynab/*', rateLimitMiddleware, async (req, res) => {
  try {
    // Fix: Use params[0] which contains the path after /ynab/
    const ynabPath = req.params[0] ? `/${req.params[0]}` : '/';
    const userKey = getUserKey(req.headers.authorization);
    const useDelta = req.headers['x-use-delta'] === 'true';
    
    // Determine cache TTL based on endpoint
    let cacheTTL = 0;
    if (ynabPath.includes('/budgets') && req.method === 'GET') {
      cacheTTL = ynabPath === '/budgets' ? CACHE_TTL.budgets : 0;
    } else if (ynabPath.includes('/accounts') && req.method === 'GET') {
      cacheTTL = CACHE_TTL.accounts;
    } else if (ynabPath.includes('/categories') && req.method === 'GET') {
      cacheTTL = CACHE_TTL.categories;
    } else if (ynabPath.includes('/transactions') && req.method === 'GET') {
      cacheTTL = CACHE_TTL.transactions;
    }    
    // Check cache for GET requests
    if (req.method === 'GET' && cacheTTL > 0) {
      const cached = getCachedData(userKey, ynabPath, cacheTTL);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-Age', Math.floor((Date.now() - cached.timestamp) / 1000));
        return res.json(cached);
      }
    }
    
    // Build YNAB API URL
    let ynabUrl = `https://api.youneedabudget.com/v1${ynabPath}`;
    
    // Debug logging
    console.log('YNAB Request:', {
      path: ynabPath,
      url: ynabUrl,
      method: req.method,
      hasAuth: !!req.headers.authorization,
      authHeader: req.headers.authorization ? req.headers.authorization.substring(0, 20) + '...' : 'none'
    });
    
    // Handle query parameters including delta sync
    const queryParams = { ...req.query };
    
    // Add delta sync if not explicitly provided
    if (useDelta && !queryParams.last_knowledge_of_server && req.method === 'GET') {
      const deltaKey = `${userKey}_${ynabPath}`;
      const lastKnowledge = deltaSyncMap.get(deltaKey);
      if (lastKnowledge) {
        queryParams.last_knowledge_of_server = lastKnowledge;
      }
    }
    
    // Rebuild query string
    const queryString = new URLSearchParams(queryParams).toString();
    if (queryString) {
      ynabUrl += `?${queryString}`;
    }    
    // Make request to YNAB
    const ynabResponse = await axios({
      method: req.method,
      url: ynabUrl,
      headers: {
        'Authorization': req.headers.authorization,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'User-Agent': 'YNAB-TypingMind-Proxy/1.0'
      },
      data: req.body,
      timeout: 30000, // 30 second timeout
      validateStatus: (status) => status < 500, // Don't throw on 4xx errors
      responseType: 'json',
      maxRedirects: 0, // Don't follow redirects
      maxRedirects: 0, // Don't follow redirects
      transformResponse: [(data) => {
        // Log raw response for debugging
        if (typeof data === 'string' && data.includes('<!DOCTYPE')) {
          console.log('Raw HTML response from YNAB:', data.substring(0, 200));
        }
        try {
          return JSON.parse(data);
        } catch (e) {
          return data;
        }
      }]
    });
    
    // Log response details
    console.log('YNAB Response:', {
      status: ynabResponse.status,
      statusText: ynabResponse.statusText,
      headers: {
        'content-type': ynabResponse.headers['content-type'],
        'x-rate-limit': ynabResponse.headers['x-rate-limit']
      },
      dataType: typeof ynabResponse.data,
      isHTML: typeof ynabResponse.data === 'string' && ynabResponse.data.includes('<!DOCTYPE')
    });
    
    // Debug: Check if we got HTML
    const responseData = ynabResponse.data;
    if (typeof responseData === 'string' && responseData.includes('<!DOCTYPE')) {
      console.error('Got HTML response from YNAB!', {
        url: ynabUrl,
        status: ynabResponse.status,
        headers: ynabResponse.headers
      });
    }
    
    // Store server_knowledge for delta sync
    if (ynabResponse.data?.data?.server_knowledge) {
      const deltaKey = `${userKey}_${ynabPath}`;
      deltaSyncMap.set(deltaKey, ynabResponse.data.data.server_knowledge);
    }
    
    // Cache successful GET responses
    if (req.method === 'GET' && cacheTTL > 0) {
      setCachedData(userKey, ynabPath, ynabResponse.data);
      res.setHeader('X-Cache', 'MISS');
    }
    
    // Add YNAB rate limit info if available
    const ynabRateLimit = ynabResponse.headers['x-rate-limit'];
    if (ynabRateLimit) {
      res.setHeader('X-YNAB-Rate-Limit', ynabRateLimit);
    }
    
    // Check if we got HTML instead of JSON
    if (typeof ynabResponse.data === 'string' && ynabResponse.data.includes('<!DOCTYPE')) {
      console.error('YNAB returned HTML instead of JSON');
      return res.status(502).json({
        error: {
          id: 'bad_gateway',
          name: 'Bad Gateway',
          detail: 'YNAB API returned HTML instead of JSON. This might be a temporary issue.'
        }
      });
    }
    
    res.json(ynabResponse.data);    
  } catch (error) {
    console.error('YNAB API Error:', error.response?.data || error.message);
    
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({
        error: {
          id: 'internal_error',
          name: 'Internal Server Error',
          detail: error.message
        }
      });
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    cache_size: dataCache.size,
    rate_limit_trackers: rateLimitMap.size
  });
});

// Clear cache endpoint (optional, requires auth)
app.post('/cache/clear', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }  
  dataCache.clear();
  deltaSyncMap.clear();
  
  res.json({
    message: 'Cache cleared',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`YNAB Proxy Server running on port ${PORT}`);
  console.log('CORS enabled for TypingMind');
  console.log('Rate limiting: ' + RATE_LIMIT + ' requests per hour');
  
  // Clean up old rate limit data periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, tracker] of rateLimitMap.entries()) {
      if (tracker.requests.length === 0 && tracker.resetTime < now) {
        rateLimitMap.delete(key);
      }
    }
  }, 300000); // Every 5 minutes
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});