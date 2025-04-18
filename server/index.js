/**
 * Sleep Olympics API Server - Production Optimized
 */
const express = require('express');
const admin = require('firebase-admin');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables once
dotenv.config();

let firestore; // Declare firestore outside

// Initialize Firebase Admin with optimized settings
async function initializeFirebaseAdmin() {
  try {
    let serviceAccount;

    if (process.env.NODE_ENV === 'production' && process.env.FIREBASE_SERVICE_ACCOUNT) {
      // In production, use environment variable (safer for deployment)
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
      // In development, use local file
      serviceAccount = require('./serviceAccountKey.json');
    }

    // Production optimized Firebase settings
    const isProd = process.env.NODE_ENV === 'production';
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      // Optimize database connection settings for production
      databaseAuthVariableOverride: isProd ? undefined : null,
      // Set higher timeout for production reliability
      httpAgent: isProd ? undefined : null
    });

    // Initialize Firestore with caching optimizations for production
    firestore = admin.firestore();
    
    if (isProd) {
      // Optimize Firestore settings for production
      firestore.settings({
        ignoreUndefinedProperties: true,
        cacheSizeBytes: 1073741824, // 1GB cache size
      });
    }

    logger.info('Firebase Admin initialized successfully');
  } catch (error) {
    logger.error('Error initializing Firebase Admin:', error);
    process.exit(1);
  }
}

//   Import security and logging middleware (import after env loading)
const {
  configureSecurityMiddleware
} = require('./middleware/security');
const { configureLogging, logger } = require('./utils/logger');

//   Import routes (import after Firebase initialization, if they use it)
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const sleepRoutes = require('./routes/sleep');
const competitionRoutes = require('./routes/competitions');
const notificationRoutes = require('./routes/notifications');
const invitationRoutes = require('./routes/invitations');

async function startServer() {
  // Initialize Firebase Admin
  await initializeFirebaseAdmin();

  // Initialize firestoreUtils with optimized settings
  const firestoreUtils = require('./utils/firestoreUtils')(firestore); 
  
  // Verify firestoreUtils initialization
  if (!firestoreUtils || typeof firestoreUtils.queryDocuments !== 'function') {
    logger.error('firestoreUtils was not initialized correctly!');
    process.exit(1);
  } else {
    logger.info('firestoreUtils initialized successfully');
  }

  // Create Express app with production optimizations
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';
  
  // Apply middleware - security first
  configureSecurityMiddleware(app);
  configureLogging(app);
  
  // JSON parser with size limits for production
  app.use(express.json({ 
    limit: isProd ? '1mb' : '10mb',
    strict: true,
    reviver: isProd ? undefined : null
  }));
  
  // URL parser with size limits for production
  app.use(express.urlencoded({ 
    extended: false,
    limit: isProd ? '1mb' : '10mb'
  }));
  
  // In production, skip detailed request logging
  if (!isProd) {
    app.use((req, res, next) => {
      logger.info(`${req.method} request from ${req.headers.origin || 'unknown origin'} to ${req.originalUrl}`);
      next();
    });
  }
  
  // CORS handler
  const allowedOrigins = ['https://pilves.github.io', 'http://localhost:5173'];
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    
    if (allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    
    // Fast OPTIONS handling
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    next();
  });
  
  // CORS test endpoint (keep for troubleshooting)
  app.get('/api/cors-test', (req, res) => {    
    res.status(200).json({
      status: 'ok',
      message: 'CORS is properly configured',
      origin: req.headers.origin || 'No origin header'
    });
  });

  //   5. API routes
  app.use('/api/auth', authRoutes(firestoreUtils));
  app.use('/api/users', userRoutes(firestoreUtils));
  app.use('/api/sleep', sleepRoutes(firestoreUtils));
  app.use('/api/competitions', competitionRoutes(firestoreUtils));
  app.use('/api/notifications', notificationRoutes(firestoreUtils));
  app.use('/api/invitations', invitationRoutes(firestoreUtils));

  //   6. Health check endpoint
  app.get('/api/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      message: 'Sleep Olympics API is running',
      timestamp: new Date().toISOString()
    });
  });

  // Global error handler with production optimizations
  app.use((err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    const isProd = process.env.NODE_ENV === 'production';
    
    // In production, limit error details for security
    const errorResponse = {
      error: isProd && statusCode === 500 ? 'Internal server error' : (err.message || 'Internal server error'),
      requestId: req.id
    };

    // Only include stack trace in non-production
    if (!isProd) {
      errorResponse.stack = err.stack;
    }
    
    // Set CORS headers for errors
    const origin = req.headers.origin;
    const allowedOrigins = ['https://pilves.github.io', 'http://localhost:5173'];
    
    if (allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
    }

    // Log 5xx errors but not 4xx errors in production
    if (isProd && statusCode >= 500) {
      logger.error(`Server error: ${err.message}`, { statusCode, path: req.path });
    }

    res.status(statusCode).json(errorResponse);
  });

  // Start the server with production optimizations
  const PORT = process.env.PORT || 5000;
  
  // Create the server
  const server = app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  });
  
  // Production optimizations for the HTTP server
  if (process.env.NODE_ENV === 'production') {
    // Set timeouts
    server.timeout = 60000; // 60 seconds
    server.keepAliveTimeout = 65000; // slightly higher than 60 seconds
    
    // Handle graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully');
      server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });
      
      // Force close after 30 seconds if connections are still open
      setTimeout(() => {
        logger.error('Forcing server close after timeout');
        process.exit(1);
      }, 30000);
    });
  }
}

//   Call the async startServer function
startServer();

