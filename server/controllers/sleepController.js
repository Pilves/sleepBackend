const admin = require('firebase-admin');
const moment = require('moment');

// Import models and utilities
const SleepData = require('../model/SleepData');
const SleepSummary = require('../model/SleepSummary');
const User = require('../model/User');
const firestoreUtilsFactory = require('../utils/firestoreUtils');
const ouraOAuth = require('../utils/ouraOAuth');
const {logger} = require("../utils/logger");

// Initialize with Firestore
let firestoreUtils;

// Sync sleep data from Oura
const syncOuraData = async (req, res) => {
  const firestore = admin.firestore();

  try {
    const userId = req.userId;

    // Get user's Oura integration details
    const user = await firestoreUtils.getUser(userId);

    if (!user) {
      logger.error(`User not found in syncOuraData: ${userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    logger.info(`Syncing sleep data for user: ${userId}, ouraIntegration status: ${user.ouraIntegration?.connected}`);

    if (!user.ouraIntegration || !user.ouraIntegration.connected ||
        !user.ouraIntegration.accessToken || !user.ouraIntegration.refreshToken) {
      // Instead of erroring, return empty data with a message
      return res.status(200).json({ 
        message: 'No Oura Ring connected, nothing to sync',
        data: [],
        noConnection: true 
      });
    }

    // Check if token is expired and refresh if needed
    let accessToken = user.ouraIntegration.accessToken;
    const now = new Date();
    
    // Log current token expiration info for debugging
    const expiryTime = user.ouraIntegration.expiresAt;
    const timeToExpiry = expiryTime ? (expiryTime - now) / 1000 / 60 : 'unknown'; // minutes
    logger.info(`Oura token for user ${userId} expires in ${timeToExpiry} minutes`);
    
    // Check if expiry exists and it's in the past
    if (!expiryTime || now > expiryTime) {
      logger.info(`Refreshing expired Oura token for user: ${userId}`);

      try {
        const tokenResponse = await ouraOAuth.refreshAccessToken(user.ouraIntegration.refreshToken);

        // Update tokens
        accessToken = ouraOAuth.encryptData(tokenResponse.access_token);
        const refreshToken = ouraOAuth.encryptData(tokenResponse.refresh_token);
        
        // Calculate new expiration time - subtract 5 minutes for safety
        const expiresInMs = (tokenResponse.expires_in - 300) * 1000;
        const newExpiryTime = new Date(now.getTime() + expiresInMs);
        
        // Log the new token details
        logger.info(`New Oura token for user ${userId} will expire at ${newExpiryTime.toISOString()}`);

        // Update user record with new tokens
        user.ouraIntegration.accessToken = accessToken;
        user.ouraIntegration.refreshToken = refreshToken;
        user.ouraIntegration.expiresAt = newExpiryTime;
        user.ouraIntegration.lastRefreshed = now;

        // Save updated user
        await firestoreUtils.saveUser(user);
        logger.info(`Updated user ${userId} with new Oura tokens`);
      } catch (tokenError) {
        logger.error(`Failed to refresh Oura token for user ${userId}:`, { 
          error: tokenError.message,
          stack: tokenError.stack
        });
        
        // Mark this connection as needing to be reconnected
        try {
          // Update user to indicate token is invalid
          user.ouraIntegration.tokenInvalid = true;
          await firestoreUtils.saveUser(user);
          logger.info(`Marked Oura connection as invalid for user ${userId}`);
        } catch (updateError) {
          logger.error(`Failed to mark token as invalid for user ${userId}:`, updateError);
        }
        
        // Return a more user-friendly response that won't break the app
        return res.status(200).json({
          message: 'Oura authorization needs renewal. Please reconnect your Oura ring.',
          data: [],
          tokenExpired: true
        });
      }
    }

    // Define sync period based on lastSyncDate or default to 6 months
    const endDate = new Date();
    let startDate;
    
    // If user has never synced, get data for last 6 months
    // Otherwise, get data since last sync (or last 6 months if lastSyncDate is too old)
    if (!user.ouraIntegration.lastSyncDate) {
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 6);
      logger.info(`First sync for user ${userId}, fetching last 6 months of data`);
    } else {
      // Use the last sync date or 6 months ago, whichever is more recent
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      
      // Get last sync date
      const lastSync = new Date(user.ouraIntegration.lastSyncDate);
      
      // Use lastSyncDate only if it's more recent than 6 months ago
      startDate = lastSync > sixMonthsAgo ? lastSync : sixMonthsAgo;
      logger.info(`Using sync start date: ${startDate.toISOString()} for user ${userId}`);
    }

    // Format dates for API
    const formattedStartDate = startDate.toISOString().split('T')[0];
    const formattedEndDate = endDate.toISOString().split('T')[0];

    // Create Oura client with access token and request ID for tracing
    const requestId = require('uuid').v4();
    logger.info(`Starting Oura API request for user ${userId}`, { requestId });
    const ouraClient = ouraOAuth.createOuraClient(accessToken, requestId);

    // Fetch data from Oura API
    try {
      const response = await ouraClient.get('/usercollection/daily_sleep', {
        params: {
          start_date: formattedStartDate,
          end_date: formattedEndDate
        }
      });

      // Check if Oura API response has the expected structure
      if (!response.data || !response.data.data || !Array.isArray(response.data.data)) {
        logger.error(`Invalid Oura API response format for user ${userId}:`, { structure: JSON.stringify(response.data) });
        return res.status(200).json({
          message: 'Could not process Oura data: Invalid response format',
          error: 'Invalid API response format',
          data: []
        });
      }

      // Log detailed response data for debugging
      logger.info(`Received ${response.data.data.length} sleep records from Oura API for user ${userId}`);
      
      // Log the first record's structure (if available) to help with mapping
      if (response.data.data.length > 0) {
        const sampleRecord = response.data.data[0];
        console.log("=== OURA DATA SAMPLE RECORD ===");
        console.log(JSON.stringify(sampleRecord, null, 2));
        console.log("=== END SAMPLE RECORD ===");
        
        // Log specific fields that are important for mapping
        logger.info("Oura API field map:", {
          day: sampleRecord.day,
          sleep_score: sampleRecord.sleep_score,
          total_sleep_duration: sampleRecord.total_sleep_duration,
          deep_sleep_duration: sampleRecord.deep_sleep_duration,
          rem_sleep_duration: sampleRecord.rem_sleep_duration,
          light_sleep_duration: sampleRecord.light_sleep_duration
        });
      }

      // Map Oura data to our format
      const ouraData = mapOuraDataToSleepData(response.data.data, userId);

      // Log and validate the mapped data
      logger.info(`Mapped ${ouraData.length} Oura records to sleep data format for user ${userId}`);
      
      if (ouraData.length === 0) {
        logger.warn(`No valid sleep data records mapped from Oura for user ${userId}`);
        return res.status(200).json({
          message: 'No valid sleep data records found from Oura',
          recordsProcessed: 0
        });
      }

      // Process and store the data
      const batch = firestore.batch();
      let processedCount = 0;
      let errorCount = 0;

      for (const sleepRecord of ouraData) {
        try {
          // Create a sleep data model with validation
          const sleepData = new SleepData({
            userId,
            dateId: sleepRecord.dateId,
            date: sleepRecord.date,
            ouraScore: sleepRecord.ouraScore,
            metrics: sleepRecord.metrics,
            tags: [],
            notes: ''
          });

          // Validate the sleep data
          const validation = sleepData.validate();
          if (!validation.valid) {
            logger.warn(`Invalid sleep data record for user ${userId}, date ${sleepRecord.dateId}:`, 
              { errors: validation.errors });
            errorCount++;
            continue;
          }

          // Get existing data to preserve any notes and tags
          const existingData = await firestoreUtils.getSleepData(userId, sleepRecord.dateId);
          if (existingData) {
            sleepData.tags = existingData.tags || [];
            sleepData.notes = existingData.notes || '';
          }

          // Ensure the parent document exists first with proper data
          // We'll do this outside the batch for robustness
          const parentRef = firestore.collection('sleepData').doc(userId);
          const parentDoc = await parentRef.get();
          
          if (!parentDoc.exists) {
            logger.info(`Creating parent sleep data document for user ${userId}`);
            await parentRef.set({
              userId,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
              totalRecords: 0,
              dateRange: {
                firstDate: sleepRecord.date,
                lastDate: sleepRecord.date
              }
            });
          }
          
          // Add the sleep data document to batch
          const docRef = firestore
            .collection('sleepData')
            .doc(userId)
            .collection('daily')
            .doc(sleepRecord.dateId);

          batch.set(docRef, sleepData.toFirestore(), { merge: true });
          
          // Also update the parent document metadata
          batch.update(parentRef, {
            totalRecords: admin.firestore.FieldValue.increment(1),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            'dateRange.lastDate': admin.firestore.FieldValue.serverTimestamp()
          });
          processedCount++;
        } catch (recordError) {
          logger.error(`Error processing sleep record for date ${sleepRecord?.dateId}:`, recordError);
          errorCount++;
        }
      }

      // Commit all the changes
      await batch.commit();

      // Update lastSyncDate to track when data was last synced
      user.ouraIntegration.lastSyncDate = new Date();
      await firestoreUtils.saveUser(user);

      // Update sleep summaries
      await updateSleepSummaries(userId);

      return res.status(200).json({
        message: 'Sleep data synchronized successfully',
        recordsProcessed: processedCount,
        recordsInvalid: errorCount,
        recordsTotal: ouraData.length
      });
    } catch (apiError) {
      logger.error('Error fetching data from Oura API:', apiError);
      // Return a non-failing response
      return res.status(200).json({
        message: 'Could not fetch data from Oura, but continuing anyway',
        error: apiError.message || 'Error accessing Oura API',
        data: []
      });
    }
  } catch (error) {
    logger.error('Error syncing sleep data:', error);
    // Return a non-failing response with error details
    return res.status(200).json({
      message: 'Could not sync sleep data, but continuing anyway',
      error: error.message || 'Unknown error occurred',
      data: []
    });
  }
};

// Map Oura API data format to our internal sleep data structure
const mapOuraDataToSleepData = (ouraData, userId) => {
  // Validate input
  if (!ouraData || !Array.isArray(ouraData)) {
    logger.error('Invalid ouraData provided to mapOuraDataToSleepData');
    return [];
  }

  // Log the complete structure of the first record for debugging
  if (ouraData.length > 0) {
    logger.info(`Full structure of Oura record for mapping reference:`, 
      JSON.stringify(ouraData[0], null, 2).substring(0, 1000));
  }

  return ouraData.map(record => {
    // Validate required fields
    if (!record.day) {
      logger.warn('Skipping Oura record with missing day field', { recordId: record.id });
      return null;
    }

    try {
      // Get date in YYYY-MM-DD format
      const dateId = record.day;
      const date = new Date(record.day);

      if (isNaN(date.getTime())) {
        logger.warn(`Invalid date in Oura record: ${record.day}`, { recordId: record.id });
        return null;
      }

      // The new API format uses 'score' instead of 'sleep_score'
      // and has durations in the contributors object
      const sleepScore = Number(record.score || 0);
      
      // Extract metrics from the contributors object if available
      const contributors = record.contributors || {};
      
      // Calculate approximate sleep durations from the score percentages
      // These are estimates since the API doesn't provide exact durations
      // Average adult needs about 8 hours (28800 seconds) of sleep
      const totalSleepSeconds = 28800 * (contributors.total_sleep || 90) / 100;
      
      // Proportional estimates based on typical sleep stage percentages
      // Deep sleep: ~15-25% of total sleep
      const deepSleepSeconds = totalSleepSeconds * 0.20 * (contributors.deep_sleep || 90) / 100;
      
      // REM sleep: ~20-25% of total sleep
      const remSleepSeconds = totalSleepSeconds * 0.22 * (contributors.rem_sleep || 90) / 100;
      
      // Light sleep: remaining sleep time
      const lightSleepSeconds = totalSleepSeconds - deepSleepSeconds - remSleepSeconds;
      
      // Latency estimate based on score (lower score = longer latency, up to 30 minutes)
      const latencySeconds = 1800 * (1 - (contributors.latency || 80) / 100);

      // Create the mapped sleep data object
      return {
        userId,
        dateId,
        date,
        ouraScore: sleepScore,
        metrics: {
          totalSleepTime: Math.round(totalSleepSeconds),
          efficiency: contributors.efficiency || 0,
          deepSleep: Math.round(deepSleepSeconds),
          remSleep: Math.round(remSleepSeconds),
          lightSleep: Math.round(lightSleepSeconds),
          latency: Math.round(latencySeconds),
          heartRate: {
            average: 0, // Not available in this API response
            lowest: 0   // Not available in this API response
          },
          hrv: 0,       // Not available in this API response
          respiratoryRate: 0  // Not available in this API response
        },
        sourceData: {
          provider: 'oura',
          providerUserId: record.user_id || 'unknown',
          sourceType: 'oura_sleep',
          sourceId: record.id || `generated-${Date.now()}`
        }
      };
    } catch (error) {
      logger.error(`Error mapping Oura record:`, { error: error.message, record: JSON.stringify(record) });
      return null;
    }
  }).filter(Boolean); // Remove any null entries
};

// Get sleep data for a specific date
const getSleepData = async (req, res) => {
  try {
    const userId = req.userId;
    const { date } = req.params; // Format: YYYY-MM-DD

    if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return res.status(400).json({ error: 'Invalid date format. Please use YYYY-MM-DD' });
    }

    const sleepData = await firestoreUtils.getSleepData(userId, date);

    if (!sleepData) {
      return res.status(404).json({ error: 'Sleep data not found for this date' });
    }

    return res.status(200).json({ sleepData });
  } catch (error) {
    console.error('Error getting sleep data:', error);
    return res.status(500).json({ error: 'Failed to retrieve sleep data' });
  }
};

// Get sleep data for a date range
const getSleepDataRange = async (req, res) => {
  try {
    const userId = req.userId;
    const { startDate, endDate, days } = req.query;

    let start, end;

    // Handle 'days' parameter (number of past days)
    if (days !== undefined) {
      const daysNum = parseInt(days);
      // Validation should already have happened in middleware
      // Calculate start and end dates based on 'days' parameter
      end = moment().endOf('day');
      start = moment().subtract(daysNum, 'days').startOf('day');
    } 
    // Handle explicit start/end dates
    else if (startDate && endDate) {
      start = moment(startDate);
      end = moment(endDate);
      // Validation should already have happened in middleware
    } 
    // Default to last 7 days if no parameters are provided
    else {
      end = moment().endOf('day');
      start = moment().subtract(7, 'days').startOf('day');
      console.log('No date parameters provided, defaulting to last 7 days');
    }

    // Get sleep data for the date range
    const sleepData = await firestoreUtils.getSleepDataRange(
      userId,
      start.toDate(),
      end.toDate()
    );

    // Return the data, empty array if no sleep data found
    return res.status(200).json({ 
      sleepData: sleepData || [],
      noData: (sleepData || []).length === 0
    });
  } catch (error) {
    console.error('Error getting sleep data range:', error);
    return res.status(500).json({ error: 'Failed to retrieve sleep data range' });
  }
};


// Add a note to sleep data
const addSleepNote = async (req, res) => {
  try {
    const userId = req.userId;
    const { date } = req.params; // Format: YYYY-MM-DD
    const { note, tags } = req.body;

    if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return res.status(400).json({ error: 'Invalid date format. Please use YYYY-MM-DD' });
    }

    // Input validation
    if (note && typeof note !== 'string') {
      return res.status(400).json({ error: 'Note must be a string' });
    }

    if (tags && !Array.isArray(tags)) {
      return res.status(400).json({ error: 'Tags must be an array' });
    }

    // Get sleep data for the specified date
    let sleepData = await firestoreUtils.getSleepData(userId, date);

    // If sleep data doesn't exist, create a new entry
    if (!sleepData) {
      sleepData = {
        userId,
        dateId: date,
        date: new Date(date),
        ouraScore: 0,
        metrics: {},
        tags: [],
        notes: ''
      };
    }

    // Update sleep data with note and tags
    if (note !== undefined) {
      sleepData.notes = note;
    }

    if (tags !== undefined) {
      sleepData.tags = tags;
    }

    // Save the updated sleep data
    const firestore = admin.firestore();
    await firestore
      .collection('sleepData')
      .doc(userId)
      .collection('daily')
      .doc(date)
      .set(sleepData, { merge: true });

    return res.status(200).json({
      message: 'Sleep note updated successfully',
      sleepData
    });
  } catch (error) {
    console.error('Error adding sleep note:', error);
    return res.status(500).json({ error: 'Failed to add sleep note' });
  }
};

// Get sleep summary
const getSleepSummary = async (req, res) => {
  try {
    const userId = req.userId;
    let summary = await firestoreUtils.getSleepSummary(userId);

    if (!summary) {
      summary = await updateSleepSummaries(userId);

      if (!summary) {
        return res.status(404).json({ error: 'Sleep summary not found and could not be generated' });
      }
    }

    return res.status(200).json({ summary });
  } catch (error) {
    console.error('Error getting sleep summary:', error);
    return res.status(500).json({ error: 'Failed to retrieve sleep summary' });
  }
};

// Helper: Update sleep summaries
const updateSleepSummaries = async (userId) => {
  const firestore = admin.firestore();

  try {
    // Ensure the sleepData collection and user document exist with default values
    const sleepDataRef = await firestoreUtils.ensureSubcollection(
      'sleepData', 
      userId, 
      'daily',
      { userId, created: admin.firestore.FieldValue.serverTimestamp() }
    );

    // Get current month data
    const currentMonth = moment().startOf('month');
    const currentMonthData = await sleepDataRef
      .where('date', '>=', currentMonth.toDate())
      .where('date', '<=', moment().toDate())
      .orderBy('date', 'asc')
      .get();

    // Get previous month data
    const previousMonth = moment().subtract(1, 'month').startOf('month');
    const previousMonthEnd = moment().subtract(1, 'month').endOf('month');
    const previousMonthData = await sleepDataRef
      .where('date', '>=', previousMonth.toDate())
      .where('date', '<=', previousMonthEnd.toDate())
      .orderBy('date', 'asc')
      .get();

    // Get all data for overall statistics
    const allData = await sleepDataRef
      .orderBy('date', 'asc')
      .get();

    if (allData.empty) {
      // No sleep data exists yet
      return null;
    }

    // Calculate averages
    const currentMonthAvg = calculateAverage(currentMonthData, 'ouraScore');
    const previousMonthAvg = calculateAverage(previousMonthData, 'ouraScore');
    const overallAvg = calculateAverage(allData, 'ouraScore');

    // Calculate best and worst scores
    const allDocs = allData.docs.map(doc => {
      const data = doc.data();
      return {
        date: data.date.toDate(),
        score: data.ouraScore || 0
      };
    });

    // Sort by score to find best and worst
    const sortedByScore = [...allDocs].sort((a, b) => b.score - a.score);
    const bestScore = sortedByScore.length > 0 ? sortedByScore[0] : null;
    const worstScore = sortedByScore.length > 0 ? sortedByScore[sortedByScore.length - 1] : null;

    // Calculate streaks
    const goodScoreStreak = calculateStreak(allDocs, 70); // 70+ is considered good
    const perfectScoreStreak = calculateStreak(allDocs, 85); // 85+ is considered excellent

    // Calculate monthly trend
    const monthlyTrend = calculateMonthlyTrend(allDocs);

    // Create summary object
    const summary = new SleepSummary({
      userId,
      updated: new Date(),
      currentMonth: {
        average: currentMonthAvg,
        startDate: currentMonth.toDate(),
        endDate: new Date()
      },
      previousMonth: {
        average: previousMonthAvg,
        startDate: previousMonth.toDate(),
        endDate: previousMonthEnd.toDate()
      },
      overall: {
        average: overallAvg,
        bestScore: bestScore ? bestScore.score : 0,
        bestScoreDate: bestScore ? bestScore.date : null,
        worstScore: worstScore ? worstScore.score : 0,
        worstScoreDate: worstScore ? worstScore.date : null
      },
      streaks: {
        goodScore: goodScoreStreak,
        perfectScore: perfectScoreStreak
      },
      monthlyTrend
    });

    // Save summary to Firestore
    await firestore
      .collection('sleepSummaries')
      .doc(userId)
      .set(summary.toFirestore(), { merge: true });

    return summary;
  } catch (error) {
    console.error(`Error updating sleep summaries for user ${userId}:`, error);
    return null;
  }
};

// Helper: Calculate average score
const calculateAverage = (snapshot, field) => {
  if (snapshot.empty) {
    return 0;
  }

  let sum = 0;
  let count = 0;

  snapshot.forEach(doc => {
    const value = doc.data()[field];
    if (value !== undefined) {
      sum += value;
      count++;
    }
  });

  return count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
};

// Helper: Calculate longest streak of scores above threshold
const calculateStreak = (docs, threshold) => {
  if (!docs.length) {
    return {
      current: 0,
      longest: 0,
      longestStart: null,
      longestEnd: null
    };
  }

  // Sort by date ascending
  const sortedDocs = [...docs].sort((a, b) => a.date - b.date);

  let currentStreak = 0;
  let longestStreak = 0;
  let longestStart = null;
  let longestEnd = null;
  let currentStart = null;

  sortedDocs.forEach((doc, index) => {
    if (doc.score >= threshold) {
      if (currentStreak === 0) {
        currentStart = doc.date;
      }
      currentStreak++;
    } else {
      // Streak broken
      if (currentStreak > longestStreak) {
        longestStreak = currentStreak;
        longestStart = currentStart;
        longestEnd = sortedDocs[index - 1].date;
      }
      currentStreak = 0;
    }
  });

  // Check if last streak is the longest
  if (currentStreak > longestStreak) {
    longestStreak = currentStreak;
    longestStart = currentStart;
    longestEnd = sortedDocs[sortedDocs.length - 1].date;
  }

  return {
    current: currentStreak,
    longest: longestStreak,
    longestStart,
    longestEnd
  };
};

// Helper: Calculate monthly trend
const calculateMonthlyTrend = (docs) => {
  const months = {};

  docs.forEach(doc => {
    const monthStart = moment(doc.date).startOf('month').format('YYYY-MM');
    if (!months[monthStart]) {
      months[monthStart] = {
        month: monthStart,
        scores: []
      };
    }
    months[monthStart].scores.push(doc.score);
  });

  // Calculate average for each month
  // Only last 6 months
  return Object.values(months)
      .map(month => ({
        month: month.month,
        average: Math.round((month.scores.reduce((sum, score) => sum + score, 0) / month.scores.length) * 10) / 10
      }))
      .slice(-6);
};

// Init function to initialize controller with dependencies
const init = (fsUtils) => {
  firestoreUtils = fsUtils;
  console.log('Sleep controller initialized with Firestore utils');
};

module.exports = {
  init,
  getSleepData,
  getSleepDataRange,
  syncOuraData,
  addSleepNote,
  getSleepSummary
};
