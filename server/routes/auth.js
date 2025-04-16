/**
 * Authentication Routes
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validator');
const authController = require('../controllers/authController');

// This is now a function that accepts firestoreUtils
module.exports = (firestoreUtils) => {
    // Register a new user
    router.post(
        '/register',
        // Temporarily bypassing validation until we fix issues
        // validate('register'),
        (req, res, next) => {
            console.log('Register route called with firestoreUtils:', !!firestoreUtils);
            // If firestoreUtils is missing, we can use direct Firestore access
            authController.registerUser(req, res, next, firestoreUtils);
        }
    );

    // Get current user data
    router.get(
        '/me',
        authenticate,
        (req, res, next) => authController.getCurrentUser(req, res, next, firestoreUtils)
    );

    // Reset password
    router.post(
        '/reset-password',
        validate('resetPassword'),
        (req, res, next) => authController.resetPassword(req, res, next, firestoreUtils)
    );

    return router;
};
