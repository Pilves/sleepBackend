const express = require('express');
const { authenticate, isAdmin } = require('../middleware/auth');
const notificationController = require('../controllers/notificationController');

// Return a router function that accepts firestoreUtils
module.exports = (firestoreUtils) => {
  const router = express.Router();
  
  // Initialize the controller with firestoreUtils
  notificationController.init && notificationController.init(firestoreUtils);

  // Get user notifications with pagination
  router.get('/', authenticate, notificationController.getUserNotifications);

  // Mark a notification as read
  router.put('/:notificationId/read', authenticate, notificationController.markNotificationRead);

  // Mark all notifications as read
  router.put('/read-all', authenticate, notificationController.markAllNotificationsRead);

  // Get unread notification count
  router.get('/unread-count', authenticate, notificationController.getUnreadCount);

  // Delete a notification
  router.delete('/:notificationId', authenticate, notificationController.deleteNotification);

  // Admin routes
  // Create notification for a user
  router.post('/admin/create', authenticate, isAdmin, notificationController.createNotification);

  // Create notification for multiple users
  router.post('/admin/bulk-create', authenticate, isAdmin, notificationController.createBulkNotifications);

  return router;
};