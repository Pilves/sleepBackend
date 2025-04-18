/**
 * Firestore Utilities
 * Helper functions for working with Firestore and our models
 */
// Import firebase admin
const admin = require('firebase-admin');

// Import models
const User = require('../model/User');
const Competition = require('../model/Competition');
const SleepData = require('../model/SleepData');
const SleepSummary = require('../model/SleepSummary');
const Leaderboard = require('../model/Leaderboard');
const Notification = require('../model/Notification');
const Invitation = require('../model/Invitation');

// This is now a function that accepts firestore
module.exports = (firestore) => {

  /**
   * Generic get document function
   * @param {string} collection - Firestore collection name
   * @param {string} id - Document ID
   * @param {Function} modelClass - Model class to use for conversion
   * @returns {Promise<Object>} Model instance or null if not found
   */
  async function getDocument(collection, id, modelClass) {
    try {
      const docRef = firestore.collection(collection).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        return null;
      }

      return modelClass.fromFirestore(doc);
    } catch (error) {
      console.error(`Error getting ${collection} document:`, error);
      throw error;
    }
  }
  
  /**
   * Ensures a document exists with default values if it doesn't already exist
   * @param {string} collection - Firestore collection name
   * @param {string} id - Document ID
   * @param {Object} defaultData - Default data for the document if it doesn't exist
   * @returns {Promise<string>} The document ID
   */
  async function ensureDocumentExists(collection, id, defaultData = {}) {
    try {
      const docRef = firestore.collection(collection).doc(id);
      const doc = await docRef.get();
      
      if (!doc.exists) {
        console.log(`Document ${id} in ${collection} doesn't exist, creating with defaults`);
        await docRef.set(defaultData);
      }
      
      return id;
    } catch (error) {
      console.error(`Error ensuring document exists in ${collection}:`, error);
      throw error;
    }
  }
  
  /**
   * Safely gets a subcollection, ensuring parent documents exist and are properly linked
   * @param {string} parentCollection - Parent collection name
   * @param {string} parentId - Parent document ID
   * @param {string} subcollection - Subcollection name
   * @param {Object} defaultParentData - Default data for parent if it doesn't exist
   * @param {boolean} validateUserExists - Whether to validate that the user exists
   * @returns {FirebaseFirestore.CollectionReference} Reference to the subcollection
   */
  async function ensureSubcollection(parentCollection, parentId, subcollection, defaultParentData = {}, validateUserExists = true) {
    try {
      // First check if this is attempting to link to a user
      if (validateUserExists && parentId && (
          parentCollection === 'sleepData' || 
          parentCollection === 'notifications'
      )) {
        // Check if user exists before creating related documents
        const userDoc = await firestore.collection('users').doc(parentId).get();
        
        if (!userDoc.exists) {
          console.warn(`Warning: Attempting to create ${parentCollection} document for non-existent user: ${parentId}`);
          throw new Error(`User ${parentId} not found when creating ${parentCollection} document`);
        }
        
        // For certain collections, ensure we have proper linkage data
        if (!defaultParentData.userId) {
          defaultParentData.userId = parentId;
        }
        
        if (!defaultParentData.linkedAt) {
          defaultParentData.linkedAt = admin.firestore.FieldValue.serverTimestamp();
        }
      }
      
      // Now ensure the parent document exists
      await ensureDocumentExists(parentCollection, parentId, defaultParentData);
      
      // Return the subcollection reference (Firestore creates subcollections implicitly)
      return firestore.collection(parentCollection).doc(parentId).collection(subcollection);
    } catch (error) {
      console.error(`Error ensuring subcollection ${subcollection} for ${parentCollection}/${parentId}:`, error);
      throw error;
    }
  }

  /**
   * Generic save document function
   * @param {string} collection - Firestore collection name
   * @param {Object} model - Model instance with toFirestore method
   * @returns {Promise<string>} Document ID
   */
  async function saveDocument(collection, model) {
    try {
      // Check if model has toFirestore method
      if (typeof model.toFirestore !== 'function') {
        console.warn(`Warning: Model for ${collection} does not have toFirestore method, using object directly`);
        
        // If no toFirestore method, try to use the object directly
        const data = { ...model };
        
        // Remove the id from the data if it exists (as it should be the document ID)
        if (data.id) {
          const { id, ...rest } = data;
          
          // Update existing document
          await firestore.collection(collection).doc(id).set(rest, { 
            merge: true,
            // Allow for undefined fields to be removed from the document
            ignoreUndefinedProperties: true
          });
          return id;
        } else {
          // Create new document
          const docRef = await firestore.collection(collection).add(data);
          return docRef.id;
        }
      } else {
        // Use the toFirestore method to get data
        const data = model.toFirestore();
        
        if (model.id) {
          // Update existing document
          await firestore.collection(collection).doc(model.id).set(data, { 
            merge: true,
            // Allow for undefined fields to be removed from the document
            ignoreUndefinedProperties: true
          });
          return model.id;
        } else {
          // Create new document
          const docRef = await firestore.collection(collection).add(data);
          return docRef.id;
        }
      }
    } catch (error) {
      console.error(`Error saving ${collection} document:`, error);
      throw error;
    }
  }

  /**
   * Generic query documents function
   * @param {string} collection - Firestore collection name
   * @param {Array} queryConditions - Array of condition arrays [field, operator, value]
   * @param {Function} modelClass - Model class to use for conversion
   * @param {Object} options - Query options (limit, orderBy, orderDirection)
   * @returns {Promise<Array>} Array of model instances
   */
  async function queryDocuments(collection, queryConditions = [], modelClass, options = {}) {
    try {
      let query = firestore.collection(collection);

      // Apply query conditions
      queryConditions.forEach(condition => {
        const [field, operator, value] = condition;
        query = query.where(field, operator, value);
      });

      // Apply ordering
      if (options.orderBy) {
        const direction = options.orderDirection || 'asc';
        query = query.orderBy(options.orderBy, direction);
      }

      // Apply limit
      if (options.limit) {
        query = query.limit(options.limit);
      }

      const snapshot = await query.get();

      return snapshot.docs.map(doc => modelClass.fromFirestore(doc));
    } catch (error) {
      console.error(`Error querying ${collection} documents:`, error);
      throw error;
    }
  }

  /**
   * Generic delete document function
   * @param {string} collection - Firestore collection name
   * @param {string} id - Document ID
   * @returns {Promise<boolean>} Success status
   */
  async function deleteDocument(collection, id) {
    try {
      await firestore.collection(collection).doc(id).delete();
      return true;
    } catch (error) {
      console.error(`Error deleting ${collection} document:`, error);
      throw error;
    }
  }

  // Model-specific functions
  async function getUser(id) {
    return getDocument('users', id, User);
  }

  async function getUserByEmail(email) {
    const users = await queryDocuments('users', [['email', '==', email]], User);
    return users.length > 0 ? users[0] : null;
  }

  async function getUserByUsername(username) {
    const users = await queryDocuments('users', [['username', '==', username]], User);
    return users.length > 0 ? users[0] : null;
  }

  /**
   * Creates or updates a user document with standardized structure
   * This function helps ensure consistency in user documents
   * @param {string} userId - The user ID
   * @param {Object} userData - User data to save
   * @param {boolean} merge - Whether to merge with existing data
   * @returns {Promise<string>} User ID
   */
  async function ensureUserDocument(userId, userData = {}, merge = true) {
    try {
      console.log(`Ensuring user document for: ${userId}`);
      
      if (!userId) {
        throw new Error('User ID is required');
      }
      
      // Get user reference
      const userRef = firestore.collection('users').doc(userId);
      const userDoc = await userRef.get();
      
      // Handle existing users differently to preserve critical fields
      if (userDoc.exists) {
        console.log(`User document already exists for: ${userId}, updating carefully`);
        
        // Get current user data to preserve important fields
        const existingData = userDoc.data();
        
        // Create update data by carefully merging
        const updateData = {
          ...userData,
          id: userId,
          // Preserve existing roles and admin status if they exist and not explicitly provided
          roles: userData.roles || existingData.roles || ['user'],
          isAdmin: userData.isAdmin !== undefined ? userData.isAdmin : existingData.isAdmin,
          // Always update timestamp
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        // Special handling for Oura integration to prevent overwriting entire object
        if (userData.ouraIntegration && existingData.ouraIntegration) {
          updateData.ouraIntegration = {
            ...existingData.ouraIntegration,
            ...userData.ouraIntegration
          };
        }
        
        // Update the document, merging with existing data
        await userRef.set(updateData, { merge: true });
        console.log(`Updated existing user document for: ${userId}`);
      } else {
        // Creating a new user document
        console.log(`Creating new user document for: ${userId}`);
        
        // Set standard properties for new users
        const standardizedData = {
          ...userData,
          id: userId, // Ensure ID field is always set
          createdAt: userData.createdAt || admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          roles: userData.roles || ['user'], // Default role
          isActive: userData.isActive !== undefined ? userData.isActive : true, // Default active status
          ouraIntegration: userData.ouraIntegration || { connected: false },
          notifications: userData.notifications || { email: true, inApp: true }
        };
        
        // Create the document
        await userRef.set(standardizedData);
        console.log(`Created new user document for: ${userId}`);
      }
      
      return userId;
    } catch (error) {
      console.error(`Error ensuring user document for ${userId}:`, error);
      throw error;
    }
  }

  async function saveUser(user) {
    // If user has an ID, use ensureUserDocument for consistency
    if (user.id) {
      return ensureUserDocument(user.id, user.toFirestore ? user.toFirestore() : user);
    }
    
    // Otherwise use generic document save
    return saveDocument('users', user);
  }

  // ... (Other model-specific functions) ...

  // Invitation functions
  async function getInvitationByCode(code) {
    try {
      console.log(`Searching for invitation by code: ${code}`);
      const invitations = await queryDocuments('invitations', [['code', '==', code]], Invitation);
      console.log(`Found ${invitations.length} invitations for code ${code}`);
      return invitations.length > 0 ? invitations[0] : null;
    } catch (error) {
      console.error('Error getting invitation by code:', error);
      throw error;
    }
  }

  async function saveInvitation(invitation) {
    try {
      console.log(`Saving invitation for ${invitation.email}`);
      return await saveDocument('invitations', invitation);
    } catch (error) {
      console.error('Error saving invitation:', error);
      throw error;
    }
  }
  
  async function getAllInvitations(status = null) {
    try {
      const conditions = [];
      if (status) {
        conditions.push(['status', '==', status]);
      }
      
      console.log(`Fetching all invitations with conditions:`, conditions);
      const invitations = await queryDocuments('invitations', conditions, Invitation);
      console.log(`Found ${invitations.length} invitations`);
      return invitations;
    } catch (error) {
      console.error('Error getting all invitations:', error);
      throw error;
    }
  }
  
  /**
   * Gets sleep data for a specific user and date
   * @param {string} userId - User ID
   * @param {string} dateId - Date ID in YYYY-MM-DD format
   * @returns {Promise<Object>} Sleep data or null if not found
   */
  async function getSleepData(userId, dateId) {
    try {
      // Ensure the sleepData collection and user document exist
      await ensureSubcollection('sleepData', userId, 'daily', {
        userId,
        created: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Get the sleep data document
      const docRef = firestore
        .collection('sleepData')
        .doc(userId)
        .collection('daily')
        .doc(dateId);
      
      const doc = await docRef.get();
      
      if (!doc.exists) {
        // Return default empty sleep data with the date
        return {
          userId,
          dateId,
          date: new Date(dateId),
          ouraScore: 0,
          metrics: {
            totalSleepTime: 0,
            efficiency: 0,
            deepSleep: 0,
            remSleep: 0,
            lightSleep: 0
          },
          tags: [],
          notes: ''
        };
      }
      
      return SleepData.fromFirestore(doc);
    } catch (error) {
      console.error(`Error getting sleep data for user ${userId} on date ${dateId}:`, error);
      throw error;
    }
  }
  
  /**
   * Gets sleep data for a user within a date range
   * @param {string} userId - User ID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Array>} Array of sleep data objects
   */
  async function getSleepDataRange(userId, startDate, endDate) {
    try {
      // Ensure the sleepData collection and user document exist
      const sleepDataRef = await ensureSubcollection('sleepData', userId, 'daily', {
        userId,
        created: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Query sleep data within the date range
      const snapshot = await sleepDataRef
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .orderBy('date', 'asc')
        .get();
      
      if (snapshot.empty) {
        console.log(`No sleep data found for user ${userId} in date range`);
        return [];
      }
      
      return snapshot.docs.map(doc => SleepData.fromFirestore(doc));
    } catch (error) {
      console.error(`Error getting sleep data range for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get competition by ID
   * @param {string} id - Competition ID
   * @returns {Promise<Object>} Competition or null if not found
   */
  async function getCompetition(id) {
    return getDocument('competitions', id, Competition);
  }

  /**
   * Save competition to Firestore
   * @param {Object} competition - Competition model instance
   * @returns {Promise<string>} Competition ID
   */
  async function saveCompetition(competition) {
    return saveDocument('competitions', competition);
  }

  /**
   * Get the latest leaderboard for a competition
   * @param {string} competitionId - Competition ID
   * @returns {Promise<Object>} Leaderboard or null if not found
   */
  async function getLatestLeaderboard(competitionId) {
    try {
      const leaderboardsRef = firestore
        .collection('leaderboards')
        .where('competitionId', '==', competitionId)
        .orderBy('timestamp', 'desc')
        .limit(1);
      
      const snapshot = await leaderboardsRef.get();
      
      if (snapshot.empty) {
        return null;
      }
      
      return Leaderboard.fromFirestore(snapshot.docs[0]);
    } catch (error) {
      console.error(`Error getting latest leaderboard for competition ${competitionId}:`, error);
      throw error;
    }
  }

  /**
   * Gets all users from the database
   * @returns {Promise<Array>} Array of User objects
   */
  async function getAllUsers() {
    try {
      console.log('Fetching all users from Firestore');
      const users = await queryDocuments('users', [], User);
      console.log(`Found ${users.length} users`);
      return users;
    } catch (error) {
      console.error('Error getting all users:', error);
      throw error;
    }
  }

  return {
    getDocument,
    saveDocument,
    queryDocuments,
    deleteDocument,
    getUser,
    getUserByEmail,
    getUserByUsername,
    saveUser,
    ensureUserDocument,
    getInvitationByCode,
    saveInvitation,
    getAllInvitations,
    ensureDocumentExists,
    ensureSubcollection,
    getSleepData,
    getSleepDataRange,
    getCompetition,
    saveCompetition,
    getLatestLeaderboard,
    getAllUsers
  };
};
