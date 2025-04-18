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
  // Helmet for security HTTP headers with production settings
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
      }
    },
    hsts: process.env.NODE_ENV === 'production' ? {
      maxAge: 31536000, // 1 year in seconds
      includeSubDomains: true,
      preload: true
    } : false,
    frameguard: {
      action: 'deny'
    },
    referrerPolicy: { policy: 'same-origin' }
  }));


  // CORS configuration
  // Get allowed origins from environment variables for more flexibility
  // Default to development origins if not specified
  const getAllowedOrigins = () => {
    if (process.env.NODE_ENV === 'production') {
      const prodOrigins = process.env.ALLOWED_ORIGINS || 'https://pilves.github.io';
      return prodOrigins.split(',').map(origin => origin.trim());
    } else {
      const devOrigins = process.env.DEV_ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:5000,http://localhost:3000';
      return devOrigins.split(',').map(origin => origin.trim());
    }
  };

  const corsOptions = {
    origin: function (origin, callback) {
      const allowedOrigins = getAllowedOrigins();
      
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      // In production, explicitly allow the frontend origins
      if (process.env.NODE_ENV === 'production') {
        const allowedOrigins = getAllowedOrigins();
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          console.warn(`Origin ${origin} not allowed by CORS policy. Allowed origins:`, allowedOrigins);
          callback(new Error(`CORS not allowed for origin: ${origin}`), false);
        }
      } else {
        // In development, allow all origins
        callback(null, true);
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'DNT', 'User-Agent', 'X-Requested-With', 'If-Modified-Since', 'Cache-Control', 'Content-Type', 'Range'],
    credentials: true,
    exposedHeaders: ['Content-Length', 'Content-Range'],
    maxAge: 86400 // 24 hours
  };

  // Apply CORS middleware
  app.use(cors(corsOptions));
  
  // Handle preflight requests
  app.options('*', cors(corsOptions));

  // HTTPS redirection removed as we're no longer using Nginx

  // Rate limiting
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
      error: 'Too many requests, please try again later.'
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false // Disable the `X-RateLimit-*` headers
  });

  // Apply rate limiting to all API routes
  app.use('/api/', apiLimiter);

  // More aggressive rate limiting for authentication endpoints
  const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 attempts per hour
    message: {
      error: 'Too many login attempts, please try again after an hour'
    }
  });

  app.use('/api/auth/', authLimiter);
};

module.exports = { configureSecurityMiddleware };
