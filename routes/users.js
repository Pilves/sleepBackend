const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const userController = require('../controllers/userController');

// Get current user profile
router.get('/profile', authenticate, userController.getUserProfile);

// Update user profile
router.put('/profile', authenticate, userController.updateUserProfile);

// Get notification preferences
router.get('/notifications', authenticate, userController.getNotificationPreferences);

// Update notification preferences
router.put('/notifications', authenticate, userController.updateNotificationPreferences);

// Connect Oura integration
router.post('/oura/connect', authenticate, userController.connectOuraIntegration);

// Get Oura connection status
router.get('/oura/status', authenticate, userController.getOuraConnectionStatus);

module.exports = router;