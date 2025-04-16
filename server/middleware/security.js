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
  // Helmet for security HTTP headers
  app.use(helmet());


  // CORS configuration
  const corsOptions = {
    //only front domain in prod
    origin: process.env.NODE_ENV === 'production'
      ? process.env.ALLOWED_ORIGINS.split(',')
      : ['http://localhost:5173'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400 // 24 hours
  };

  app.use(cors(corsOptions));

  // Force HTTPS in production
  if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
      if (req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect(`https://${req.headers.host}${req.url}`);
      }
      next();
    });
  }

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
