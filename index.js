/**
 * Sleep Olympics API Server
 */
const express = require('express');
const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

// Import security and logging middleware
const { configureSecurityMiddleware } = require('./middleware/security');
const { configureLogging, logger } = require('./utils/logger');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const sleepRoutes = require('./routes/sleep');
const competitionRoutes = require('./routes/competitions');
const notificationRoutes = require('./routes/notifications');
const invitationRoutes = require('./routes/invitations');

// Initialize Firebase Admin
try {
  let serviceAccount;
  
  if (process.env.NODE_ENV === 'production' && process.env.FIREBASE_SERVICE_ACCOUNT) {
    // In production, use environment variable (safer for deployment)
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    // In development, use local file
    serviceAccount = require('./serviceAccountKey.json');
  }
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  
  logger.info('Firebase Admin initialized successfully');
} catch (error) {
  logger.error('Error initializing Firebase Admin:', error);
  process.exit(1);
}

// Create Express app
const app = express();

// Apply security middleware
configureSecurityMiddleware(app);

// Apply logging middleware
configureLogging(app);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sleep', sleepRoutes);
app.use('/api/competitions', competitionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/invitations', invitationRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    message: 'Sleep Olympics API is running',
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const errorResponse = {
    error: err.message || 'Internal server error',
    requestId: req.id
  };
  
  // Add stack trace in development
  if (process.env.NODE_ENV !== 'production') {
    errorResponse.stack = err.stack;
  }
  
  res.status(statusCode).json(errorResponse);
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  // Serve static files from the React app
  app.use(express.static(path.join(__dirname, '../client/build')));
  
  // The "catchall" handler: for any request that doesn't
  // match one above, send back React's index.html file
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
  });
}

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
});