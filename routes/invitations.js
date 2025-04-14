const express = require('express');
const router = express.Router();
const { authenticate, isAdmin } = require('../middleware/auth');
const invitationController = require('../controllers/invitationController');

// Public routes
// Validate invitation code
router.get('/validate/:code', invitationController.validateInvitationCode);

// Accept invitation (used during registration)
router.post('/accept', invitationController.acceptInvitation);

// Admin routes
// Create an invitation
router.post('/', authenticate, isAdmin, invitationController.createInvitation);

// Get all invitations
router.get('/', authenticate, isAdmin, invitationController.getAllInvitations);

// Revoke an invitation
router.put('/:invitationId/revoke', authenticate, isAdmin, invitationController.revokeInvitation);

module.exports = router;