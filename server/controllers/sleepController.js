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
    
    logger.info(`Starting Oura data sync for user ID: ${userId}`);

    // Get user's Oura integration details
    const user = await firestoreUtils.getUser(userId);

    if (!user) {
      logger.error(`User not found in syncOuraData: ${userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Ensure user ID is properly set
    user.id = userId;
    
    // Ensure ouraIntegration exists to avoid null reference errors
    if (!user.ouraIntegration) {
      logger.warn(`User ${userId} has no ouraIntegration object, initializing empty one`);
      user.ouraIntegration = { connected: false };
    }
    
    logger.info(`Syncing sleep data for user: ${userId}, ouraIntegration status: ${user.ouraIntegration.connected}`);

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
      
      // Debug: Check if lastSyncDate exists but is invalid
      logger.info(`lastSyncDate value check: type=${typeof user.ouraIntegration.lastSyncDate}, value=${user.ouraIntegration.lastSyncDate}`);
    } else {
      // Use the last sync date or 6 months ago, whichever is more recent
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      
      // Get last sync date - make sure to handle both string and Date object formats
      let lastSync;
      if (typeof user.ouraIntegration.lastSyncDate === 'string') {
        lastSync = new Date(user.ouraIntegration.lastSyncDate);
        logger.info(`Converted string lastSyncDate to Date: ${lastSync}`);
      } else if (user.ouraIntegration.lastSyncDate instanceof Date) {
        lastSync = user.ouraIntegration.lastSyncDate;
        logger.info(`Using Date object lastSyncDate: ${lastSync}`);
      } else {
        // Fall back to 6 months if we can't parse the date
        logger.warn(`Invalid lastSyncDate format: ${typeof user.ouraIntegration.lastSyncDate}, falling back to 6 months`);
        lastSync = sixMonthsAgo;
      }
      
      // Use lastSyncDate only if it's more recent than 6 months ago and is valid
      if (isNaN(lastSync.getTime())) {
        logger.warn(`Invalid date in lastSyncDate: ${user.ouraIntegration.lastSyncDate}, falling back to 6 months`);
        startDate = sixMonthsAgo;
      } else {
        startDate = lastSync > sixMonthsAgo ? lastSync : sixMonthsAgo;
      }
      
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
      // Log the API request details
      logger.info(`Making Oura API request for sleep data from ${formattedStartDate} to ${formattedEndDate}`, {
        requestId,
        endpoint: '/usercollection/daily_sleep',
        params: { start_date: formattedStartDate, end_date: formattedEndDate }
      });
      
      // Try to get the response from Oura API
      // Oura v2 API uses different endpoints, try the correct one
      // First attempt the standard v2 endpoint
      let response;
      try {
        logger.info(`Trying Oura API v2 endpoint: /daily_sleep`, { requestId });
        response = await ouraClient.get('/daily_sleep', {
          params: {
            start_date: formattedStartDate,
            end_date: formattedEndDate
          }
        });
      } catch (v2Error) {
        // If that fails, try the alternative API path
        logger.info(`First endpoint failed, trying alternative: /usercollection/daily_sleep`, {
          requestId,
          error: v2Error.message
        });
        
        response = await ouraClient.get('/usercollection/daily_sleep', {
          params: {
            start_date: formattedStartDate,
            end_date: formattedEndDate
          }
        });
      }
      
      // Log received response status
      logger.info(`Received Oura API response with status ${response.status}`, { requestId });

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
      
      // Debug: Log first record after mapping if available
      if (ouraData.length > 0) {
        logger.info(`First mapped record sample:`, JSON.stringify(ouraData[0], null, 2));
      }
      
      if (ouraData.length === 0) {
        logger.warn(`No valid sleep data records mapped from Oura for user ${userId}`);
        return res.status(200).json({
          message: 'No valid sleep data records found from Oura',
          recordsProcessed: 0
        });
      }

      // Process and store the data
      // Use smaller batches to avoid potential issues with large batches
      let processedCount = 0;
      let errorCount = 0;
      const BATCH_SIZE = 20; // Process in smaller batches of 20 records
      
      // Log how many records we're about to process
      logger.info(`Processing ${ouraData.length} sleep records in batches for user ${userId}`);
      
      // First, ensure the parent document exists
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
            firstDate: ouraData.length > 0 ? ouraData[0].date : new Date(),
            lastDate: ouraData.length > 0 ? ouraData[ouraData.length - 1].date : new Date()
          }
        });
        logger.info(`Parent sleep data document created for user ${userId}`);
      }
      
      // Process in smaller batches
      for (let i = 0; i < ouraData.length; i += BATCH_SIZE) {
        const batch = firestore.batch();
        const currentBatch = ouraData.slice(i, i + BATCH_SIZE);
        
        logger.info(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1} with ${currentBatch.length} records for user ${userId}`);
        
        for (const sleepRecord of currentBatch) {
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
              logger.info(`Preserving existing tags/notes for date ${sleepRecord.dateId}`);
            }
  
            // Add the sleep data document to batch
            const docRef = firestore
              .collection('sleepData')
              .doc(userId)
              .collection('daily')
              .doc(sleepRecord.dateId);
  
            // Debug log the sleep data object before saving
            logger.info(`Saving sleep data for date ${sleepRecord.dateId}, score: ${sleepData.ouraScore}`);
            
            batch.set(docRef, sleepData.toFirestore(), { merge: true });
            
            // Also update the parent document metadata
            batch.update(parentRef, {
              totalRecords: admin.firestore.FieldValue.increment(1),
              lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
              'dateRange.lastDate': sleepRecord.date
            });
            processedCount++;
          } catch (recordError) {
            logger.error(`Error processing sleep record for date ${sleepRecord?.dateId}:`, recordError);
            errorCount++;
          }
        }
  
        // Commit the current batch
        try {
          await batch.commit();
          logger.info(`Successfully committed batch ${Math.floor(i/BATCH_SIZE) + 1} for user ${userId}, processed: ${currentBatch.length} records`);
        } catch (batchError) {
          logger.error(`Error committing batch ${Math.floor(i/BATCH_SIZE) + 1} for user ${userId}:`, batchError);
          // Do not stop processing on batch error, continue with next batch
          errorCount += currentBatch.length;
        }
      }

      // Update lastSyncDate to track when data was last synced
      // Explicitly create a new date and convert to ISO string for consistent handling
      const newSyncDate = new Date();
      
      // Make a direct update to the user document to ensure the lastSyncDate is properly stored
      try {
        logger.info(`Updating user ${userId} with new lastSyncDate: ${newSyncDate.toISOString()}`);
        
        // Modify the user object for the upcoming save
        user.ouraIntegration.lastSyncDate = newSyncDate;
        
        // First try using the Firestore API directly for the update
        const firestore = admin.firestore();
        await firestore.collection('users').doc(userId).update({
          'ouraIntegration.lastSyncDate': newSyncDate,
          'updatedAt': admin.firestore.FieldValue.serverTimestamp()
        });
        
        logger.info(`Successfully updated lastSyncDate directly for user ${userId}`);
      } catch (directUpdateError) {
        logger.error(`Failed to update lastSyncDate directly for user ${userId}:`, directUpdateError);
        
        // Fallback to using the firestoreUtils helper
        try {
          await firestoreUtils.saveUser(user);
          logger.info(`Successfully updated lastSyncDate via firestoreUtils for user ${userId}`);
        } catch (userUpdateError) {
          logger.error(`Failed to update lastSyncDate via helper for user ${userId}:`, userUpdateError);
          // Continue processing - this shouldn't fail the overall sync
        }
      }

      // Update sleep summaries
      await updateSleepSummaries(userId);

      return res.status(200).json({
        message: 'Sleep data synchronized successfully',
        recordsProcessed: processedCount,
        recordsInvalid: errorCount,
        recordsTotal: ouraData.length
      });
    } catch (apiError) {
      // Enhanced error logging with more details
      logger.error('Error fetching data from Oura API:', {
        error: apiError.message,
        stack: apiError.stack,
        code: apiError.code,
        requestId
      });
      
      // Log the response data if available
      if (apiError.response) {
        logger.error('Oura API error response:', {
          status: apiError.response.status,
          statusText: apiError.response.statusText,
          data: JSON.stringify(apiError.response.data).substring(0, 500),
          requestId
        });
        
        // Specific handling for 401 errors (unauthorized)
        if (apiError.response.status === 401) {
          logger.error('Oura API authentication error - token may be invalid', { requestId });
          // Attempt to mark token as invalid to force re-authentication
          try {
            user.ouraIntegration.tokenInvalid = true;
            await firestoreUtils.saveUser(user);
            logger.info(`Marked Oura token as invalid for user ${userId}`);
          } catch (tokenUpdateError) {
            logger.error(`Failed to mark token as invalid: ${tokenUpdateError.message}`);
          }
          
          return res.status(200).json({
            message: 'Authentication error with Oura. Please reconnect your Oura ring.',
            error: 'Oura authentication failed',
            needsReconnect: true,
            data: []
          });
        }
      }
      
      // Return a more specific error message for debugging purposes
      return res.status(200).json({
        message: 'Could not fetch data from Oura API',
        error: apiError.message || 'Error accessing Oura API',
        errorCode: apiError.code,
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
  
  // For debugging
  logger.info(`Processing ${ouraData.length} Oura records for mapping`);

  return ouraData.map((record, index) => {
    // For debugging the first few records
    if (index < 3) {
      logger.info(`Processing record ${index + 1}/${ouraData.length}:`, JSON.stringify(record, null, 2));
    }
  
    try {
      // Validate and extract date - check both v1 and v2 API formats
      // v2 API uses 'day', v1 might use 'summary_date' or other fields
      const dayField = record.day || record.summary_date || record.timestamp_date;
      
      if (!dayField) {
        logger.warn('Skipping Oura record with missing day field', { 
          recordId: record.id,
          fields: Object.keys(record).join(', ')
        });
        return null;
      }

      // Get date in YYYY-MM-DD format
      const dateId = dayField;
      const date = new Date(dayField);

      if (isNaN(date.getTime())) {
        logger.warn(`Invalid date in Oura record: ${dayField}`, { recordId: record.id });
        return null;
      }
      
      // For first record, log detailed field paths for debugging
      if (index === 0) {
        logger.info('Detailed field mapping for first record:', {
          day: dayField,
          score_paths: {
            direct_score: record.score,
            sleep_score: record.sleep_score,
            score_nested: record.score_nested,
          },
          duration_paths: {
            direct_duration: record.duration,
            total_sleep_duration: record.total_sleep_duration,
            deep_sleep_duration: record.deep_sleep_duration,
            rem_sleep_duration: record.rem_sleep_duration,
            light_sleep_duration: record.light_sleep_duration,
          },
          has_contributors: !!record.contributors
        });
      }

      // Handle different API versions - try all possible field paths
      // 1. Direct fields - for v1 API
      // 2. Nested contributors - for v2 API
      
      // Determine sleep score - try multiple possible field paths
      let sleepScore = 0;
      if (typeof record.score === 'number') {
        // v2 API format
        sleepScore = record.score;
      } else if (typeof record.sleep_score === 'number') {
        // v1 API format
        sleepScore = record.sleep_score;
      } else if (record.score_nested && typeof record.score_nested.total === 'number') {
        // Another possible format
        sleepScore = record.score_nested.total;
      } else {
        // Default fallback - estimate from contributors if available
        const contributors = record.contributors || {};
        if (contributors.total_sleep && contributors.deep_sleep && contributors.efficiency) {
          // Weighted average of key contributors
          sleepScore = Math.round(
            (contributors.total_sleep * 0.4) + 
            (contributors.deep_sleep * 0.3) + 
            (contributors.efficiency * 0.3)
          );
        } else {
          // Use a default score
          sleepScore = 70;
          logger.warn(`Using default sleep score for record ${record.id}`);
        }
      }
      
      // Determine sleep durations - try both direct fields and contributors
      let totalSleepSeconds, deepSleepSeconds, remSleepSeconds, lightSleepSeconds, latencySeconds;
      
      // First try direct duration fields (v1 API format)
      if (typeof record.total_sleep_duration === 'number') {
        // Use actual durations if available
        totalSleepSeconds = record.total_sleep_duration;
        deepSleepSeconds = record.deep_sleep_duration || 0;
        remSleepSeconds = record.rem_sleep_duration || 0;
        lightSleepSeconds = record.light_sleep_duration || 0;
        latencySeconds = record.onset_latency || 0;
        
        logger.info(`Using direct duration fields for record ${record.id || index}`);
      } 
      // Then try duration fields inside nested objects
      else if (record.duration && typeof record.duration.total_sleep === 'number') {
        totalSleepSeconds = record.duration.total_sleep;
        deepSleepSeconds = record.duration.deep_sleep || 0;
        remSleepSeconds = record.duration.rem_sleep || 0;
        lightSleepSeconds = record.duration.light_sleep || 0;
        latencySeconds = record.latency || 0;
        
        logger.info(`Using nested duration fields for record ${record.id || index}`);
      }
      // Finally fall back to estimating from contributors percentages
      else {
        // Extract metrics from the contributors object if available
        const contributors = record.contributors || {};
        
        // Calculate approximate sleep durations from the score percentages
        // These are estimates since the API doesn't provide exact durations
        // Average adult needs about 8 hours (28800 seconds) of sleep
        totalSleepSeconds = 28800 * (contributors.total_sleep || 90) / 100;
        
        // Proportional estimates based on typical sleep stage percentages
        // Deep sleep: ~15-25% of total sleep
        deepSleepSeconds = totalSleepSeconds * 0.20 * (contributors.deep_sleep || 90) / 100;
        
        // REM sleep: ~20-25% of total sleep
        remSleepSeconds = totalSleepSeconds * 0.22 * (contributors.rem_sleep || 90) / 100;
        
        // Light sleep: remaining sleep time
        lightSleepSeconds = totalSleepSeconds - deepSleepSeconds - remSleepSeconds;
        
        // Latency estimate based on score (lower score = longer latency, up to 30 minutes)
        latencySeconds = 1800 * (1 - (contributors.latency || 80) / 100);
        
        logger.info(`Using estimated durations from contributors for record ${record.id || index}`);
      }
      
      // Get heart rate data if available
      const hrAvg = record.hr_average || (record.heart_rate && record.heart_rate.average) || 0;
      const hrLowest = record.hr_lowest || (record.heart_rate && record.heart_rate.lowest) || 0;
      
      // Get HRV if available
      const hrv = record.rmssd || (record.hrv && record.hrv.rmssd) || 0;
      
      // Get respiratory rate if available
      const respRate = record.breath_average || (record.respiratory_rate && record.respiratory_rate.average) || 0;

      // Create the mapped sleep data object
      const mappedData = {
        userId,
        dateId,
        date,
        ouraScore: Math.round(sleepScore), // Ensure it's a whole number
        metrics: {
          totalSleepTime: Math.round(totalSleepSeconds),
          efficiency: (record.efficiency || (record.contributors && record.contributors.efficiency) || 0) * 100,
          deepSleep: Math.round(deepSleepSeconds),
          remSleep: Math.round(remSleepSeconds),
          lightSleep: Math.round(lightSleepSeconds),
          latency: Math.round(latencySeconds),
          heartRate: {
            average: hrAvg,
            lowest: hrLowest
          },
          hrv: hrv,
          respiratoryRate: respRate
        },
        sourceData: {
          provider: 'oura',
          providerUserId: record.user_id || 'unknown',
          sourceType: 'oura_sleep',
          sourceId: record.id || `generated-${Date.now()}`
        }
      };
      
      // Log the first couple of mapped records for debugging
      if (index < 2) {
        logger.info(`Mapped record ${index + 1}:`, JSON.stringify(mappedData, null, 2));
      }
      
      return mappedData;
    } catch (error) {
      logger.error(`Error mapping Oura record:`, { 
        error: error.message, 
        stack: error.stack,
        recordIndex: index,
        record: JSON.stringify(record)
      });
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
