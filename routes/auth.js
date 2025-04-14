/**
 * Authentication Routes
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validator');
const authController = require('../controllers/authController');

// Register a new user
router.post('/register', 
  validate('register'),
  authController.registerUser
);

// Get current user data
router.get('/me', 
  authenticate, 
  authController.getCurrentUser
);

// Reset password
router.post('/reset-password',
  validate('resetPassword'),
  authController.resetPassword
);

module.exports = router;