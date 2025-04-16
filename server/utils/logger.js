/**
 * Logger utility
 * Structured logging with Winston
 */
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');
const expressWinston = require('express-winston');

// Define log formats
const formats = {
  // Format for development
  development: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.align(),
    winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
  ),
  
  // Format for production (JSON for easier parsing)
  production: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  )
};

// Choose format based on environment
const environment = process.env.NODE_ENV || 'development';
const format = formats[environment] || formats.development;

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format,
  defaultMeta: { service: 'sleep-olympics-api' },
  transports: [
    // Console transport
    new winston.transports.Console(),
    
    // File transport for errors
    new winston.transports.File({ 
      filename: path.join(process.cwd(), 'logs/error.log'), 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    
    // File transport for all logs
    new winston.transports.File({ 
      filename: path.join(process.cwd(), 'logs/combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  ]
});

// Add request ID middleware
const addRequestId = (req, res, next) => {
  req.id = uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
};

// Request logging middleware
const requestLogger = expressWinston.logger({
  winstonInstance: logger,
  meta: true,
  msg: 'HTTP {{req.method}} {{req.url}}',
  expressFormat: true,
  colorize: environment !== 'production',
  requestWhitelist: ['url', 'method', 'httpVersion', 'originalUrl', 'query', 'body'],
  dynamicMeta: (req, res) => ({
    requestId: req.id,
    userId: req.userId // Will be set by auth middleware
  })
});

// Error logging middleware
const errorLogger = expressWinston.errorLogger({
  winstonInstance: logger,
  meta: true,
  msg: 'Error {{err.message}}',
  expressFormat: true,
  colorize: environment !== 'production',
  requestWhitelist: ['url', 'method', 'httpVersion', 'originalUrl', 'query'],
  dynamicMeta: (req, res) => ({
    requestId: req.id,
    userId: req.userId
  })
});

/**
 * Configure and apply logging middleware to Express app
 * @param {Object} app - Express application instance
 */
const configureLogging = (app) => {
  // Ensure logs directory exists
  const fs = require('fs');
  const path = require('path');
  const logsDir = path.join(process.cwd(), 'logs');
  
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
  }
  
  // Apply middleware
  app.use(addRequestId);
  app.use(requestLogger);
  
  // Error logger should be the last middleware before error handlers
  app.use(errorLogger);
  
  // Unhandled rejection handler
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection', {
      reason,
      stack: reason.stack || 'No stack trace available'
    });
  });
  
  // Uncaught exception handler
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', {
      error: error.message,
      stack: error.stack || 'No stack trace available'
    });
    
    // Give the logger a chance to flush
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });
};

module.exports = {
  logger,
  addRequestId,
  requestLogger,
  errorLogger,
  configureLogging
};