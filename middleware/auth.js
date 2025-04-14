
const admin = require('firebase-admin');

// Middleware to verify user is authenticated with Firebase
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];

    // Verify the token with Firebase Admin
    const decodedToken = await admin.auth().verifyIdToken(token);

    // Add user ID to request for use in route handlers
    req.userId = decodedToken.uid;

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

// Check if user has admin role
const isAdmin = async (req, res, next) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized: Not authenticated' });
    }

    // Check if user has admin role in Firestore
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    const userData = userDoc.data();

    if (!userData || !userData.roles || !userData.roles.admin) {
      return res.status(403).json({ error: 'Forbidden: Requires admin privileges' });
    }

    next();
  } catch (error) {
    console.error('Admin check error:', error);
    return res.status(500).json({ error: 'Server error checking permissions' });
  }
};

module.exports = { authenticate, isAdmin };
