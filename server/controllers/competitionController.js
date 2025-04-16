/**
 * Competition Controller
 * Handles competition-related API endpoints
 */
const admin = require('firebase-admin');
const moment = require('moment');
const { logger } = require('../utils/logger');

// Import models
const Competition = require('../model/Competition');
const Leaderboard = require('../model/Leaderboard');
const firestoreUtilsFactory = require('../utils/firestoreUtils');

// Initialize with Firestore
let firestoreUtils;

/**
 * Get all competitions, optionally filtered by status
 */
const getCompetitions = async (req, res) => {
  try {
    const { status } = req.query; // "active", "upcoming", "completed", or undefined for all
    const requestId = req.id;

    logger.info(`Getting competitions with status: ${status || 'all'}`, { requestId });

    // Define filter conditions
    const conditions = [];
    if (status) {
      conditions.push(['status', '==', status.toUpperCase()]);
    }

    // Get competitions from Firestore
    const competitions = await firestoreUtils.queryDocuments(
      'competitions',
      conditions,
      Competition,
      { orderBy: 'startDate' }
    );

    logger.info(`Retrieved ${competitions.length} competitions`, { requestId });
    return res.status(200).json({ competitions });
  } catch (error) {
    logger.error('Error getting competitions:', error);
    return res.status(500).json({
      error: 'Failed to retrieve competitions',
      message: error.message,
      requestId: req.id
    });
  }
};

/**
 * Get a specific competition by ID
 */
const getCompetition = async (req, res) => {
  try {
    const { competitionId } = req.params;
    const requestId = req.id;

    logger.info(`Getting competition: ${competitionId}`, { requestId });

    const competition = await firestoreUtils.getCompetition(competitionId);

    if (!competition) {
      logger.warn(`Competition not found: ${competitionId}`, { requestId });
      return res.status(404).json({
        error: 'Competition not found',
        requestId
      });
    }

    return res.status(200).json({ competition });
  } catch (error) {
    logger.error(`Error getting competition ${req.params.competitionId}:`, error);
    return res.status(500).json({
      error: 'Failed to retrieve competition',
      message: error.message,
      requestId: req.id
    });
  }
};

/**
 * Join a competition
 */
const joinCompetition = async (req, res) => {
  try {
    const userId = req.userId;
    const { competitionId } = req.params;
    const requestId = req.id;

    logger.info(`User ${userId} joining competition: ${competitionId}`, { requestId });

    // Get the competition
    const competition = await firestoreUtils.getCompetition(competitionId);

    if (!competition) {
      logger.warn(`Competition not found: ${competitionId}`, { requestId });
      return res.status(404).json({
        error: 'Competition not found',
        requestId
      });
    }

    // Check if competition is active or upcoming
    if (competition.status === 'COMPLETED') {
      logger.warn(`Cannot join completed competition: ${competitionId}`, { requestId, userId });
      return res.status(400).json({
        error: 'Cannot join a completed competition',
        requestId
      });
    }

    // Check if user is already a participant
    if (competition.participants && competition.participants.includes(userId)) {
      logger.warn(`User ${userId} already in competition: ${competitionId}`, { requestId });
      return res.status(400).json({
        error: 'You are already a participant in this competition',
        requestId
      });
    }

    // Check eligibility criteria if defined
    if (competition.rules && competition.rules.eligibilityCriteria) {
      const criteria = competition.rules.eligibilityCriteria;

      // Check user's sleep data if minimum tracked nights required
      if (criteria.minimumTrackedNights) {
        logger.info(`Checking minimum tracked nights: ${criteria.minimumTrackedNights}`, { requestId, userId });

        // Get the sleepData using firestoreUtils
        const sleepDataCollection = await firestoreUtils.ensureSubcollection(
          'sleepData', 
          userId, 
          'daily', 
          { userId, created: new Date() }
        );
        
        const sleepDataSnapshot = await sleepDataCollection.get();
        const sleepDataCount = sleepDataSnapshot.size;

        if (sleepDataCount < criteria.minimumTrackedNights) {
          logger.warn(`User ${userId} does not meet minimum tracked nights requirement`, { requestId });
          return res.status(400).json({
            error: `You need at least ${criteria.minimumTrackedNights} tracked nights to join this competition`,
            requestId
          });
        }
      }

      // Check user tenure if required
      if (criteria.minimumTenureDays) {
        logger.info(`Checking minimum tenure days: ${criteria.minimumTenureDays}`, { requestId, userId });

        const user = await firestoreUtils.getUser(userId);

        if (!user) {
          logger.warn(`User not found: ${userId}`, { requestId });
          return res.status(404).json({
            error: 'User not found',
            requestId
          });
        }

        const createdAt = moment(user.createdAt);
        const daysSinceCreation = moment().diff(createdAt, 'days');

        if (daysSinceCreation < criteria.minimumTenureDays) {
          logger.warn(`User ${userId} does not meet minimum tenure requirement`, { requestId });
          return res.status(400).json({
            error: `You need to be a member for at least ${criteria.minimumTenureDays} days to join this competition`,
            requestId
          });
        }
      }
    }

    // Get the Firestore instance from firestoreUtils
    const firestore = admin.firestore();
    
    // Use transaction to ensure consistency
    await firestore.runTransaction(async (transaction) => {
      logger.info(`Starting transaction to join competition ${competitionId}`, { requestId });
      
      // Add user to competition participants
      const competitionRef = firestore.collection('competitions').doc(competitionId);

      // Add competition to user's participating competitions
      const userRef = firestore.collection('users').doc(userId);
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists) {
        logger.error(`User ${userId} not found during join transaction`, { requestId });
        throw new Error('User not found');
      }

      // Get current participating competitions
      const userData = userDoc.data();
      let participating = [];

      if (userData.competitions && userData.competitions.participating) {
        participating = [...userData.competitions.participating];
      }

      // Add new competition ID if not already in the list
      if (!participating.includes(competitionId)) {
        participating.push(competitionId);
      }

      logger.info(`Adding user ${userId} to competition ${competitionId} participants`, { requestId });
      
      // Update competition document
      transaction.update(competitionRef, {
        participants: admin.firestore.FieldValue.arrayUnion(userId)
      });

      // Update user document
      transaction.update(userRef, {
        'competitions.participating': participating
      });
      
      logger.info(`Transaction completed successfully`, { requestId });
    });

    logger.info(`User ${userId} successfully joined competition ${competitionId}`, { requestId });
    return res.status(200).json({
      message: 'Successfully joined the competition',
      competitionId
    });
  } catch (error) {
    logger.error(`Error joining competition ${req.params.competitionId}:`, error);
    return res.status(500).json({
      error: 'Failed to join competition',
      message: error.message,
      requestId: req.id
    });
  }
};

/**
 * Leave a competition
 */
const leaveCompetition = async (req, res) => {
  try {
    const userId = req.userId;
    const { competitionId } = req.params;
    const requestId = req.id;

    logger.info(`User ${userId} leaving competition: ${competitionId}`, { requestId });

    // Get the competition
    const competition = await firestoreUtils.getCompetition(competitionId);

    if (!competition) {
      logger.warn(`Competition not found: ${competitionId}`, { requestId });
      return res.status(404).json({
        error: 'Competition not found',
        requestId
      });
    }

    // Check if competition is active or upcoming
    if (competition.status === 'COMPLETED') {
      logger.warn(`Cannot leave completed competition: ${competitionId}`, { requestId, userId });
      return res.status(400).json({
        error: 'Cannot leave a completed competition',
        requestId
      });
    }

    // Check if user is a participant
    if (!competition.participants || !competition.participants.includes(userId)) {
      logger.warn(`User ${userId} not in competition: ${competitionId}`, { requestId });
      return res.status(400).json({
        error: 'You are not a participant in this competition',
        requestId
      });
    }

    // Get the Firestore instance
    const firestore = admin.firestore();

    // Use transaction to ensure consistency
    await firestore.runTransaction(async (transaction) => {
      logger.info(`Starting transaction to leave competition ${competitionId}`, { requestId });
      
      // Remove user from competition participants
      const competitionRef = firestore.collection('competitions').doc(competitionId);

      // Remove competition from user's participating competitions
      const userRef = firestore.collection('users').doc(userId);
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists) {
        logger.error(`User ${userId} not found during leave transaction`, { requestId });
        throw new Error('User not found');
      }

      // Get current participating competitions
      const userData = userDoc.data();
      let participating = [];

      if (userData.competitions && userData.competitions.participating) {
        participating = userData.competitions.participating.filter(id => id !== competitionId);
        logger.info(`Removing competition ${competitionId} from user ${userId} participating list`, 
          { requestId, before: userData.competitions.participating.length, after: participating.length });
      }

      // Update competition document
      transaction.update(competitionRef, {
        participants: admin.firestore.FieldValue.arrayRemove(userId)
      });

      // Update user document
      transaction.update(userRef, {
        'competitions.participating': participating
      });
      
      logger.info(`Leave transaction completed successfully`, { requestId });
    });

    logger.info(`User ${userId} successfully left competition ${competitionId}`, { requestId });
    return res.status(200).json({
      message: 'Successfully left the competition',
      competitionId
    });
  } catch (error) {
    logger.error(`Error leaving competition ${req.params.competitionId}:`, error);
    return res.status(500).json({
      error: 'Failed to leave competition',
      message: error.message,
      requestId: req.id
    });
  }
};

/**
 * Get leaderboard for a competition
 */
const getLeaderboard = async (req, res) => {
  try {
    const { competitionId } = req.params;
    const requestId = req.id;

    logger.info(`Getting leaderboard for competition: ${competitionId}`, { requestId });

    // Get the latest leaderboard for this competition
    const leaderboard = await firestoreUtils.getLatestLeaderboard(competitionId);

    if (!leaderboard) {
      logger.warn(`Leaderboard not found for competition: ${competitionId}`, { requestId });
      return res.status(404).json({
        error: 'Leaderboard not found or not yet generated',
        requestId
      });
    }

    return res.status(200).json({ leaderboard });
  } catch (error) {
    logger.error(`Error getting leaderboard for competition ${req.params.competitionId}:`, error);
    return res.status(500).json({
      error: 'Failed to retrieve leaderboard',
      message: error.message,
      requestId: req.id
    });
  }
};

/**
 * Get user's competitions
 */
const getUserCompetitions = async (req, res) => {
  try {
    const userId = req.userId;
    const requestId = req.id;

    logger.info(`Getting competitions for user: ${userId}`, { requestId });

    // Get user document to get participating competitions
    const user = await firestoreUtils.getUser(userId);

    if (!user) {
      logger.warn(`User not found: ${userId}`, { requestId });
      return res.status(404).json({
        error: 'User not found',
        requestId
      });
    }

    const participatingIds = user.competitions?.participating || [];
    const wonIds = user.competitions?.won || [];

    logger.info(`User ${userId} has ${participatingIds.length} participating and ${wonIds.length} won competitions`, { requestId });

    // Get all participating competitions
    const participating = [];

    for (const id of participatingIds) {
      const competition = await firestoreUtils.getCompetition(id);
      if (competition) {
        participating.push(competition);
      }
    }

    // Get all won competitions
    const won = [];

    for (const id of wonIds) {
      const competition = await firestoreUtils.getCompetition(id);
      if (competition) {
        won.push(competition);
      }
    }

    return res.status(200).json({
      competitions: {
        participating,
        won
      }
    });
  } catch (error) {
    logger.error(`Error getting competitions for user ${req.userId}:`, error);
    return res.status(500).json({
      error: 'Failed to retrieve user competitions',
      message: error.message,
      requestId: req.id
    });
  }
};

/**
 * Admin only: Create a new competition
 */
const createCompetition = async (req, res) => {
  try {
    const {
      title,
      description,
      type,
      startDate,
      endDate,
      status,
      rules,
      prizes
    } = req.body;
    const requestId = req.id;
    
    // Log the request for debugging
    logger.info(`Create competition request:`, { 
      title, description, type, startDate, endDate, status, 
      body: JSON.stringify(req.body).substring(0, 200),
      requestId
    });
    
    // Log the raw request body types for debugging
    logger.info(`Request body types:`, {
      titleType: typeof title,
      descriptionType: typeof description,
      typeType: typeof type,
      startDateType: typeof startDate, 
      startDateValue: startDate,
      endDateType: typeof endDate,
      endDateValue: endDate,
      statusType: typeof status,
      statusValue: status,
      requestId
    });

    logger.info('Creating new competition', { requestId });

    // Create dates - ensure they're valid Date objects
    let start, end;
    try {
      start = new Date(startDate);
      end = new Date(endDate);
      
      // Validate the dates
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new Error("Invalid date format");
      }
    } catch (error) {
      logger.error('Error parsing competition dates:', error);
      return res.status(400).json({
        error: 'Invalid date format',
        message: error.message,
        requestId
      });
    }

    // Determine status based on dates if not provided
    const now = new Date();
    let computedStatus;

    if (status) {
      // Use provided status, convert to uppercase if needed
      computedStatus = typeof status === 'string' ? status.toUpperCase() : status;
      
      // If status is lowercase, convert to uppercase
      if (computedStatus === 'upcoming') computedStatus = 'PENDING';
      if (computedStatus === 'active') computedStatus = 'ACTIVE';
      if (computedStatus === 'completed') computedStatus = 'COMPLETED';
    } else {
      // Infer status from dates
      if (start > now) {
        computedStatus = 'PENDING';
      } else if (end > now) {
        computedStatus = 'ACTIVE';
      } else {
        computedStatus = 'COMPLETED';
      }
    }

    // Create competition model
    const competition = new Competition({
      title,
      description,
      type,
      startDate: start,
      endDate: end,
      status: computedStatus,
      rules: rules || {},
      prizes: prizes || [],
      participants: [],
      winners: []
    });

    // Validate the competition
    const validation = competition.validate();
    if (!validation.valid) {
      logger.warn('Competition validation failed', { 
        errors: validation.errors, 
        competition: JSON.stringify(competition), 
        requestId 
      });
      
      // Return a detailed error message
      return res.status(400).json({
        error: 'Invalid competition data',
        message: 'Competition validation failed with the following errors: ' + validation.errors.join(', '),
        details: validation.errors,
        data: {
          receivedTitle: title,
          receivedDescription: description,
          receivedType: type,
          receivedStartDate: startDate,
          receivedEndDate: endDate,
          receivedStatus: status
        },
        requestId
      });
    }

    // Save to Firestore
    const competitionId = await firestoreUtils.saveCompetition(competition);

    logger.info(`Competition created successfully with ID: ${competitionId}`, { requestId });
    return res.status(201).json({
      message: 'Competition created successfully',
      competitionId
    });
  } catch (error) {
    logger.error('Error creating competition:', error);
    return res.status(500).json({
      error: 'Failed to create competition',
      message: error.message,
      requestId: req.id
    });
  }
};

/**
 * Admin only: Update competition
 */
const updateCompetition = async (req, res) => {
  try {
    const { competitionId } = req.params;
    const {
      title,
      description,
      type,
      startDate,
      endDate,
      rules,
      prizes
    } = req.body;
    const requestId = req.id;

    logger.info(`Updating competition: ${competitionId}`, { requestId });

    // Get the existing competition
    const competition = await firestoreUtils.getCompetition(competitionId);

    if (!competition) {
      logger.warn(`Competition not found: ${competitionId}`, { requestId });
      return res.status(404).json({
        error: 'Competition not found',
        requestId
      });
    }
    
    // Log the request for debugging
    logger.info(`Update competition request:`, { 
      title, description, type, startDate, endDate, status, 
      rules: JSON.stringify(rules || {}).substring(0, 100) + "...",
      requestId
    });

    // Don't allow updating if competition is completed
    if (competition.status === 'COMPLETED') {
      logger.warn(`Cannot update completed competition: ${competitionId}`, { requestId });
      return res.status(400).json({
        error: 'Cannot update a completed competition',
        requestId
      });
    }

    // Update fields
    if (title) competition.title = title;
    if (description) competition.description = description;
    if (type) competition.type = type;
    
    // Handle dates
    try {
      if (startDate) {
        const parsedStartDate = new Date(startDate);
        if (isNaN(parsedStartDate.getTime())) {
          throw new Error("Invalid start date format");
        }
        competition.startDate = parsedStartDate;
      }
      
      if (endDate) {
        const parsedEndDate = new Date(endDate);
        if (isNaN(parsedEndDate.getTime())) {
          throw new Error("Invalid end date format");
        }
        competition.endDate = parsedEndDate;
      }
    } catch (error) {
      logger.error('Error parsing competition dates:', error);
      return res.status(400).json({
        error: 'Invalid date format',
        message: error.message,
        requestId
      });
    }
    
    if (rules) competition.rules = rules;
    if (prizes) competition.prizes = prizes;
    
    // Handle status updates if provided
    if (req.body.status) {
      let updatedStatus = req.body.status;
      
      // Convert from client status names to server status names
      if (updatedStatus === 'upcoming') updatedStatus = 'PENDING';
      if (updatedStatus === 'active') updatedStatus = 'ACTIVE';
      if (updatedStatus === 'completed') updatedStatus = 'COMPLETED';
      
      competition.status = updatedStatus.toUpperCase();
    }
    // Otherwise update status based on dates if dates were changed
    else if (startDate || endDate) {
      const now = new Date();

      if (competition.startDate > now) {
        competition.status = 'PENDING';
      } else if (competition.endDate > now) {
        competition.status = 'ACTIVE';
      } else {
        competition.status = 'COMPLETED';
      }
    }

    // Validate the updated competition
    const validation = competition.validate();
    if (!validation.valid) {
      logger.warn('Competition validation failed', { errors: validation.errors, requestId });
      return res.status(400).json({
        error: 'Invalid competition data',
        details: validation.errors,
        requestId
      });
    }

    // Save to Firestore
    await firestoreUtils.saveCompetition(competition);

    // Create a list of updated fields for the response
    const updatedFields = [];
    if (title) updatedFields.push('title');
    if (description) updatedFields.push('description');
    if (type) updatedFields.push('type');
    if (startDate) updatedFields.push('startDate');
    if (endDate) updatedFields.push('endDate');
    if (rules) updatedFields.push('rules');
    if (prizes) updatedFields.push('prizes');
    if (startDate || endDate) updatedFields.push('status');

    logger.info(`Competition ${competitionId} updated successfully`, { fields: updatedFields, requestId });
    return res.status(200).json({
      message: 'Competition updated successfully',
      updated: updatedFields
    });
  } catch (error) {
    logger.error(`Error updating competition ${req.params.competitionId}:`, error);
    return res.status(500).json({
      error: 'Failed to update competition',
      message: error.message,
      requestId: req.id
    });
  }
};

/**
 * Admin only: Update competition winners
 */
const updateCompetitionWinners = async (req, res) => {
  try {
    const { competitionId } = req.params;
    const { winners } = req.body;
    const requestId = req.id;

    logger.info(`Updating winners for competition: ${competitionId}`, { requestId });

    if (!Array.isArray(winners)) {
      logger.warn('Winners must be an array', { requestId });
      return res.status(400).json({
        error: 'Winners must be an array',
        requestId
      });
    }

    // Get the competition
    const competition = await firestoreUtils.getCompetition(competitionId);

    if (!competition) {
      logger.warn(`Competition not found: ${competitionId}`, { requestId });
      return res.status(404).json({
        error: 'Competition not found',
        requestId
      });
    }

    // Only allow updating winners for completed competitions
    if (competition.status !== 'COMPLETED') {
      logger.warn(`Cannot set winners for non-completed competition: ${competitionId}`, { requestId });
      return res.status(400).json({
        error: 'Can only set winners for completed competitions',
        requestId
      });
    }

    // Validate winners format
    for (const winner of winners) {
      if (!winner.userId || typeof winner.rank !== 'number' || typeof winner.score !== 'number') {
        logger.warn('Invalid winner format', { winner, requestId });
        return res.status(400).json({
          error: 'Each winner must have userId, rank, and score',
          requestId
        });
      }

      // Check if user exists
      const user = await firestoreUtils.getUser(winner.userId);
      if (!user) {
        logger.warn(`Winner user not found: ${winner.userId}`, { requestId });
        return res.status(404).json({
          error: `User with ID ${winner.userId} not found`,
          requestId
        });
      }
    }

    // Update the competition winners
    competition.winners = winners;
    await firestoreUtils.saveCompetition(competition);

    // Use a batch to update user documents
    const batch = firestore.batch();

    // Get existing winners to handle removals
    const existingWinnerIds = competition.winners.map(w => w.userId);

    // Get all users who might need updates
    const userDocs = await firestore.collection('users')
      .where('competitions.won', 'array-contains', competitionId)
      .get();

    // Remove competition from users who are no longer winners
    userDocs.forEach(doc => {
      const userId = doc.id;

      // If user is not in new winners, remove competition from won list
      if (!existingWinnerIds.includes(userId)) {
        batch.update(doc.ref, {
          'competitions.won': admin.firestore.FieldValue.arrayRemove(competitionId)
        });
      }
    });

    // Add competition to new winners' won list
    winners.forEach(winner => {
      const userRef = firestore.collection('users').doc(winner.userId);
      batch.update(userRef, {
        'competitions.won': admin.firestore.FieldValue.arrayUnion(competitionId)
      });
    });

    await batch.commit();

    logger.info(`Competition ${competitionId} winners updated successfully`, { requestId });
    return res.status(200).json({
      message: 'Competition winners updated successfully',
      winnersCount: winners.length
    });
  } catch (error) {
    logger.error(`Error updating winners for competition ${req.params.competitionId}:`, error);
    return res.status(500).json({
      error: 'Failed to update competition winners',
      message: error.message,
      requestId: req.id
    });
  }
};

/**
 * Initialize the controller with dependencies
 */
const init = (fsUtils) => {
  firestoreUtils = fsUtils;
  console.log('Competition controller initialized with Firestore utils');
};

module.exports = {
  init,
  getCompetitions,
  getCompetition,
  joinCompetition,
  leaveCompetition,
  getLeaderboard,
  getUserCompetitions,
  createCompetition,
  updateCompetition,
  updateCompetitionWinners
};
