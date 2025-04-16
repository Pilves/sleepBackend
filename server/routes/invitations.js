const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validator');
const invitationsController = require('../controllers/invitationController');

module.exports = (firestoreUtils) => {
    // Initialize controller
    const controller = invitationsController(firestoreUtils);
    
    // Create invitation
    router.post('/', authenticate, validate('createInvitation'), (req, res) =>
        controller.createInvitation(req, res)
    );

    // Get all invitations
    router.get('/', authenticate, (req, res) =>
        controller.getAllInvitations(req, res)
    );

    // Revoke invitation
    router.delete('/:invitationId', authenticate, (req, res) =>
        controller.revokeInvitation(req, res)
    );

    // Validate invitation code
    router.get('/validate/:code', (req, res) =>
        controller.validateInvitationCode(req, res)
    );

    // Accept invitation
    router.post('/accept', (req, res) =>
        controller.acceptInvitation(req, res)
    );

    return router;
};
