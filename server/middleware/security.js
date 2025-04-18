/**
 * Security Middleware
 * Implements various security best practices for the API
 */
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');


/**
 * Configure and apply security middleware to Express app
 * @param {Object} app - Express application instance
 */
const configureSecurityMiddleware = (app) => {
  const isProd = process.env.NODE_ENV === 'production';
  
  // Production-optimized Helmet configuration
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"]
      },
      // Faster response handling in production
      reportOnly: false
    },
    hsts: isProd ? {
      maxAge: 31536000, // 1 year in seconds
      includeSubDomains: true,
      preload: true
    } : false,
    frameguard: {
      action: 'deny'
    },
    referrerPolicy: { policy: 'same-origin' },
    // Performance optimizations
    dnsPrefetchControl: isProd,
    permittedCrossDomainPolicies: isProd ? { permittedPolicies: 'none' } : false
  }));

  // Enhanced CORS configuration with optimization and caching
  const corsOptions = {
    origin: ['https://pilves.github.io', 'http://localhost:5173'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  };
  
  // In production, add caching for CORS preflight
  if (isProd) {
    corsOptions.maxAge = 86400; // 24 hours in seconds
    corsOptions.preflightContinue = false;
  }
  
  app.use(cors(corsOptions));

  // Production optimized rate limiting
  const apiLimiter = rateLimit({
    windowMs: isProd ? 5 * 60 * 1000 : 15 * 60 * 1000, // 5 mins in prod, 15 mins in dev
    max: isProd ? 300 : 100, // Higher limit for production with multiple clients
    message: {
      error: 'Too many requests, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip rate limiting for trusted proxies if applicable
    skip: (req, res) => {
      // Example: trusted IPs or health checks could be exempted
      return req.url === '/api/health';
    },
    // Add custom headers for debugging in non-production
    headers: !isProd
  });

  // Apply rate limiting to all API routes
  app.use('/api/', apiLimiter);

  // Auth rate limiting - optimized for both security and performance
  const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: isProd ? 20 : 10, // Allow more attempts in production for multiple users
    message: {
      error: 'Too many login attempts, please try again after an hour'
    },
    // In production, don't include headers for slightly better performance
    headers: !isProd,
    // Store in memory for faster access
    store: undefined
  });

  app.use('/api/auth/', authLimiter);
};

module.exports = { configureSecurityMiddleware };
