/**
 * Logging Utility
 * Configures Winston logging with sensitive data filtering
 */
const winston = require('winston');
const expressWinston = require('express-winston');
const path = require('path');
require('dotenv').config();

// Configure log file locations
const logsDir = path.join(__dirname, '../logs');

// Format options
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
);

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
);

// Sensitive data patterns to filter
const sensitivePatterns = [
  // Email addresses
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' },
  
  // JWT tokens
  { pattern: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, replacement: '[JWT]' },
  
  // Firebase Auth/API keys
  { pattern: /AIza[0-9A-Za-z-_]{35}/g, replacement: '[FIREBASE_API_KEY]' },
  
  // Generic API Keys
  { pattern: /api[_-]?key[=:]["']?\w{20,}["']?/gi, replacement: 'api_key="[API_KEY]"' },
  
  // OAuth tokens
  { pattern: /(access|refresh)_token[=:]["']?\w{20,}["']?/gi, replacement: '$1_token="[OAUTH_TOKEN]"' },
  
  // IP addresses - relaxed for development, uncomment for production
  // { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: '[IP_ADDRESS]' },
  
  // Passwords in request bodies
  { pattern: /"password":\s*"[^"]*"/g, replacement: '"password":"[REDACTED]"' },
  
  // Oura API tokens
  { pattern: /oura[_-]api[_-]token[=:]["']?\w{20,}["']?/gi, replacement: 'oura_api_token="[REDACTED]"' },
  
  // Firebase service account data
  { pattern: /"private_key": "-----BEGIN PRIVATE KEY-----.+?-----END PRIVATE KEY-----\\n"/gs, replacement: '"private_key":"[REDACTED]"' },
  { pattern: /"client_email": "[^"]+"/g, replacement: '"client_email":"[REDACTED]"' }
];

// Create a format that filters sensitive data
const filterSensitiveData = winston.format((info) => {
  if (typeof info.message === 'string') {
    sensitivePatterns.forEach(({ pattern, replacement }) => {
      info.message = info.message.replace(pattern, replacement);
    });
  }
  
  // Also handle objects that might have been stringified
  if (info.meta) {
    const metaString = JSON.stringify(info.meta);
    let filteredMetaString = metaString;
    
    sensitivePatterns.forEach(({ pattern, replacement }) => {
      filteredMetaString = filteredMetaString.replace(pattern, replacement);
    });
    
    // Parse it back to an object if it was changed
    if (filteredMetaString !== metaString) {
      try {
        info.meta = JSON.parse(filteredMetaString);
      } catch (e) {
        // If parsing fails, use the string version
        info.meta = filteredMetaString;
      }
    }
  }
  
  return info;
});

// Create logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    filterSensitiveData(),
    winston.format.metadata({ fillExcept: ['level', 'message', 'timestamp'] }),
    winston.format.json()
  ),
  defaultMeta: { service: 'sleep-olympics-api' },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        filterSensitiveData(),
        consoleFormat
      )
    }),
    
    // File transports
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error',
      format: winston.format.combine(
        filterSensitiveData(),
        fileFormat
      )
    }),
    new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log'),
      format: winston.format.combine(
        filterSensitiveData(),
        fileFormat
      )
    })
  ],
  // Add exception and rejection handling
  exceptionHandlers: [
    new winston.transports.File({ filename: path.join(logsDir, 'exceptions.log') })
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: path.join(logsDir, 'rejections.log') })
  ],
  exitOnError: false // Don't exit on handled exceptions
});

// Configure request logging middleware for Express
const configureLogging = (app) => {
  // Log all requests
  app.use(expressWinston.logger({
    winstonInstance: logger,
    meta: process.env.NODE_ENV !== 'production', // Log metadata in non-production
    msg: "HTTP {{req.method}} {{req.url}} {{res.statusCode}} {{res.responseTime}}ms",
    expressFormat: true,
    colorize: false,
    format: winston.format.combine(
      filterSensitiveData()
    ),
    ignoreRoute: (req, res) => {
      // Don't log health checks to reduce noise
      return req.url === '/api/health';
    }
  }));

  // Log errors
  app.use(expressWinston.errorLogger({
    winstonInstance: logger,
    format: winston.format.combine(
      filterSensitiveData()
    )
  }));
};

module.exports = { logger, configureLogging };