const admin = require('firebase-admin');
const User = require('../model/User');
const firestoreUtils = require('../utils/firestoreUtils');

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

    return res.status(200).json({ user: userData });
  } catch (error) {
    console.error('Error getting user profile:', error);
    return res.status(500).json({ error: 'Failed to retrieve user profile' });
  }
};

// Update user profile
const updateUserProfile = async (req, res) => {
  try {
    const userId = req.userId;
    const { displayName, profileData } = req.body;

    // Get existing user
    const user = await firestoreUtils.getUser(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update fields
    if (displayName) user.displayName = displayName;

    if (profileData) {
      // Only allow certain profile fields to be updated
      user.profileData = user.profileData || {};

      if (profileData.gender) user.profileData.gender = profileData.gender;
      if (profileData.age) user.profileData.age = parseInt(profileData.age);
      if (profileData.aboutMe) user.profileData.aboutMe = profileData.aboutMe;
      if (profileData.profilePicture) user.profileData.profilePicture = profileData.profilePicture;
    }

    // Save updates
    await firestoreUtils.saveUser(user);

    // Create response with updated fields
    const updatedData = {
      displayName: user.displayName,
      profileData: user.profileData
    };

    return res.status(200).json({ message: 'Profile updated successfully', updated: updatedData });
  } catch (error) {
    console.error('Error updating user profile:', error);
    return res.status(500).json({ error: 'Failed to update user profile' });
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

    // Get existing user
    const user = await firestoreUtils.getUser(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update preferences
    user.notifications = user.notifications || { email: true, inApp: true };

    if (typeof email === 'boolean') user.notifications.email = email;
    if (typeof inApp === 'boolean') user.notifications.inApp = inApp;

    // Save updates
    await firestoreUtils.saveUser(user);

    return res.status(200).json({ message: 'Notification preferences updated', updated: user.notifications });
  } catch (error) {
    console.error('Error updating notification preferences:', error);
    return res.status(500).json({ error: 'Failed to update notification preferences' });
  }
};

// Connect Oura integration
const connectOuraIntegration = async (req, res) => {
  try {
    const userId = req.userId;
    const { apiKey } = req.body;

    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }

    // Get existing user
    const user = await firestoreUtils.getUser(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Here you would validate the API key with Oura API
    // For now, we'll assume it's valid

    // Update Oura integration
    user.ouraIntegration = user.ouraIntegration || {};
    user.ouraIntegration.connected = true;
    user.ouraIntegration.lastSyncDate = new Date();
    user.ouraIntegration.apiKeyHash = 'secure-hash-of-api-key'; // In reality, use proper secure storage

    // Save updates
    await firestoreUtils.saveUser(user);

    return res.status(200).json({
      message: 'Oura ring connected successfully',
      status: 'connected'
    });
  } catch (error) {
    console.error('Error connecting Oura integration:', error);
    return res.status(500).json({ error: 'Failed to connect Oura integration' });
  }
};

// Get Oura connection status
const getOuraConnectionStatus = async (req, res) => {
  try {
    const userId = req.userId;
    const user = await firestoreUtils.getUser(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const ouraIntegration = user.ouraIntegration || { connected: false };

    // Don't include the API key hash in the response
    const safeOuraData = { ...ouraIntegration };
    delete safeOuraData.apiKeyHash;

    return res.status(200).json({ ouraIntegration: safeOuraData });
  } catch (error) {
    console.error('Error getting Oura connection status:', error);
    return res.status(500).json({ error: 'Failed to retrieve Oura connection status' });
  }
};

module.exports = {
  getUserProfile,
  updateUserProfile,
  getNotificationPreferences,
  updateNotificationPreferences,
  connectOuraIntegration,
  getOuraConnectionStatus
};
