const admin = require('firebase-admin');
require('dotenv').config();

// Get frontend URL from environment
const FRONTEND_URL = 'https://pilves.github.io/sleep/';

// Middleware to verify user is authenticated with Firebase
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // Check if client is requesting JSON (API request) or HTML (browser request)
      const acceptHeader = req.headers.accept || '';

      if (acceptHeader.includes('text/html')) {
        // Redirect to frontend for browser requests
        console.log('Redirecting unauthenticated user to frontend homepage');
        return res.redirect(FRONTEND_URL);
      } else {
        // Return JSON error for API requests
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
      }
    }

    const token = authHeader.split(' ')[1];

    // Verify the token with Firebase Admin
    const decodedToken = await admin.auth().verifyIdToken(token);

    // Add user ID to request for use in route handlers
    req.userId = decodedToken.uid;

    next();
  } catch (error) {
    console.error('Authentication error:', error);

    // Check if client is requesting JSON (API request) or HTML (browser request)
    const acceptHeader = req.headers.accept || '';

    // Handle expired token error
    if (error.code === 'auth/id-token-expired') {
      if (acceptHeader.includes('text/html')) {
        // Redirect to frontend for browser requests
        return res.redirect(FRONTEND_URL);
      } else {
        // Return JSON error for API requests
        return res.status(401).json({
          error: 'TokenExpired',
          message: 'Firebase ID token has expired. Please refresh the token.'
        });
      }
    }

    if (acceptHeader.includes('text/html')) {
      // Redirect to frontend for browser requests
      return res.redirect(FRONTEND_URL);
    } else {
      // Return JSON error for API requests
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
  }
};

// Check if user has admin role
const isAdmin = async (req, res, next) => {
  try {
    const userId = req.userId;

    if (!userId) {
      // Check if client is requesting JSON (API request) or HTML (browser request)
      const acceptHeader = req.headers.accept || '';

      if (acceptHeader.includes('text/html')) {
        // Redirect to frontend for browser requests
        console.log('Redirecting unauthenticated user to frontend homepage');
        return res.redirect(FRONTEND_URL);
      } else {
        // Return JSON error for API requests
        return res.status(401).json({ error: 'Unauthorized: Not authenticated' });
      }
    }

    // Check if user has admin role in Firestore
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    const userData = userDoc.data();

    if (!userData || !userData.roles || !userData.roles.includes('admin')) {
      // Check if client is requesting JSON (API request) or HTML (browser request)
      const acceptHeader = req.headers.accept || '';

      if (acceptHeader.includes('text/html')) {
        // Redirect to frontend homepage when not admin
        console.log('Redirecting non-admin user to frontend homepage');
        return res.redirect(FRONTEND_URL);
      } else {
        // Return JSON error for API requests
        return res.status(403).json({ error: 'Forbidden: Requires admin privileges' });
      }
    }

    next();
  } catch (error) {
    console.error('Admin check error:', error);

    // Check if client is requesting JSON (API request) or HTML (browser request)
    const acceptHeader = req.headers.accept || '';

    if (acceptHeader.includes('text/html')) {
      // Redirect to frontend for browser requests
      return res.redirect(FRONTEND_URL);
    } else {
      // Return JSON error for API requests
      return res.status(500).json({ error: 'Server error checking permissions' });
    }
  }
};

module.exports = { authenticate, isAdmin };

