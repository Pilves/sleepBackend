/**
 * Invitation Controller
 * Handles invitation-related API endpoints
 */
const admin = require('firebase-admin');
const moment = require('moment');
const { logger } = require('../utils/logger');

// Import models
const Invitation = require('../model/Invitation');
const firestoreUtils = require('../utils/firestoreUtils');

/**
 * Admin only: Create an invitation
 */
const createInvitation = async (req, res) => {
  try {
    const { email } = req.body;
    const adminUserId = req.userId;
    const requestId = req.id;

    logger.info(`Admin ${adminUserId} creating invitation for: ${email}`, { requestId });

    // Check if email already has an active invitation
    const existingInvitations = await firestoreUtils.queryDocuments(
      'invitations',
      [
        ['email', '==', email],
        ['status', '==', 'PENDING']
      ],
      Invitation
    );

    if (existingInvitations.length > 0) {
      logger.warn(`Email ${email} already has active invitation`, { requestId });
      return res.status(400).json({
        error: 'This email already has an active invitation',
        invitationId: existingInvitations[0].id,
        requestId
      });
    }

    // Create expiration date (30 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Create invitation model
    const invitation = new Invitation({
      email,
      status: 'PENDING',
      createdAt: new Date(),
      expiresAt,
      invitedBy: adminUserId,
      code: Invitation.generateCode()
    });

    // Validate the invitation
    const validation = invitation.validate();
    if (!validation.valid) {
      logger.warn('Invitation validation failed', { errors: validation.errors, requestId });
      return res.status(400).json({
        error: 'Invalid invitation data',
        details: validation.errors,
        requestId
      });
    }

    // Save to Firestore
    const invitationId = await firestoreUtils.saveInvitation(invitation);

    logger.info(`Invitation created successfully for ${email}`, {
      invitationId,
      requestId,
      adminUserId
    });

    return res.status(201).json({
      message: 'Invitation created successfully',
      invitationId,
      invitationCode: invitation.code
    });
  } catch (error) {
    logger.error('Error creating invitation:', error);
    return res.status(500).json({
      error: 'Failed to create invitation',
      message: error.message,
      requestId: req.id
    });
  }
};

/**
 * Admin only: Get all invitations
 */
const getAllInvitations = async (req, res) => {
  try {
    const { status } = req.query; // 'PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', or undefined for all
    const requestId = req.id;

    logger.info(`Getting invitations with status: ${status || 'all'}`, { requestId });

    // Define filter conditions
    const conditions = [];
    if (status) {
      conditions.push(['status', '==', status.toUpperCase()]);
    }

    // Get invitations from Firestore
    const invitations = await firestoreUtils.queryDocuments(
      'invitations',
      conditions,
      Invitation,
      { orderBy: 'createdAt', orderDirection: 'desc' }
    );

    logger.info(`Retrieved ${invitations.length} invitations`, { requestId });
    return res.status(200).json({ invitations });
  } catch (error) {
    logger.error('Error getting invitations:', error);
    return res.status(500).json({
      error: 'Failed to retrieve invitations',
      message: error.message,
      requestId: req.id
    });
  }
};

/**
 * Admin only: Revoke an invitation
 */
const revokeInvitation = async (req, res) => {
  try {
    const { invitationId } = req.params;
    const adminUserId = req.userId;
    const requestId = req.id;

    logger.info(`Admin ${adminUserId} revoking invitation: ${invitationId}`, { requestId });

    // Get the invitation
    const invitation = await firestoreUtils.getDocument('invitations', invitationId, Invitation);

    if (!invitation) {
      logger.warn(`Invitation not found: ${invitationId}`, { requestId });
      return res.status(404).json({
        error: 'Invitation not found',
        requestId
      });
    }

    if (invitation.status !== 'PENDING') {
      logger.warn(`Cannot revoke invitation with status: ${invitation.status}`, { requestId });
      return res.status(400).json({
        error: `Cannot revoke invitation with status: ${invitation.status}`,
        requestId
      });
    }

    // Update status
    invitation.status = 'EXPIRED';

    // Save to Firestore
    await firestoreUtils.saveInvitation(invitation);

    logger.info(`Invitation ${invitationId} revoked successfully`, { requestId, adminUserId });
    return res.status(200).json({
      message: 'Invitation revoked successfully',
      email: invitation.email
    });
  } catch (error) {
    logger.error(`Error revoking invitation ${req.params.invitationId}:`, error);
    return res.status(500).json({
      error: 'Failed to revoke invitation',
      message: error.message,
      requestId: req.id
    });
  }
};

/**
 * Validate invitation code (public endpoint)
 */
const validateInvitationCode = async (req, res) => {
  try {
    const { code } = req.params;
    const requestId = req.id;

    if (!code) {
      logger.warn('Missing invitation code', { requestId });
      return res.status(400).json({
        valid: false,
        error: 'Invitation code is required',
        requestId
      });
    }

    logger.info(`Validating invitation code: ${code}`, { requestId });

    // Get the invitation by code
    const invitation = await firestoreUtils.getInvitationByCode(code);

    if (!invitation) {
      logger.warn(`Invalid invitation code: ${code}`, { requestId });
      return res.status(404).json({
        valid: false,
        error: 'Invalid invitation code',
        requestId
      });
    }

    // Check if expired or already used
    if (invitation.status !== 'PENDING') {
      logger.warn(`Invitation has status: ${invitation.status}`, { requestId, code });
      return res.status(400).json({
        valid: false,
        error: 'This invitation has already been used or revoked',
        requestId
      });
    }

    // Check expiration date
    if (new Date() > invitation.expiresAt) {
      logger.warn(`Invitation has expired`, { requestId, code });

      // Update status to expired
      invitation.status = 'EXPIRED';
      await firestoreUtils.saveInvitation(invitation);

      return res.status(400).json({
        valid: false,
        error: 'This invitation has expired',
        requestId
      });
    }

    logger.info(`Invitation code ${code} is valid for ${invitation.email}`, { requestId });
    return res.status(200).json({
      valid: true,
      email: invitation.email,
      expiresAt: invitation.expiresAt
    });
  } catch (error) {
    logger.error(`Error validating invitation code ${req.params.code}:`, error);
    return res.status(500).json({
      valid: false,
      error: 'Failed to validate invitation code',
      message: error.message,
      requestId: req.id
    });
  }
};

/**
 * Mark invitation as accepted (used during registration)
 */
const acceptInvitation = async (req, res) => {
  try {
    const { code } = req.body;
    const requestId = req.id;

    if (!code) {
      logger.warn('Missing invitation code', { requestId });
      return res.status(400).json({
        error: 'Invitation code is required',
        requestId
      });
    }

    logger.info(`Accepting invitation with code: ${code}`, { requestId });

    // Get the invitation by code
    const invitation = await firestoreUtils.getInvitationByCode(code);

    if (!invitation) {
      logger.warn(`Invalid invitation code: ${code}`, { requestId });
      return res.status(404).json({
        error: 'Invalid invitation code',
        requestId
      });
    }

    // Check if expired or already used
    if (invitation.status !== 'PENDING') {
      logger.warn(`Invitation has status: ${invitation.status}`, { requestId, code });
      return res.status(400).json({
        error: 'This invitation has already been used or revoked',
        requestId
      });
    }

    // Check expiration date
    if (new Date() > invitation.expiresAt) {
      logger.warn(`Invitation has expired`, { requestId, code });

      // Update status to expired
      invitation.status = 'EXPIRED';
      await firestoreUtils.saveInvitation(invitation);

      return res.status(400).json({
        error: 'This invitation has expired',
        requestId
      });
    }

    // Update status
    if (!invitation.accept()) {
      logger.warn(`Failed to accept invitation: ${code}`, { requestId });
      return res.status(400).json({
        error: 'Failed to accept invitation',
        requestId
      });
    }

    // Save to Firestore
    await firestoreUtils.saveInvitation(invitation);

    logger.info(`Invitation accepted successfully for ${invitation.email}`, { requestId });
    return res.status(200).json({
      message: 'Invitation accepted successfully',
      email: invitation.email
    });
  } catch (error) {
    logger.error('Error accepting invitation:', error);
    return res.status(500).json({
      error: 'Failed to accept invitation',
      message: error.message,
      requestId: req.id
    });
  }
};

module.exports = {
  createInvitation,
  getAllInvitations,
  revokeInvitation,
  validateInvitationCode,
  acceptInvitation
};
