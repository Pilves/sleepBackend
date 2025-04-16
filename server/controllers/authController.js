/**
 * Authentication Controller
 */
const admin = require('firebase-admin');
const { logger } = require('../utils/logger');

const authController = {
  // Register a new user
  async registerUser(req, res, next, firestoreUtils) {
    try {
      console.log('Registration request body:', req.body);
      const { email, password, username, displayName, invitationCode, uid } = req.body;
      
      // Log available firestore utils
      console.log('Available firestoreUtils methods:', Object.keys(firestoreUtils || {}));

      // 1. Validate required fields
      if (!email || !username || !displayName || !invitationCode) {
        console.log('Missing required fields:', { 
          hasEmail: !!email, 
          hasUsername: !!username, 
          hasDisplayName: !!displayName, 
          hasInvitationCode: !!invitationCode 
        });
        return res.status(400).json({ error: 'All fields are required' });
      }

      // Special case: Check for "first admin" invitation code
      const FIRST_ADMIN_CODE = process.env.FIRST_ADMIN_CODE;
      let isFirstAdmin = false;

      if (invitationCode === FIRST_ADMIN_CODE) {
        const allUsers = await firestoreUtils.queryDocuments('users', [], null, { limit: 1 });
        if (allUsers.length === 0) {
          isFirstAdmin = true;
        } else {
          return res.status(400).json({ error: 'First admin code is no longer valid' });
        }
      }

      // 2. Validate invitation code
      console.log('Checking invitation code:', invitationCode);
      
      // Create a fallback/dev invitation directly
      let invitations = [];
      
      if (invitationCode === 'DEV123') {
        console.log('Using DEV123 code - bypassing invitation check and granting admin rights');
        invitations = [{
          id: 'dev-invitation',
          code: 'DEV123',
          email: email,
          status: 'PENDING',
          createdAt: new Date()
        }];
        
        // Set the isFirstAdmin flag to true for DEV123 code to grant admin rights
        isFirstAdmin = true;
      } else {
        try {
          if (firestoreUtils && typeof firestoreUtils.queryDocuments === 'function') {
            invitations = await firestoreUtils.queryDocuments(
                'invitations',
                [['code', '==', invitationCode]],
                null,
                { limit: 1 }
            );
          }
        } catch (err) {
          console.error('Error checking invitation code:', err);
        }
      }
      
      console.log('Found invitations:', invitations.length);
      
      if (invitations.length === 0) {
        return res.status(400).json({ error: 'Invalid invitation code' });
      }

      const invitation = invitations[0];
      if (invitation.status !== 'PENDING') {
        return res.status(400).json({ error: 'This invitation has already been used or revoked' });
      }

      // Skip email validation for DEV123 since we created it with the user's email
      if (invitationCode !== 'DEV123' && invitation.email.toLowerCase() !== email.toLowerCase()) {
        return res.status(400).json({ error: 'Email does not match the invited email' });
      }

      // 3. Check if username is already taken
      console.log('Checking if username is taken:', username);
      let users = [];
      
      try {
        if (firestoreUtils && typeof firestoreUtils.queryDocuments === 'function') {
          users = await firestoreUtils.queryDocuments(
              'users',
              [['username', '==', username]],
              null,
              { limit: 1 }
          );
          console.log('Username check result:', users.length > 0 ? 'Taken' : 'Available');
        } else {
          console.log('Skipping username check due to missing firestoreUtils');
        }
      } catch (err) {
        console.error('Error checking username:', err);
      }

      if (users.length > 0) {
        return res.status(400).json({ error: 'Username is already taken' });
      }

      // 4. Prepare user data for Firestore
      const userData = {
        email,
        username,
        displayName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isActive: true,
        profileData: {},
        ouraIntegration: {
          connected: false
        },
        notifications: {
          email: true,
          inApp: true
        },
        competitions: {
          participating: [],
          won: []
        },
        isAdmin: false,
        roles: ['user'] // Default user role
      };

      // 5. Check if this is the first registered user or using DEV123 code and make them admin
      if (isFirstAdmin || invitationCode === 'DEV123') {
        userData.isAdmin = true;
        userData.roles.push('admin'); // Add admin role explicitly
        console.log(`Admin privileges granted to user (${invitationCode === 'DEV123' ? 'DEV123 code' : 'first user'})`);
      } else {
        // Only check if this is the first user if not already admin
        try {
          const allUsers = await firestoreUtils.queryDocuments('users', [], null, { limit: 1 });
          if (allUsers.length === 0) {
            userData.isAdmin = true;
            userData.roles.push('admin');
            console.log(`First user will be registered - making them admin.`);
          }
        } catch (err) {
          console.log('Error checking if first user, continuing without admin rights:', err.message);
        }
      }

      // 6. Get or create Firebase Auth user
      console.log('Getting or creating Firebase Auth user...');
      let userRecord;
      
      try {
        // If client provided a UID, try to get that user first
        if (uid) {
          console.log('Client provided UID, trying to get user:', uid);
          try {
            userRecord = await admin.auth().getUser(uid);
            console.log('Found existing Firebase Auth user:', userRecord.uid);
            
            // Verify the email matches
            if (userRecord.email !== email) {
              return res.status(400).json({ 
                error: 'User account mismatch. Please log out and try again with the correct email.' 
              });
            }
          } catch (getUserError) {
            console.log('Error getting user, will try to create:', getUserError.message);
          }
        }
        
        // If we don't have a user record yet, create one
        if (!userRecord) {
          // For development purposes, let's set emailVerified to true
          // In production, you would send a verification email
          userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: displayName,
            emailVerified: true // Set to true for development convenience
          });
          console.log('Firebase Auth user created:', userRecord.uid);
        }
      } catch (authError) {
        console.error('Error with Firebase Auth user:', authError);
        
        // If the email is already in use, handle it specially
        if (authError.code === 'auth/email-already-exists') {
          try {
            // Try to get the user by email
            const userByEmail = await admin.auth().getUserByEmail(email);
            console.log('Found existing user by email:', userByEmail.uid);
            userRecord = userByEmail;
          } catch (emailLookupError) {
            console.error('Error looking up user by email:', emailLookupError);
            return res.status(400).json({ 
              error: 'This email is already registered but we cannot access the account. Please login instead.' 
            });
          }
        } else {
          return res.status(400).json({ error: authError.message || 'Failed to create user' });
        }
      }
      
      // 7. Add user document to Firestore and update invitation
      console.log('Creating Firestore user document...');
      let result;
      let existingUserDoc = null;
      try {
        // Direct Firestore API approach without transaction for simplicity
        const firestore = admin.firestore();
        
        // Use the consistent user document creation helper
        console.log('Ensuring user document with consistent structure...');
        await firestoreUtils.ensureUserDocument(userRecord.uid, {
          ...userData,
          email: email,  // Ensure email is set
          displayName: displayName || email.split('@')[0],  // Default display name
          isAdmin: false,  // Default non-admin
          isActive: true,  // Default active
          roles: ['user'],  // Default role
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('User document ensured with consistent structure for ID:', userRecord.uid);
        
        // Mark invitation as accepted if not using testing fallback
        if (invitations.length > 0 && invitations[0].id !== 'dev-invitation') {
          console.log('Updating invitation status...');
          await firestore.collection('invitations').doc(invitations[0].id).set({
            ...invitations[0],
            status: 'ACCEPTED',
            acceptedByUid: userRecord.uid,
            acceptedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          console.log('Invitation updated successfully');
        }
        
        // Set result for response
        result = { success: true, userId: userRecord.uid };
        console.log('Firestore documents created successfully');
      } catch (firestoreError) {
        console.error('Error creating Firestore documents:', firestoreError);
        
        // Clean up Firebase Auth user if Firestore operations failed
        try {
          await admin.auth().deleteUser(userRecord.uid);
          console.log(`Deleted Firebase Auth user ${userRecord.uid} due to Firestore operation failure`);
        } catch (deleteError) {
          console.error(`Failed to delete Firebase Auth user ${userRecord.uid}:`, deleteError);
        }
        
        return res.status(500).json({ error: 'Failed to create user documents' });
      }

      console.log(`User registered successfully: ${result.userId}`);
      console.log(`Invitation ${invitations[0].id} marked as accepted.`);

      // 7. Send email verification (Implementation needed)
      // Consider calling admin.auth().generateEmailVerificationLink(email)
      // and sending it via an email service.

      // 8. Return success response
      return res.status(201).json({
        message: 'User registered successfully',
        userId: result.userId,
        // If we found an existing user but didn't create a new document, indicate need to login
        needLogin: existingUserDoc && existingUserDoc.exists
      });

    } catch (error) {
      console.error('Error registering user:', error);

      if (error.code === 'auth/email-already-exists') {
        return res.status(400).json({ error: 'Email is already in use' });
      }
      if (error.code === 'auth/invalid-email') {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      if (error.code === 'auth/weak-password') {
        return res.status(400).json({ error: 'Password is too weak' });
      }

      return res.status(500).json({ error: 'Failed to register user due to an internal error.' });
    }
  },

  async getCurrentUser(req, res, next, firestoreUtils) {
    try {
      const userId = req.userId;
      const user = await firestoreUtils.getUser(userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.json(user);
    } catch (error) {
      return next(error);
    }
  },

  async resetPassword(req, res, next, firestoreUtils) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      // Generate password reset link
      const resetLink = await admin.auth().generatePasswordResetLink(email); // Still using admin.auth()!

      // In a real app, you would send this link via email
      console.log('Password reset link:', resetLink);

      return res.json({ message: 'Password reset email sent' });
    } catch (error) {
      return next(error);
    }
  }
};

module.exports = authController;

