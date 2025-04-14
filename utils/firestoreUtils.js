/**
 * Firestore Utilities
 * Helper functions for working with Firestore and our models
 */
const admin = require('firebase-admin');


// Import models
const User = require('../model/User');
const Competition = require('../model/Competition');
const SleepData = require('../model/SleepData');
const SleepSummary = require('../model/SleepSummary');
const Leaderboard = require('../model/Leaderboard');
const Notification = require('../model/Notification');
const Invitation = require('../model/Invitation');

/**
 * Generic get document function
 * @param {string} collection - Firestore collection name
 * @param {string} id - Document ID
 * @param {Function} modelClass - Model class to use for conversion
 * @returns {Promise<Object>} Model instance or null if not found
 */
async function getDocument(collection, id, modelClass) {
  const firestore = admin.firestore();
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
 * Generic save document function
 * @param {string} collection - Firestore collection name
 * @param {Object} model - Model instance with toFirestore method
 * @returns {Promise<string>} Document ID
 */
async function saveDocument(collection, model) {
  const firestore = admin.firestore();
  try {
    const data = model.toFirestore();

    if (model.id) {
      // Update existing document
      await firestore.collection(collection).doc(model.id).set(data, { merge: true });
      return model.id;
    } else {
      // Create new document
      const docRef = await firestore.collection(collection).add(data);
      return docRef.id;
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
  const firestore = admin.firestore();
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
  const firestore = admin.firestore();
  try {
    await firestore.collection(collection).doc(id).delete();
    return true;
  } catch (error) {
    console.error(`Error deleting ${collection} document:`, error);
    throw error;
  }
}

// Model-specific functions

// User functions
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

async function saveUser(user) {
  return saveDocument('users', user);
}

// Sleep data functions
async function getSleepData(userId, dateId) {
  const sleepDatas = await queryDocuments(
    'sleepData',
    [['userId', '==', userId], ['dateId', '==', dateId]],
    SleepData
  );
  return sleepDatas.length > 0 ? sleepDatas[0] : null;
}

async function getSleepDataRange(userId, startDate, endDate) {
  const startDateString = SleepData.generateDateId(startDate);
  const endDateString = SleepData.generateDateId(endDate);

  return queryDocuments(
    'sleepData',
    [
      ['userId', '==', userId],
      ['dateId', '>=', startDateString],
      ['dateId', '<=', endDateString]
    ],
    SleepData,
    { orderBy: 'dateId' }
  );
}

async function saveSleepData(sleepData) {
  return saveDocument('sleepData', sleepData);
}

// Sleep summary functions
async function getSleepSummary(userId) {
  const summaries = await queryDocuments('sleepSummaries', [['userId', '==', userId]], SleepSummary);
  return summaries.length > 0 ? summaries[0] : null;
}

async function saveSleepSummary(summary) {
  return saveDocument('sleepSummaries', summary);
}

// Competition functions
async function getCompetition(id) {
  return getDocument('competitions', id, Competition);
}

async function getCompetitionsByStatus(status) {
  return queryDocuments('competitions', [['status', '==', status]], Competition);
}

async function getUserCompetitions(userId) {
  return queryDocuments('competitions', [['participants', 'array-contains', userId]], Competition);
}

async function saveCompetition(competition) {
  return saveDocument('competitions', competition);
}

// Leaderboard functions
async function getLatestLeaderboard(competitionId) {
  const leaderboards = await queryDocuments(
    'leaderboards',
    [['competitionId', '==', competitionId], ['isLatest', '==', true]],
    Leaderboard
  );
  return leaderboards.length > 0 ? leaderboards[0] : null;
}

async function saveLeaderboard(leaderboard) {
  const firestore = admin.firestore();
  // If this is the latest leaderboard, mark all other leaderboards as not latest
  if (leaderboard.isLatest) {
    const batch = firestore.batch();

    const oldLeaderboardsSnapshot = await firestore
      .collection('leaderboards')
      .where('competitionId', '==', leaderboard.competitionId)
      .where('isLatest', '==', true)
      .get();

    oldLeaderboardsSnapshot.docs.forEach(doc => {
      batch.update(doc.ref, { isLatest: false });
    });

    await batch.commit();
  }

  return saveDocument('leaderboards', leaderboard);
}

// Notification functions
async function getUserNotifications(userId, limit = 10, offset = 0, unreadOnly = false) {
  let queryConditions = [['userId', '==', userId]];

  if (unreadOnly) {
    queryConditions.push(['read', '==', false]);
  }

  return queryDocuments(
    'notifications',
    queryConditions,
    Notification,
    { orderBy: 'createdAt', orderDirection: 'desc', limit }
  );
}

async function saveNotification(notification) {
  return saveDocument('notifications', notification);
}

// Invitation functions
async function getInvitationByCode(code) {
  const invitations = await queryDocuments('invitations', [['code', '==', code]], Invitation);
  return invitations.length > 0 ? invitations[0] : null;
}

async function saveInvitation(invitation) {
  return saveDocument('invitations', invitation);
}

module.exports = {
  // Generic functions
  getDocument,
  saveDocument,
  queryDocuments,
  deleteDocument,

  // User functions
  getUser,
  getUserByEmail,
  getUserByUsername,
  saveUser,

  // Sleep data functions
  getSleepData,
  getSleepDataRange,
  saveSleepData,

  // Sleep summary functions
  getSleepSummary,
  saveSleepSummary,

  // Competition functions
  getCompetition,
  getCompetitionsByStatus,
  getUserCompetitions,
  saveCompetition,

  // Leaderboard functions
  getLatestLeaderboard,
  saveLeaderboard,

  // Notification functions
  getUserNotifications,
  saveNotification,

  // Invitation functions
  getInvitationByCode,
  saveInvitation
};
