const express = require('express');
const { authenticate, isAdmin } = require('../middleware/auth');
const userController = require('../controllers/userController');

// Return a router function that accepts firestoreUtils
module.exports = (firestoreUtils) => {
  const router = express.Router();
  
  // Initialize the controller with firestoreUtils
  userController.init(firestoreUtils);

  // Get all users (admin only)
  router.get('/', authenticate, isAdmin, (req, res, next) => {
    console.log('Admin request to get all users');
    return userController.getAllUsers(req, res, next);
  });

  // Get current user profile
  router.get('/profile', authenticate, userController.getUserProfile);

  // Update user profile
  router.put('/profile', authenticate, (req, res, next) => {
    console.log('Profile update request received for user:', req.userId);
    console.log('Request body:', req.body);
    return userController.updateUserProfile(req, res, next);
  });

  // Get notification preferences
  router.get('/notifications', authenticate, userController.getNotificationPreferences);

  // Update notification preferences
  router.put('/notifications', authenticate, userController.updateNotificationPreferences);

  // OAuth flow routes
  // Initiate Oura OAuth flow
  router.get('/oura/authorize', authenticate, userController.initiateOuraOAuth);

  // OAuth callback from Oura
  router.get('/oura/callback', userController.handleOuraOAuthCallback);

  // Get Oura connection status
  router.get('/oura/status', authenticate, userController.getOuraConnectionStatus);

  // Disconnect Oura integration
  router.post('/oura/disconnect', authenticate, userController.disconnectOuraIntegration);

  // Update user status (activate/deactivate) - admin only
  router.put('/:userId/status', authenticate, isAdmin, (req, res, next) => {
    console.log('Admin request to update user status');
    return userController.updateUserStatus(req, res, next);
  });

  // Add admin role to user - admin only
  router.post('/:userId/roles/admin', authenticate, isAdmin, (req, res, next) => {
    console.log('Admin request to add admin role');
    return userController.addAdminRole(req, res, next);
  });

  // Remove admin role from user - admin only
  router.delete('/:userId/roles/admin', authenticate, isAdmin, (req, res, next) => {
    console.log('Admin request to remove admin role');
    return userController.removeAdminRole(req, res, next);
  });

  return router;
};
