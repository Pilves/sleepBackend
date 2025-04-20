const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const User = require('../model/User');
const { logger } = require('../utils/logger');
const ouraOAuth = require('../utils/ouraOAuth');
const admin = require('firebase-admin');

// We'll initialize this later with an init function
let firestoreUtils;

// Get user profile
const getUserProfile = async (req, res) => {

  try {
    const userId = req.userId;
    const user = await firestoreUtils.getUser(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Remove sensitive data before sending response
    const userData = { ...user };

    if (userData.ouraIntegration && userData.ouraIntegration.apiKeyHash) {
      delete userData.ouraIntegration.apiKeyHash;
    }
    
    // Add debug logs
    console.log('User profile request for user:', userId);
    console.log('User data being returned:', {
      isAdmin: userData.isAdmin,
      roles: userData.roles
    });

    // Make sure isAdmin is properly set based on roles
    if (userData.roles && userData.roles.includes('admin')) {
      userData.isAdmin = true;
    }
    
    // Return the user data with roles at the top level for easier access
    return res.status(200).json({ 
      user: userData,
      roles: userData.roles || ['user'],
      isAdmin: !!userData.isAdmin
    });
  } catch (error) {
    console.error('Error getting user profile:', error);
    return res.status(500).json({ error: 'Failed to retrieve user profile' });
  }
};

// Update user profile
const updateUserProfile = async (req, res) => {
  try {
    const userId = req.userId;
    const { username, displayName, profileData, notifications } = req.body;

    // Log the user ID and request data for debugging
    console.log(`Updating profile for user: ${userId}`);
    console.log('Profile update data:', { username, displayName, profileData, notifications });
    
    // First, make sure the user exists before attempting transaction
    const firestore = admin.firestore();
    const userRef = firestore.collection('users').doc(userId);
    const userSnapshot = await userRef.get();
    
    if (!userSnapshot.exists) {
      console.error(`User document does not exist: ${userId}`);
      
      // Create a basic user document if it doesn't exist using consistent helper
      try {
        await firestoreUtils.ensureUserDocument(userId, {
          username: username || userId.substring(0, 8),
          displayName: displayName || 'User',
          isAdmin: false,
          isActive: true,
          roles: ['user']
        });
        console.log(`Created missing user document for ${userId} with consistent structure`);
      } catch (createError) {
        console.error('Error creating user document:', createError);
        return res.status(500).json({ error: 'Failed to create user profile' });
      }
    }
    
    // Now update the user profile with a direct document update (not transaction)
    const updates = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // Update various fields if provided
    if (username) updates.username = username;
    if (displayName) updates.displayName = displayName;
    
    // Update profile data if provided
    if (profileData) {
      // Get current profile data or initialize new object
      const currentData = userSnapshot.exists ? 
        (userSnapshot.data().profileData || {}) : {};
      
      // Update profile data fields
      updates.profileData = {
        ...currentData,
        ...(profileData.aboutMe !== undefined && { aboutMe: profileData.aboutMe }),
        ...(profileData.gender !== undefined && { gender: profileData.gender }),
        ...(profileData.age !== undefined && { age: parseInt(profileData.age) || null })
      };
    }
    
    // Update notification settings if provided
    if (notifications) {
      // Get current notification settings or initialize new object
      const currentNotifications = userSnapshot.exists ? 
        (userSnapshot.data().notifications || { email: true, inApp: true }) : 
        { email: true, inApp: true };
      
      updates.notifications = {
        ...currentNotifications,
        ...(notifications.email !== undefined && { email: notifications.email }),
        ...(notifications.inApp !== undefined && { inApp: notifications.inApp })
      };
    }
    
    console.log('Applying profile updates:', updates);
    
    // Apply the updates
    await userRef.update(updates);
    console.log(`Updated profile for user ${userId}`);
    
    // Fetch the updated user to return in response
    const updatedUser = await firestoreUtils.getUser(userId);
    
    if (!updatedUser) {
      console.error(`User not found after update: ${userId}`);
      return res.status(404).json({ error: 'User not found after update' });
    }
    
    // Create response with updated fields
    const updatedData = {
      username: updatedUser.username,
      displayName: updatedUser.displayName,
      profileData: updatedUser.profileData,
      notifications: updatedUser.notifications
    };
    
    return res.status(200).json({ 
      message: 'Profile updated successfully', 
      updated: updatedData 
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    
    // Better error handling
    if (error.message && error.message.includes('User not found')) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    return res.status(500).json({ 
      error: 'Failed to update user profile',
      details: error.message 
    });
  }
};

// Get user notification preferences
const getNotificationPreferences = async (req, res) => {
  try {
    const userId = req.userId;
    const user = await firestoreUtils.getUser(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const notifications = user.notifications || { email: true, inApp: true };

    return res.status(200).json({ notifications });
  } catch (error) {
    console.error('Error getting notification preferences:', error);
    return res.status(500).json({ error: 'Failed to retrieve notification preferences' });
  }
};

// Update notification preferences
const updateNotificationPreferences = async (req, res) => {
  try {
    const userId = req.userId;
    const { email, inApp } = req.body;

    if (typeof email !== 'boolean' && typeof inApp !== 'boolean') {
      return res.status(400).json({ error: 'Invalid notification preferences' });
    }

    console.log(`Updating notification preferences for user: ${userId}`);
    
    // Use a transaction to update the notification preferences
    const firestore = admin.firestore();
    
    await firestore.runTransaction(async (transaction) => {
      // Get the user document reference
      const userRef = firestore.collection('users').doc(userId);
      const userDoc = await transaction.get(userRef);
      
      if (!userDoc.exists) {
        throw new Error(`User not found: ${userId}`);
      }
      
      // Get current user data
      const userData = userDoc.data();
      
      // Prepare updates for notifications
      const notifications = userData.notifications || { email: true, inApp: true };
      
      if (typeof email === 'boolean') notifications.email = email;
      if (typeof inApp === 'boolean') notifications.inApp = inApp;
      
      // Apply updates
      transaction.update(userRef, { notifications });
      console.log(`Updated notification preferences for user ${userId} in transaction`);
    });
    
    // Fetch the updated user to return in response
    const updatedUser = await firestoreUtils.getUser(userId);
    
    return res.status(200).json({ 
      message: 'Notification preferences updated', 
      updated: updatedUser.notifications || { email: true, inApp: true } 
    });
  } catch (error) {
    console.error('Error updating notification preferences:', error);
    
    // Better error handling
    if (error.message && error.message.includes('User not found')) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    return res.status(500).json({ error: 'Failed to update notification preferences' });
  }
};

// oura oauth flow
const initiateOuraOAuth = async (req, res) => {
  try {
    const userId = req.userId;
    const requestId = req.id;

    logger.info(`Initiating Oura OAuth flow for user: ${userId}`, { requestId });
    
    // Verify the user exists in Firestore before starting OAuth flow
    const firestore = admin.firestore();
    const userDoc = await firestore.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      logger.error(`User not found in Firestore before OAuth: ${userId}`, { requestId });
      
      // Verify this is a legitimate Firebase Auth user before creating a document
      try {
        logger.info(`Checking if user exists in Firebase Auth: ${userId}`, { requestId });
        const authUser = await admin.auth().getUser(userId);
        
        if (authUser) {
          // Create user document with proper data from Firebase Auth
          await firestoreUtils.ensureUserDocument(userId, {
            email: authUser.email || '',
            displayName: authUser.displayName || 'User',
            username: authUser.email ? authUser.email.split('@')[0] : userId.substring(0, 8),
            isAdmin: false,  // Default non-admin
            isActive: true,  // Default active
            roles: ['user']  // Default role
          });
          logger.info(`Created missing user document for Firebase Auth user: ${userId}`, { requestId });
        } else {
          // This shouldn't happen as we just verified the user exists in Auth
          throw new Error('User not found in Firebase Auth');
        }
      } catch (authError) {
        logger.error(`User not found in Firebase Auth: ${userId}`, { requestId, error: authError });
        return res.status(500).json({ error: 'Failed to prepare user account for OAuth - User not found in authentication system' });
      }
    }

    // Generate a state parameter for CSRF protection
    const stateObj = {
      userId,
      nonce: uuidv4(),
      timestamp: Date.now()
    };

    const state = Buffer.from(JSON.stringify(stateObj)).toString('base64');

    // This prevents CSRF attacks
    await firestore.collection('oauthStates').doc(state).set({
      userId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      expires: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    });

    // Generate authorization URL
    const authUrl = ouraOAuth.getAuthorizationUrl(state);

    logger.info(`Redirecting user ${userId} to Oura authorization`, { requestId });

    return res.status(200).json({
      authorizationUrl: authUrl
    });
  } catch (error) {
    logger.error('Error initiating Oura OAuth:', error);
    return res.status(500).json({ error: 'Failed to initiate Oura authorization' });
  }
};

// Handle Oura OAuth callback
const handleOuraOAuthCallback = async (req, res) => {
  try {
    const {code, state, error} = req.query;
    const requestId = req.id;

    // handle error
    if (error) {
      logger.error(`Oura OAuth error: ${error}`, { requestId });

      // redirect to frontend with error
      const redirectUrl = new URL(process.env.FRONTEND_URL);
      redirectUrl.searchParams.append('status', 'error');
      redirectUrl.searchParams.append('message', error);

      return res.redirect(redirectUrl.toString());
    }

    // Validate state parameter to prevent CSRF
    if (!state) {
      logger.error('Missing state parameter in OAuth callback', { requestId });

      // Redirect to frontend with error
      const redirectUrl = new URL(process.env.FRONTEND_URL);
      redirectUrl.searchParams.append('status', 'error');
      redirectUrl.searchParams.append('message', 'Invalid OAuth callback');

      return res.redirect(redirectUrl.toString());
    }

    // Get state from database
    const firestore = admin.firestore();
    const stateDoc = await firestore.collection('oauthStates').doc(state).get();

    if (!stateDoc.exists) {
      logger.error('Invalid or expired state in OAuth callback', { requestId });

      // Redirect to frontend with error
      const redirectUrl = new URL(process.env.FRONTEND_URL);
      redirectUrl.searchParams.append('status', 'error');
      redirectUrl.searchParams.append('message', 'Invalid or expired authorization session');

      return res.redirect(redirectUrl.toString());
    }

    // Check if state is expired
    const stateData = stateDoc.data();
    if (new Date() > stateData.expires.toDate()) {
      logger.error('Expired state in OAuth callback', { requestId });

      // Delete expired state
      await firestore.collection('oauthStates').doc(state).delete();

      // Redirect to frontend with error
      const redirectUrl = new URL(process.env.FRONTEND_URL);
      redirectUrl.searchParams.append('status', 'error');
      redirectUrl.searchParams.append('message', 'Authorization session expired');

      return res.redirect(redirectUrl.toString());
    }

    // Get user ID from state
    const userId = stateData.userId;

    // Log the user ID we're about to process
    logger.info(`Processing Oura OAuth callback for user: ${userId}`, { requestId });
    
    // Verify this is a legitimate Firebase Auth UID
    if (userId.length < 20) {
      logger.error(`Invalid userId format in OAuth state: ${userId} - length: ${userId.length}`, { requestId });
      const redirectUrl = new URL(process.env.FRONTEND_URL);
      redirectUrl.searchParams.append('status', 'error');
      redirectUrl.searchParams.append('message', 'Invalid user identification');
      return res.redirect(redirectUrl.toString());
    }
    
    // Log the userId format for debugging ID issues
    logger.info(`OAuth callback processing for userId: ${userId} (length: ${userId.length})`, { requestId });

    // Exchange authorization code for tokens
    console.log(`Exchanging authorization code for tokens for user: ${userId}`);
    const tokenResponse = await ouraOAuth.exchangeCodeForToken(code);
    console.log('Token exchange successful, got tokens:', Object.keys(tokenResponse));
    
    // Log token response details (without exposing actual tokens)
    console.log('Token response details:', {
      expires_in: tokenResponse.expires_in,
      token_type: tokenResponse.token_type,
      has_access_token: !!tokenResponse.access_token,
      has_refresh_token: !!tokenResponse.refresh_token,
      user_id: tokenResponse.user_id || 'not available'
    });

    // Encrypt tokens for storage
    console.log('Encrypting tokens for storage');
    const encryptedAccessToken = ouraOAuth.encryptData(tokenResponse.access_token);
    const encryptedRefreshToken = ouraOAuth.encryptData(tokenResponse.refresh_token);
    console.log('Tokens encrypted successfully');

    // Update user's Oura integration - use a transaction for atomic update
    console.log(`Getting user ${userId} from Firestore to update Oura integration`);
    
    try {
      const firestore = admin.firestore();
      
      // Verify the user exists before attempting transaction
      const userRef = firestore.collection('users').doc(userId);
      const userDocSnapshot = await userRef.get();
      
      // Log user document details for debugging
      logger.info(`Checked existence of user ${userId} before transaction`, { 
        exists: userDocSnapshot.exists,
        requestId
      });
      
      if (!userDocSnapshot.exists) {
        logger.error(`User not found before transaction: ${userId}`, { requestId });
        
        // Instead of creating a new user document, check if this is a Firebase Auth user
        try {
          logger.info(`Checking if user exists in Firebase Auth: ${userId}`, { requestId });
          const authUser = await admin.auth().getUser(userId);
          
          if (authUser) {
            logger.info(`User exists in Firebase Auth but not in Firestore: ${userId}`, { requestId });
            // Create user document with proper data from Firebase Auth
            await firestoreUtils.ensureUserDocument(userId, {
              email: authUser.email || '',
              displayName: authUser.displayName || 'User',
              username: authUser.email ? authUser.email.split('@')[0] : userId.substring(0, 8),
              isAdmin: false,  // Default non-admin
              isActive: true,  // Default active
              roles: ['user']  // Default role
            });
            logger.info(`Created missing user document for Firebase Auth user: ${userId}`, { requestId });
          } else {
            // This shouldn't happen as we just verified the user exists in Auth
            throw new Error('User not found in Firebase Auth');
          }
        } catch (authError) {
          logger.error(`User not found in Firebase Auth: ${userId}`, { requestId, error: authError });
          const redirectUrl = new URL(process.env.FRONTEND_URL);
          redirectUrl.searchParams.append('status', 'error');
          redirectUrl.searchParams.append('message', 'User account not found');
          return res.redirect(redirectUrl.toString());
        }
      }
      
      // Use a transaction to ensure we don't create duplicates
      await firestore.runTransaction(async (transaction) => {
        // Get the user document in the transaction
        const userDoc = await transaction.get(userRef);
        
        if (!userDoc.exists) {
          logger.error(`User not found in transaction: ${userId}`, { requestId });
          throw new Error(`User not found: ${userId}`);
        }
        
        // Get the user data
        const userData = userDoc.data();
        console.log(`Found user ${userId} in Firestore, proceeding with Oura integration update`);
        
        // Check if user has existing Oura integration
        if (userData.ouraIntegration && userData.ouraIntegration.connected) {
          logger.info(`User ${userId} already has Oura connected, will replace with new token`, { requestId });
          
          // Clean up the user's previous Oura data (optional - include any cleanup logic here)
          // For example: Delete any existing sleep data tied to old token
          
          // Log the disconnection of the old token
          logger.info(`Disconnecting previous Oura integration for user ${userId}`, { requestId });
        }
        
        // Create Oura integration object with required fields
        // Calculate expiration time - subtract 5 minutes for safety margin
        const expiresInMs = (tokenResponse.expires_in - 300) * 1000; // 5 minutes safety margin
        const expiryDate = new Date(Date.now() + expiresInMs);
        
        // Get the existing user data from the current transaction
        const currentUserData = userDoc.data();
        
        // Create updated Oura integration object, preserving any existing fields
        const ouraIntegration = {
          ...(currentUserData.ouraIntegration || {}),
          connected: true,
          lastSyncDate: currentUserData.ouraIntegration?.lastSyncDate || null,
          connectedAt: new Date(),
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          expiresAt: expiryDate,
          lastRefreshed: new Date(),
          tokenInvalid: false,
          appUserId: userId // Explicitly store our app's user ID to ensure correct association
        };
        
        logger.info(`Setting Oura token expiry for user ${userId} to ${expiryDate.toISOString()}`, { requestId });
        
        // Add Oura's user_id field (rename to ouraUserId for clarity)
        if (tokenResponse.user_id) {
          ouraIntegration.ouraUserId = tokenResponse.user_id; // Oura's user ID
          logger.info(`Stored Oura's user_id (${tokenResponse.user_id}) as ouraUserId for app user ${userId}`, { requestId });
        }
        
        // Update the user document in the transaction (update just the ouraIntegration object)
        // Importantly, don't overwrite any other fields like roles or isAdmin
        transaction.update(userRef, {
          ouraIntegration: ouraIntegration,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`Updated user ${userId} with Oura integration in transaction`);
      });
      
      console.log(`Successfully completed transaction for user ${userId}`);
    } catch (error) {
      logger.error(`User not found or error in transaction: ${userId}`, { requestId, error });
      console.error(`Failed to find/update user ${userId} in Firestore:`, error);

      // Redirect to frontend with error
      const redirectUrl = new URL(process.env.FRONTEND_URL);
      redirectUrl.searchParams.append('status', 'error');
      redirectUrl.searchParams.append('message', error.message || 'User not found or could not be updated');

      return res.redirect(redirectUrl.toString());
    }

    // Delete used state from database
    await firestore.collection('oauthStates').doc(state).delete();
    console.log(`Deleted OAuth state from database`);

    logger.info(`Oura integration connected successfully for user: ${userId}`, { requestId });

    // Redirect to frontend with success
    const redirectUrl = new URL(process.env.FRONTEND_URL);
    redirectUrl.searchParams.append('status', 'success');
    redirectUrl.pathname = '/profile'; // Adjust to your frontend route

    return res.redirect(redirectUrl.toString());
  } catch (error) {
    logger.error('Error handling Oura OAuth callback:', error);

    // Redirect to frontend with error
    const redirectUrl = new URL(process.env.FRONTEND_URL);
    redirectUrl.searchParams.append('status', 'error');
    redirectUrl.searchParams.append('message', 'Failed to complete Oura authorization');

    return res.redirect(redirectUrl.toString());
  }
};


const getOuraConnectionStatus = async (req, res) => {
  try {
    const userId = req.userId;
    const user = await firestoreUtils.getUser(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const ouraIntegration = user.ouraIntegration || { connected: false };

    // Don't include the tokens in the response
    const safeOuraData = {
      connected: ouraIntegration.connected || false,
      lastSyncDate: ouraIntegration.lastSyncDate,
      connectedAt: ouraIntegration.connectedAt
    };

    return res.status(200).json(safeOuraData);
  } catch (error) {
    logger.error('Error getting Oura connection status:', error);
    return res.status(500).json({ error: 'Failed to retrieve Oura connection status' });
  }
};


const disconnectOuraIntegration = async (req, res) => {
  try {
    const userId = req.userId;
    console.log(`Disconnecting Oura integration for user: ${userId}`);
    
    // Use a transaction to disconnect Oura integration
    const firestore = admin.firestore();
    
    await firestore.runTransaction(async (transaction) => {
      // Get the user document reference
      const userRef = firestore.collection('users').doc(userId);
      const userDoc = await transaction.get(userRef);
      
      if (!userDoc.exists) {
        throw new Error(`User not found: ${userId}`);
      }
      
      // Set ouraIntegration to disconnected
      transaction.update(userRef, {
        ouraIntegration: {
          connected: false
        }
      });
      
      console.log(`Disconnected Oura integration for user ${userId} in transaction`);
    });

    return res.status(200).json({
      message: 'Oura integration disconnected successfully',
      status: 'disconnected'
    });
  } catch (error) {
    logger.error('Error disconnecting Oura integration:', error);
    
    // Better error handling
    if (error.message && error.message.includes('User not found')) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    return res.status(500).json({ error: 'Failed to disconnect Oura integration' });
  }
};


// Function to initialize the controller with dependencies
const init = (fsUtils) => {
  firestoreUtils = fsUtils;
};

// Get all users (admin only)
const getAllUsers = async (req, res) => {
  try {
    console.log('Getting all users');
    
    // Query all users from Firestore
    const firestore = admin.firestore();
    const usersSnapshot = await firestore.collection('users').get();
    
    if (usersSnapshot.empty) {
      console.log('No users found');
      return res.status(200).json([]);
    }
    
    // Convert Firestore documents to User models
    const users = usersSnapshot.docs.map(doc => {
      const userData = doc.data();
      userData.id = doc.id; // Ensure ID is included
      
      // Create a User instance with sanitized data
      const user = new User(userData);
      
      // Remove sensitive data before sending response
      if (user.ouraIntegration && user.ouraIntegration.apiKeyHash) {
        delete user.ouraIntegration.apiKeyHash;
      }
      if (user.ouraIntegration && user.ouraIntegration.accessToken) {
        delete user.ouraIntegration.accessToken;
      }
      if (user.ouraIntegration && user.ouraIntegration.refreshToken) {
        delete user.ouraIntegration.refreshToken;
      }
      
      return user;
    });
    
    console.log(`Found ${users.length} users`);
    return res.status(200).json(users);
  } catch (error) {
    console.error('Error getting all users:', error);
    return res.status(500).json({ error: 'Failed to retrieve users' });
  }
};

// Update user status (active/inactive)
const updateUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body;
    
    if (typeof status !== 'boolean') {
      return res.status(400).json({ error: 'Status must be a boolean' });
    }
    
    console.log(`Updating status for user ${userId} to ${status}`);
    
    // Update user status in Firestore
    const firestore = admin.firestore();
    const userRef = firestore.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    await userRef.update({
      isActive: status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return res.status(200).json({ 
      message: 'User status updated successfully',
      userId,
      status
    });
  } catch (error) {
    console.error('Error updating user status:', error);
    return res.status(500).json({ error: 'Failed to update user status' });
  }
};

// Add admin role to user
const addAdminRole = async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`Adding admin role to user ${userId}`);
    
    // Update user roles in Firestore
    const firestore = admin.firestore();
    const userRef = firestore.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    const currentRoles = userData.roles || ['user'];
    
    if (currentRoles.includes('admin')) {
      return res.status(200).json({ 
        message: 'User already has admin role',
        userId
      });
    }
    
    const updatedRoles = [...currentRoles, 'admin'];
    
    await userRef.update({
      roles: updatedRoles,
      isAdmin: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return res.status(200).json({ 
      message: 'Admin role added successfully',
      userId,
      roles: updatedRoles
    });
  } catch (error) {
    console.error('Error adding admin role:', error);
    return res.status(500).json({ error: 'Failed to add admin role' });
  }
};

// Remove admin role from user
const removeAdminRole = async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`Removing admin role from user ${userId}`);
    
    // Update user roles in Firestore
    const firestore = admin.firestore();
    const userRef = firestore.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    const currentRoles = userData.roles || ['user'];
    
    if (!currentRoles.includes('admin')) {
      return res.status(200).json({ 
        message: 'User does not have admin role',
        userId
      });
    }
    
    const updatedRoles = currentRoles.filter(role => role !== 'admin');
    
    await userRef.update({
      roles: updatedRoles,
      isAdmin: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return res.status(200).json({ 
      message: 'Admin role removed successfully',
      userId,
      roles: updatedRoles
    });
  } catch (error) {
    console.error('Error removing admin role:', error);
    return res.status(500).json({ error: 'Failed to remove admin role' });
  }
};

module.exports = {
  init,
  getUserProfile,
  updateUserProfile,
  getNotificationPreferences,
  updateNotificationPreferences,
  initiateOuraOAuth,
  handleOuraOAuthCallback,
  getOuraConnectionStatus,
  disconnectOuraIntegration,
  getAllUsers,
  updateUserStatus,
  addAdminRole,
  removeAdminRole
};
