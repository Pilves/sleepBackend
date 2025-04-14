const admin = require('firebase-admin');

// Register a new user
const registerUser = async (req, res) => {
  const db = admin.firestore();
  let invitationDocId = null; // Variable to store the doc ID for regular codes
  let isSpecialCode = false; // Flag for the special code

  try {
    const { email, password, username, displayName, invitationCode } = req.body;

    // 1. Validate required fields
    if (!email || !password || !username || !displayName || !invitationCode) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // 2. Check for the special invitation code OR validate regular codes
    if (invitationCode === '111111') {
      console.log("Special invitation code '111111' used."); // Optional logging
      isSpecialCode = true;
      // Skip Firestore validation for this special code
    } else {
      // --- Regular invitation code validation ---
      const invitationsSnapshot = await db
          .collection('invitations')
          .where('code', '==', invitationCode)
          .limit(1)
          .get();

      if (invitationsSnapshot.empty) {
        return res.status(400).json({ error: 'Invalid invitation code' });
      }

      const invitation = invitationsSnapshot.docs[0].data();
      invitationDocId = invitationsSnapshot.docs[0].id; // Store the ID

      if (invitation.status !== 'sent') {
        return res.status(400).json({ error: 'This invitation has already been used or revoked' });
      }

      // Optional: You might want to keep or remove this email check depending on your requirements
      // If you want '1111' to bypass email checks but regular codes still need it: keep it here.
      if (invitation.email.toLowerCase() !== email.toLowerCase()) {
        return res.status(400).json({ error: 'Email does not match the invited email' });
      }
      // --- End of regular validation ---
    }

    // 3. Check if username is already taken (applies to both special and regular codes)
    const usernameCheckSnapshot = await db
        .collection('users')
        .where('username', '==', username)
        .limit(1)
        .get();

    if (!usernameCheckSnapshot.empty) {
      return res.status(400).json({ error: 'Username is already taken' });
    }

    // 4. Create Firebase Auth user
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: displayName,
      emailVerified: false // Assuming default is false, verification email sent separately
    });

    // 5. Create Firestore user document
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
      }
      // You might want to add a field indicating how the user was registered
      // registrationMethod: isSpecialCode ? 'special_invite' : 'standard_invite'
    };

    await db.collection('users').doc(userRecord.uid).set(userData);

    // 6. Mark regular invitation as accepted (ONLY if it wasn't the special code)
    if (!isSpecialCode && invitationDocId) {
      await db
          .collection('invitations')
          .doc(invitationDocId) // Use the stored ID
          .update({
            status: 'accepted',
            acceptedByUid: userRecord.uid, // Good practice to link who accepted it
            acceptedAt: admin.firestore.FieldValue.serverTimestamp() // Good practice to timestamp
          });
      console.log(`Invitation ${invitationDocId} marked as accepted.`); // Optional logging
    }

    // 7. Send email verification (Implementation needed)
    // Consider calling admin.auth().generateEmailVerificationLink(email)
    // and sending it via an email service.

    // 8. Return success response
    return res.status(201).json({
      message: 'User registered successfully',
      userId: userRecord.uid
    });

  } catch (error) {
    console.error('Error registering user:', error); // Log the detailed error on the server

    // Handle specific Firebase Auth errors
    if (error.code === 'auth/email-already-exists') {
      return res.status(400).json({ error: 'Email is already in use' });
    }
    if (error.code === 'auth/invalid-email') {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (error.code === 'auth/weak-password') {
      return res.status(400).json({ error: 'Password is too weak' });
    }

    // Generic error for other issues
    return res.status(500).json({ error: 'Failed to register user due to an internal error.' });
  }
};

// --- getCurrentUser and resetPassword functions remain the same ---

const getCurrentUser = async (req, res) => {
  const db = admin.firestore();
  try {
    const userId = req.userId; // Assuming req.userId is populated by auth middleware

    // Get user data from Firestore
    const userDoc = await db.collection('users').doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userDoc.data();

    // Remove sensitive data if necessary (example shown)
    const { ouraIntegration: { apiKeyHash, ...ouraIntegrationData } = {}, ...safeUserData } = userData;

    if (userData.ouraIntegration) {
      safeUserData.ouraIntegration = ouraIntegrationData;
    }

    return res.status(200).json({ user: safeUserData });
  } catch (error) {
    console.error('Error getting current user:', error);
    return res.status(500).json({ error: 'Failed to retrieve user data' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Generate password reset link
    const resetLink = await admin.auth().generatePasswordResetLink(email);

    // In a real app, you would send this link via email
    console.log('Password reset link:', resetLink); // Log for debugging/dev

    return res.status(200).json({
      message: 'Password reset email sent', // Standard message for security
      debug: process.env.NODE_ENV === 'development' ? { resetLink } : undefined // Only show link in dev
    });
  } catch (error) {
    console.error('Error sending password reset:', error);

    if (error.code === 'auth/user-not-found') {
      // Don't reveal if email exists for security reasons
      return res.status(200).json({ message: 'If your email is registered, a password reset link will be sent' });
    }
    if (error.code === 'auth/invalid-email') {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    return res.status(500).json({ error: 'Failed to send password reset email' });
  }
};


module.exports = {
  registerUser,
  getCurrentUser,
  resetPassword
};
