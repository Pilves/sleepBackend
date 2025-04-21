const admin = require('firebase-admin');
const moment = require('moment');
const { v4: uuidv4 } = require('uuid'); 

// Import models and utilities
const SleepData = require('../model/SleepData');
const SleepSummary = require('../model/SleepSummary');
const User = require('../model/User');
const firestoreUtilsFactory = require('../utils/firestoreUtils');
const ouraOAuth = require('../utils/ouraOAuth');
const { logger } = require("../utils/logger");

// Initialize with Firestore - populated by init()
let firestoreUtils;

// --- Production Readiness Considerations ---
// - Environment Variables: Oura credentials, encryption keys should be in env vars/secrets manager.
// - Input Validation Middleware: Consider dedicated middleware for validating req.params, req.query, req.body.
// - Rate Limiting: Implement API rate limiting on your endpoints.
// - Security Audits: Regularly audit dependencies and code for vulnerabilities.
// - Monitoring & Alerting: Set up monitoring for error rates, latency, and system health.
// - Testing: Comprehensive unit, integration, and end-to-end tests are crucial.
// -----------------------------------------

/**
 * Initializes the controller with necessary dependencies.
 * @param {object} fsUtils - Firestore utility functions instance.
 */
const init = (fsUtils) => {
  if (!fsUtils) {
    throw new Error("Firestore utils are required for sleep controller initialization.");
  }
  firestoreUtils = fsUtils;
  logger.info('Sleep controller initialized successfully.');
};

/**
 * Maps Oura V2 API daily_sleep data to our internal SleepData structure.
 * @param {Array<object>} ouraApiData - Array of sleep record objects from Oura V2 API.
 * @param {string} userId - The user ID.
 * @returns {Array<object>} Array of mapped SleepData objects (without validation).
 */
const mapOuraDataToSleepData = (ouraApiData, userId) => {
  if (!ouraApiData || !Array.isArray(ouraApiData)) {
    logger.error('Invalid or missing ouraApiData provided to mapOuraDataToSleepData', { userId });
    return [];
  }

  logger.info(`Mapping ${ouraApiData.length} Oura records for user ${userId}`);

  // Log the structure of the first record for reference if available
  if (ouraApiData.length > 0) {
    logger.debug(`Sample Oura V2 record structure for mapping reference (userId: ${userId}):`, {
      sampleRecord: JSON.stringify(ouraApiData[0], null, 2).substring(0, 1000) // Log snippet
    });
  }

  return ouraApiData.map((record, index) => {
    try {
      // --- Validate Essential V2 Fields ---
      if (!record || typeof record !== 'object') {
        logger.warn(`Skipping invalid Oura record (not an object) at index ${index}`, { userId });
        return null;
      }

      const dayField = record.day; // V2 uses 'day' (YYYY-MM-DD)
      if (!dayField || typeof dayField !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dayField)) {
        logger.warn('Skipping Oura record with missing or invalid "day" field', {
          userId,
          recordId: record.id || `index_${index}`,
          dayReceived: dayField,
          keys: Object.keys(record).join(', ')
        });
        return null;
      }

      const dateId = dayField;
      const date = moment.utc(dayField).toDate(); // Use UTC to avoid timezone issues with YYYY-MM-DD

      if (isNaN(date.getTime())) {
        logger.warn(`Invalid date parsed from Oura record day: ${dayField}`, { userId, recordId: record.id });
        return null;
      }

      // --- Extract V2 Fields ---
      const sleepScore = record.score; // V2 uses 'score'
      if (typeof sleepScore !== 'number') {
         logger.warn(`Skipping Oura record with missing or invalid "score" field`, {
           userId,
           recordId: record.id,
           dateId,
           scoreReceived: sleepScore
         });
         // Decide if you want to skip or provide a default. Skipping is safer.
         // return null;
         // Or provide a default if a record without a score is still useful:
         // sleepScore = 0; // Or some other default indicator
         return null; // Skipping for now
      }


      // Durations are typically in seconds in V2
      const totalSleepSeconds = record.total_sleep_duration ?? 0; // Use nullish coalescing for defaults
      const deepSleepSeconds = record.deep_sleep_duration ?? 0;
      const remSleepSeconds = record.rem_sleep_duration ?? 0;
      const lightSleepSeconds = record.light_sleep_duration ?? 0;
      const latencySeconds = record.onset_latency ?? 0;
      const efficiency = record.efficiency ?? 0; // Efficiency score (0-100)

      // Heart rate data
      const hrAvg = record.hr_average ?? 0;
      const hrLowest = record.hr_lowest ?? 0;

      // HRV data (Root Mean Square of Successive Differences)
      const hrv = record.rmssd ?? 0;

      // Respiratory rate data
      const respRate = record.breath_average ?? 0;

      // --- Create Mapped Object ---
      const mappedData = {
        userId,
        dateId, // YYYY-MM-DD
        date,   // JavaScript Date object (UTC)
        ouraScore: Math.round(sleepScore), // Ensure integer score
        metrics: {
          totalSleepTime: Math.round(totalSleepSeconds),
          efficiency: Math.round(efficiency), // Ensure integer efficiency
          deepSleep: Math.round(deepSleepSeconds),
          remSleep: Math.round(remSleepSeconds),
          lightSleep: Math.round(lightSleepSeconds),
          latency: Math.round(latencySeconds),
          heartRate: {
            average: hrAvg,
            lowest: hrLowest
          },
          hrv: hrv, // Usually ms or ms^2 depending on specific 'rmssd' field variant
          respiratoryRate: respRate // Breaths per minute
        },
        sourceData: {
          provider: 'oura',
          // providerUserId: record.user_id || 'unknown', // V2 API doesn't usually return user_id per record
          sourceType: 'oura_sleep_v2', // Be specific about the source
          sourceId: record.id || `generated-${dateId}-${Date.now()}` // Use Oura record ID if available
        }
      };

      // Log first couple of mapped records for debugging if needed
      if (index < 2) {
        logger.debug(`Mapped Oura record ${index + 1} for user ${userId}:`, { mappedData });
      }

      return mappedData;

    } catch (error) {
      logger.error(`Error mapping Oura record at index ${index} for user ${userId}:`, {
        error: error.message,
        stack: error.stack?.substring(0, 300), // Log part of stack
        recordId: record?.id,
        recordKeys: record ? Object.keys(record).join(', ') : 'N/A'
        // Avoid logging the full record PII if possible, log keys or ID instead
      });
      return null;
    }
  }).filter(Boolean); // Remove any null entries from mapping errors or skipped records
};


/**
 * Syncs sleep data from the Oura V2 API for the authenticated user.
 * Handles token refresh, fetches data, maps it, and stores it in Firestore.
 * @param {object} req - Express request object (requires `req.userId`).
 * @param {object} res - Express response object.
 * @returns {Promise<object>} Express response.
 */
const syncOuraData = async (req, res) => {
  const firestore = admin.firestore();
  const userId = req.userId; // Assumes userId is attached by auth middleware
  const requestId = uuidv4(); // Unique ID for tracing this sync operation

  if (!userId) {
    logger.error('Missing userId in syncOuraData request', { requestId });
    // Avoid 500 for auth issues potentially caught later, but log severity
    return res.status(401).json({ message: "Authentication required.", error: "User ID missing." });
  }

  logger.info(`Starting Oura data sync for user ID: ${userId}`, { requestId });

  try {
    // 1. Get User and Oura Integration Details
    const user = await firestoreUtils.getUser(userId);

    if (!user) {
      logger.error(`User not found during Oura sync: ${userId}`, { requestId });
      return res.status(404).json({ message: 'User not found', error: 'User record does not exist.' });
    }
    user.id = userId; // Ensure ID is consistently set

    // Ensure ouraIntegration exists and is initialized
    if (!user.ouraIntegration) {
      logger.warn(`User ${userId} has no ouraIntegration object. Initializing.`, { requestId });
      user.ouraIntegration = { connected: false, tokenInvalid: false };
      // Persist this initialization? Maybe not here, but upon connection.
    }

    logger.info(`Checking Oura connection status for user ${userId}: connected=${user.ouraIntegration.connected}, tokenInvalid=${user.ouraIntegration.tokenInvalid}`, { requestId });

    // 2. Check Connection Status and Tokens
    if (
      !user.ouraIntegration.connected ||
      user.ouraIntegration.tokenInvalid || // Check if token was marked invalid previously
      !user.ouraIntegration.accessToken ||
      !user.ouraIntegration.refreshToken
    ) {
      const message = user.ouraIntegration.tokenInvalid
        ? 'Oura authorization needs renewal. Please reconnect your Oura ring.'
        : 'No Oura Ring connected or authorized.';
      logger.info(`Sync skipped for user ${userId}: ${message}`, { requestId });
      return res.status(200).json({
        message: message,
        data: [],
        needsReconnect: user.ouraIntegration.tokenInvalid || !user.ouraIntegration.connected, // Flag for client UI
        noConnection: !user.ouraIntegration.connected // Specific flag for no connection initially
      });
    }

    // 3. Check Token Expiration and Refresh if Needed
    let accessToken = user.ouraIntegration.accessToken; // Encrypted token
    const now = new Date();
    const expiryTime = user.ouraIntegration.expiresAt ? new Date(user.ouraIntegration.expiresAt) : null; // Handle potentially stored string/timestamp
    const isExpired = !expiryTime || now >= expiryTime;

    if (isExpired) {
      logger.info(`Oura token expired or nearing expiration for user ${userId}. Refreshing...`, {
        requestId,
        expiryTime: expiryTime?.toISOString(),
        now: now.toISOString()
      });
      try {
        const tokenResponse = await ouraOAuth.refreshAccessToken(user.ouraIntegration.refreshToken); // Assumes refreshToken is stored encrypted and handled by the utility

        // Encrypt new tokens before storing
        accessToken = ouraOAuth.encryptData(tokenResponse.access_token);
        const newEncryptedRefreshToken = ouraOAuth.encryptData(tokenResponse.refresh_token);

        // Calculate new expiration time (subtract safety margin, e.g., 5-10 mins)
        const expiresInSeconds = tokenResponse.expires_in;
        const safetyMarginSeconds = 600; // 10 minutes
        const newExpiryTime = new Date(now.getTime() + (expiresInSeconds - safetyMarginSeconds) * 1000);

        logger.info(`Oura token refreshed successfully for user ${userId}. New expiry: ${newExpiryTime.toISOString()}`, { requestId });

        // Update user record with new tokens and expiry
        user.ouraIntegration.accessToken = accessToken;
        user.ouraIntegration.refreshToken = newEncryptedRefreshToken;
        user.ouraIntegration.expiresAt = newExpiryTime;
        user.ouraIntegration.lastRefreshed = now;
        user.ouraIntegration.tokenInvalid = false; // Explicitly mark as valid after successful refresh

        await firestoreUtils.saveUser(user); // Assumes saveUser handles updates correctly
        logger.info(`Saved updated Oura tokens for user ${userId}`, { requestId });

      } catch (tokenError) {
        logger.error(`Failed to refresh Oura token for user ${userId}. Marking connection as invalid.`, {
          requestId,
          error: tokenError.message,
          // Include stack only in debug/verbose mode if needed
          // stack: tokenError.stack
        });

        // Mark token as invalid to prevent further API calls until re-auth
        user.ouraIntegration.tokenInvalid = true;
        try {
          await firestoreUtils.saveUser(user);
          logger.info(`Marked Oura connection as invalid for user ${userId} due to refresh failure.`, { requestId });
        } catch (updateError) {
          logger.error(`Failed to mark Oura token as invalid for user ${userId} after refresh failure:`, {
            requestId,
            updateError: updateError.message
          });
        }

        // Return a clear message to the client
        return res.status(200).json({ // Use 200 because sync *attempt* finished, but needs action
          message: 'Oura authorization needs renewal. Please reconnect your Oura ring.',
          data: [],
          error: 'Failed to refresh Oura token.',
          needsReconnect: true // Flag for client UI
        });
      }
    } else {
        // Log time to expiry if not expired
        const timeToExpiryMinutes = expiryTime ? Math.round((expiryTime.getTime() - now.getTime()) / 1000 / 60) : 'unknown';
        logger.info(`Oura token for user ${userId} is valid. Expires in approx ${timeToExpiryMinutes} minutes.`, { requestId });
    }


    // 4. Determine Sync Period
    const endDate = moment.utc().endOf('day'); // Sync up to end of today (UTC)
    let startDate;
    const sixMonthsAgo = moment.utc().subtract(6, 'months').startOf('day');
    const lastSyncDateRaw = user.ouraIntegration.lastSyncDate;
    let lastSyncDate = null;

    if (lastSyncDateRaw) {
        // Handle Firestore Timestamp or ISO string
        if (lastSyncDateRaw.toDate) { // Firestore Timestamp
            lastSyncDate = moment.utc(lastSyncDateRaw.toDate());
        } else if (typeof lastSyncDateRaw === 'string') {
            lastSyncDate = moment.utc(lastSyncDateRaw);
        } else if (lastSyncDateRaw instanceof Date) {
            lastSyncDate = moment.utc(lastSyncDateRaw);
        }
    }

    if (lastSyncDate && lastSyncDate.isValid() && lastSyncDate.isAfter(sixMonthsAgo)) {
      // Sync from the day *after* the last sync to avoid duplicates, up to max 6 months back
      startDate = lastSyncDate.add(1, 'day').startOf('day');
      logger.info(`Incremental sync for user ${userId}. Fetching data from ${startDate.format('YYYY-MM-DD')} to ${endDate.format('YYYY-MM-DD')}.`, { requestId });
    } else {
      // First sync or last sync too long ago, fetch last 6 months
      startDate = sixMonthsAgo;
       logger.info(`Performing full sync (or >6 months since last) for user ${userId}. Fetching data from ${startDate.format('YYYY-MM-DD')} to ${endDate.format('YYYY-MM-DD')}.`, { requestId });
    }

    // Ensure start date is not after end date
    if (startDate.isAfter(endDate)) {
        logger.info(`Start date ${startDate.format('YYYY-MM-DD')} is after end date ${endDate.format('YYYY-MM-DD')}. No new data to fetch for user ${userId}.`, { requestId });
        // Optionally update lastSyncDate here even if no data fetched?
        // user.ouraIntegration.lastSyncDate = new Date(); // Update sync time regardless
        // await firestoreUtils.saveUser(user);
        return res.status(200).json({
            message: 'Sleep data is already up to date.',
            recordsProcessed: 0,
            recordsTotal: 0
        });
    }

    // Format dates for API (YYYY-MM-DD)
    const formattedStartDate = startDate.format('YYYY-MM-DD');
    const formattedEndDate = endDate.format('YYYY-MM-DD');

    // 5. Fetch Data from Oura API V2
    let apiResponseData = [];
    try {
      // Create Oura client (assumes it handles decryption internally or token is decrypted)
      const ouraClient = ouraOAuth.createOuraClient(accessToken, requestId); // Pass request ID for potential tracing in client

      logger.info(`Making Oura API V2 request to /daily_sleep for user ${userId}`, {
        requestId,
        params: { start_date: formattedStartDate, end_date: formattedEndDate }
      });

      // Use the documented V2 endpoint
      const response = await ouraClient.get('/daily_sleep', {
        params: {
          start_date: formattedStartDate,
          end_date: formattedEndDate
        }
      });

      logger.info(`Received Oura API response status ${response.status} for user ${userId}`, { requestId });

      // Basic validation of the V2 response structure
      if (!response.data || !Array.isArray(response.data.data)) {
        logger.error(`Invalid Oura API response format received for user ${userId}. Expected { data: [...] }`, {
            requestId,
            responseStructure: JSON.stringify(response.data)?.substring(0, 500) // Log snippet
        });
        // Don't throw, return controlled error response
         return res.status(200).json({
            message: 'Received an unexpected response format from Oura. Sync could not be completed.',
            error: 'Invalid API response format',
            data: []
        });
      }

      apiResponseData = response.data.data;
      logger.info(`Received ${apiResponseData.length} sleep records from Oura API for user ${userId}`, { requestId });

    } catch (apiError) {
      let errorMessage = 'Failed to fetch data from Oura API.';
      let needsReconnect = false;
      let statusCode = 500; // Default internal error

      if (apiError.response) {
        // Handle specific HTTP errors from Oura
        statusCode = apiError.response.status;
        const responseDataSnippet = JSON.stringify(apiError.response.data)?.substring(0, 500);
        logger.error(`Oura API request failed for user ${userId} with status ${statusCode}`, {
          requestId,
          statusText: apiError.response.statusText,
          data: responseDataSnippet,
          // config: apiError.config // Can be verbose, enable if needed
        });

        if (statusCode === 401 || statusCode === 403) {
          errorMessage = 'Oura authorization failed. Please reconnect your Oura ring.';
          needsReconnect = true;
          // Mark token as invalid
          user.ouraIntegration.tokenInvalid = true;
          try {
            await firestoreUtils.saveUser(user);
            logger.info(`Marked Oura connection as invalid for user ${userId} due to ${statusCode} error.`, { requestId });
          } catch (updateError) {
            logger.error(`Failed to mark Oura token as invalid for user ${userId} after ${statusCode} error:`, {
              requestId,
              updateError: updateError.message
            });
          }
        } else if (statusCode === 429) {
          errorMessage = 'Oura API rate limit exceeded. Please try again later.';
          // Optionally implement backoff strategy here or rely on client retry
        } else {
           errorMessage = `Oura API returned an error (Status: ${statusCode}).`;
        }
      } else {
        // Network error or other issue before getting a response
        logger.error(`Error connecting to Oura API for user ${userId}:`, {
          requestId,
          error: apiError.message,
          code: apiError.code // e.g., ECONNREFUSED
        });
         errorMessage = 'Could not connect to Oura API.';
      }

      // Return controlled response
      return res.status(200).json({ // 200 as sync attempt finished, action might be needed
        message: errorMessage,
        error: apiError.message || 'Unknown Oura API error',
        errorCode: apiError.code,
        statusCode: statusCode, // Include Oura status code if available
        needsReconnect: needsReconnect,
        data: []
      });
    }

    // 6. Map Oura Data
    const mappedSleepData = mapOuraDataToSleepData(apiResponseData, userId);
    logger.info(`Mapped ${mappedSleepData.length} Oura records to internal format for user ${userId}`, { requestId });

    if (mappedSleepData.length === 0 && apiResponseData.length > 0) {
      logger.warn(`No valid sleep records could be mapped from ${apiResponseData.length} received Oura records for user ${userId}. Check mapping logic and data quality.`, { requestId });
       // Potentially return info about skipped records if needed by client
    }
     if (mappedSleepData.length === 0) {
      logger.info(`No new sleep data to process after mapping for user ${userId}`, { requestId });
       // Update last sync date even if no new records were processed? Yes, sync *attempted*.
        user.ouraIntegration.lastSyncDate = new Date();
        await firestoreUtils.saveUser(user);
        logger.info(`Updated lastSyncDate for user ${userId} after sync attempt yielded no processable data.`, { requestId });

       return res.status(200).json({
          message: 'No new sleep data found or processed from Oura.',
          recordsProcessed: 0,
          recordsTotal: apiResponseData.length // Show how many raw records were received
        });
    }


    // 7. Process and Store Data in Batches
    let processedCount = 0;
    let errorCount = 0;
    const BATCH_SIZE = 50; // Firestore batch limit is 500, use smaller for safety/memory
    const parentRef = firestore.collection('sleepData').doc(userId);
    const dailyCollectionRef = parentRef.collection('daily');

    logger.info(`Processing ${mappedSleepData.length} mapped sleep records in batches of ${BATCH_SIZE} for user ${userId}`, { requestId });

    // Ensure parent document exists (optional, set with merge handles it, but explicit can be clearer)
    try {
        await parentRef.set({ userId: userId, lastUpdated: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        logger.debug(`Ensured parent sleep data document exists for user ${userId}`, { requestId });
    } catch (parentDocError) {
        logger.error(`Failed to ensure parent sleep data document for user ${userId}`, { requestId, error: parentDocError.message });
        // Decide if this is critical - probably yes, halt processing.
        return res.status(500).json({ message: "Failed to prepare user data storage.", error: parentDocError.message });
    }

    // Sort data by date to ensure dateRange updates correctly
    mappedSleepData.sort((a, b) => a.date.getTime() - b.date.getTime());
    const firstDate = mappedSleepData[0].date;
    const lastDate = mappedSleepData[mappedSleepData.length - 1].date;


    for (let i = 0; i < mappedSleepData.length; i += BATCH_SIZE) {
      const batch = firestore.batch();
      const currentBatchItems = mappedSleepData.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

      logger.info(`Processing batch ${batchNumber} with ${currentBatchItems.length} records for user ${userId}`, { requestId });

      for (const sleepRecord of currentBatchItems) {
        try {
          // Create SleepData instance (includes built-in validation if model has it)
          const sleepData = new SleepData({
            ...sleepRecord, // Spread the mapped data
            tags: [],       // Initialize empty, preserve below if exists
            notes: ''       // Initialize empty, preserve below if exists
          });

          // Optional: Explicit validation call if needed
          // const validation = sleepData.validate();
          // if (!validation.valid) {
          //   logger.warn(`Invalid sleep data record constructed for user ${userId}, date ${sleepRecord.dateId}`,
          //     { errors: validation.errors, requestId });
          //   errorCount++;
          //   continue; // Skip this record
          // }

          // Get existing data to preserve user-added notes/tags
          const docRef = dailyCollectionRef.doc(sleepRecord.dateId);
          const existingDoc = await docRef.get(); // Read before write to preserve
          if (existingDoc.exists) {
            const existingData = existingDoc.data();
            sleepData.tags = existingData.tags || [];
            sleepData.notes = existingData.notes || '';
            logger.debug(`Preserving existing tags/notes for date ${sleepRecord.dateId}, user ${userId}`, { requestId });
          }

          // Add the validated & potentially merged data to the batch
          // Use toFirestore() method if your model class has one
          batch.set(docRef, sleepData.toFirestore ? sleepData.toFirestore() : { ...sleepData }, { merge: true });
          processedCount++;

        } catch (recordError) {
          logger.error(`Error processing individual sleep record for date ${sleepRecord?.dateId}, user ${userId}:`, {
             requestId,
             recordId: sleepRecord?.sourceData?.sourceId,
             error: recordError.message,
             stack: recordError.stack?.substring(0, 200)
          });
          errorCount++;
        }
      } // End of batch item loop

      // Commit the current batch
      try {
        await batch.commit();
        logger.info(`Successfully committed batch ${batchNumber} for user ${userId} (${currentBatchItems.length} records attempt).`, { requestId });
      } catch (batchError) {
        logger.error(`Error committing Firestore batch ${batchNumber} for user ${userId}:`, {
          requestId,
          error: batchError.message,
          // stack: batchError.stack // Potentially verbose
        });
        // Increment error count for all items in the failed batch
        errorCount += currentBatchItems.length;
        processedCount -= currentBatchItems.length; // Decrement processed count as batch failed
        // Consider stopping sync or implementing retry for failed batch
      }
    } // End of batch loop


     // 8. Update Metadata (Total Records, Date Range, Last Sync) - Outside Batch Loop for efficiency
     try {
        const finalUpdateData = {
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            // Only update totalRecords if you are sure about overwrite vs increment logic
            // Consider reading the parent doc once before loop, summing, then writing once after.
            // For simplicity, could update lastUpdated and dateRange here, totalRecords might need more robust handling
            'dateRange.lastDate': lastDate // Update last date seen in this sync
            // Optionally update firstDate if this is the very first sync
            // 'dateRange.firstDate': firstDate // Careful: only set if parent doc didn't exist or had no range
        };
        // If you track total records, update it carefully. Incrementing assumes no overlaps.
        // A safer approach might be to count documents after sync or use a transaction.
        // Example increment (use with caution if syncs can overlap or process old data):
        // if (processedCount > 0) {
        //     finalUpdateData.totalRecords = admin.firestore.FieldValue.increment(processedCount);
        // }
        await parentRef.update(finalUpdateData);
        logger.info(`Updated parent document metadata for user ${userId}`, { requestId, lastDate: lastDate.toISOString() });

        // Update lastSyncDate on the user object *after* successful processing
        const newSyncTimestamp = new Date();
        user.ouraIntegration.lastSyncDate = newSyncTimestamp;
        user.ouraIntegration.tokenInvalid = false; // Ensure marked as valid after successful sync
        await firestoreUtils.saveUser(user); // Save the updated user state
        logger.info(`Successfully updated lastSyncDate to ${newSyncTimestamp.toISOString()} for user ${userId}`, { requestId });

     } catch (metaUpdateError) {
         logger.error(`Failed to update metadata or lastSyncDate after processing for user ${userId}`, { requestId, error: metaUpdateError.message });
         // Sync partially succeeded, but metadata is stale. Critical? Maybe just log.
     }


    // 9. Update Sleep Summaries (Run asynchronously, don't block response)
    updateSleepSummaries(userId).then(() => {
      logger.info(`Sleep summary update triggered successfully for user ${userId}`, { requestId });
    }).catch(summaryError => {
      logger.error(`Error triggering sleep summary update for user ${userId}:`, { requestId, error: summaryError.message });
    });

    // 10. Return Success Response
    return res.status(200).json({
      message: 'Sleep data synchronized successfully.',
      recordsProcessed: processedCount,
      recordsReceivedFromOura: apiResponseData.length,
      recordsFailedToProcess: errorCount,
      dateRangeSynced: { start: formattedStartDate, end: formattedEndDate }
    });

  } catch (error) {
    // Catch-all for unexpected errors during the sync flow
    logger.error(`Unhandled error during Oura sync for user ${userId}:`, {
      requestId,
      error: error.message,
      stack: error.stack // Include stack for unexpected errors
    });
    // Return a generic server error response
    return res.status(500).json({
      message: 'An unexpected error occurred during sleep data synchronization.',
      error: error.message || 'Internal Server Error'
      // Avoid sending stack trace to client
    });
  }
};

// --- Other Endpoint Functions (with added validation and improved error handling) ---

/**
 * Get sleep data for a specific date.
 * @param {object} req - Express request object (requires `req.userId`, `req.params.date`).
 * @param {object} res - Express response object.
 * @returns {Promise<object>} Express response.
 */
const getSleepData = async (req, res) => {
  const userId = req.userId;
  const { date } = req.params; // Expects YYYY-MM-DD

  // Validation
  if (!userId) {
    return res.status(401).json({ error: 'User authentication required.' });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    logger.warn(`Invalid date format requested in getSleepData for user ${userId}: ${date}`);
    return res.status(400).json({ error: 'Invalid date format. Please use YYYY-MM-DD.' });
  }

  try {
    const sleepData = await firestoreUtils.getSleepData(userId, date);

    if (!sleepData) {
      logger.info(`Sleep data not found for user ${userId}, date ${date}`);
      return res.status(404).json({ message: 'Sleep data not found for this date.', sleepData: null });
    }

    logger.debug(`Retrieved sleep data for user ${userId}, date ${date}`);
    return res.status(200).json({ sleepData });

  } catch (error) {
    logger.error(`Error getting sleep data for user ${userId}, date ${date}:`, { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Failed to retrieve sleep data.' });
  }
};

/**
 * Get sleep data for a date range.
 * @param {object} req - Express request object (requires `req.userId`, optional `req.query.startDate`, `req.query.endDate`, `req.query.days`).
 * @param {object} res - Express response object.
 * @returns {Promise<object>} Express response.
 */
const getSleepDataRange = async (req, res) => {
  const userId = req.userId;
  const { startDate: queryStartDate, endDate: queryEndDate, days } = req.query;

  // Validation
  if (!userId) {
    return res.status(401).json({ error: 'User authentication required.' });
  }

  let startMoment, endMoment;

  try {
    // Determine date range
    if (days !== undefined) {
      const daysNum = parseInt(days, 10);
      if (isNaN(daysNum) || daysNum <= 0) {
        return res.status(400).json({ error: 'Invalid "days" parameter. Must be a positive number.' });
      }
      // Inclusive of today back N days (e.g., days=7 means today + 6 previous days)
      endMoment = moment.utc().endOf('day');
      startMoment = moment.utc().subtract(daysNum - 1, 'days').startOf('day');
      logger.debug(`getSleepDataRange: Using last ${daysNum} days for user ${userId}`);
    } else if (queryStartDate && queryEndDate) {
      startMoment = moment.utc(queryStartDate, 'YYYY-MM-DD', true); // Strict parsing
      endMoment = moment.utc(queryEndDate, 'YYYY-MM-DD', true);
      if (!startMoment.isValid() || !endMoment.isValid()) {
        return res.status(400).json({ error: 'Invalid startDate or endDate format. Use YYYY-MM-DD.' });
      }
      if (startMoment.isAfter(endMoment)) {
        return res.status(400).json({ error: 'startDate cannot be after endDate.' });
      }
      // Adjust to cover full days
      startMoment.startOf('day');
      endMoment.endOf('day');
      logger.debug(`getSleepDataRange: Using date range ${startMoment.format('YYYY-MM-DD')} to ${endMoment.format('YYYY-MM-DD')} for user ${userId}`);
    } else {
      // Default to last 7 days (inclusive)
      endMoment = moment.utc().endOf('day');
      startMoment = moment.utc().subtract(6, 'days').startOf('day');
      logger.debug(`getSleepDataRange: Defaulting to last 7 days for user ${userId}`);
    }

    // Get sleep data from Firestore
    const sleepDataArray = await firestoreUtils.getSleepDataRange(
      userId,
      startMoment.toDate(),
      endMoment.toDate()
    );

    logger.info(`Retrieved ${sleepDataArray.length} sleep records for range ${startMoment.format('YYYY-MM-DD')} to ${endMoment.format('YYYY-MM-DD')} for user ${userId}`);

    return res.status(200).json({
      sleepData: sleepDataArray || [], // Ensure array is returned
      query: { startDate: startMoment.format('YYYY-MM-DD'), endDate: endMoment.format('YYYY-MM-DD') } // Return the actual range used
      // noData: (sleepDataArray || []).length === 0 // Client can derive this
    });

  } catch (error) {
    logger.error(`Error getting sleep data range for user ${userId}:`, { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Failed to retrieve sleep data range.' });
  }
};

/**
 * Add or update a note and/or tags for a specific sleep data entry.
 * @param {object} req - Express request object (requires `req.userId`, `req.params.date`, `req.body.note` or `req.body.tags`).
 * @param {object} res - Express response object.
 * @returns {Promise<object>} Express response.
 */
const addSleepNote = async (req, res) => {
  const userId = req.userId;
  const { date } = req.params; // Expects YYYY-MM-DD
  const { note, tags } = req.body;

  // Validation
  if (!userId) {
    return res.status(401).json({ error: 'User authentication required.' });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
     logger.warn(`Invalid date format provided to addSleepNote for user ${userId}: ${date}`);
    return res.status(400).json({ error: 'Invalid date format. Please use YYYY-MM-DD.' });
  }
  if (note === undefined && tags === undefined) {
     return res.status(400).json({ error: 'Please provide either "note" or "tags".' });
  }
  if (note !== undefined && typeof note !== 'string') {
    return res.status(400).json({ error: '"note" must be a string.' });
  }
  if (tags !== undefined && (!Array.isArray(tags) || tags.some(t => typeof t !== 'string'))) {
    return res.status(400).json({ error: '"tags" must be an array of strings.' });
  }


  try {
    const firestore = admin.firestore();
    const docRef = firestore
      .collection('sleepData')
      .doc(userId)
      .collection('daily')
      .doc(date);

    const updateData = {};
    if (note !== undefined) {
      updateData.notes = note; // Overwrite existing note
    }
    if (tags !== undefined) {
      updateData.tags = tags; // Overwrite existing tags
    }
    updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp(); // Track note updates

    // Use set with merge:true to create doc if it doesn't exist, or update if it does
    await docRef.set(updateData, { merge: true });

    // Optionally fetch the updated document to return it
    const updatedDoc = await docRef.get();
    const updatedSleepData = updatedDoc.exists ? updatedDoc.data() : null; // Should exist after set

    logger.info(`Successfully updated notes/tags for user ${userId}, date ${date}`);
    return res.status(200).json({
      message: 'Sleep note/tags updated successfully.',
      sleepData: updatedSleepData // Return the potentially updated/created record
    });

  } catch (error) {
    logger.error(`Error adding/updating sleep note for user ${userId}, date ${date}:`, { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Failed to update sleep note/tags.' });
  }
};

/**
 * Get the calculated sleep summary for the user. Generates if missing.
 * @param {object} req - Express request object (requires `req.userId`).
 * @param {object} res - Express response object.
 * @returns {Promise<object>} Express response.
 */
const getSleepSummary = async (req, res) => {
  const userId = req.userId;

  if (!userId) {
    return res.status(401).json({ error: 'User authentication required.' });
  }

  try {
    let summary = await firestoreUtils.getSleepSummary(userId);

    if (!summary) {
      logger.info(`Sleep summary not found for user ${userId}. Generating...`);
      // Attempt to generate it on the fly
      summary = await updateSleepSummaries(userId); // This function now returns the summary or null

      if (!summary) {
        logger.warn(`Sleep summary not found and could not be generated for user ${userId} (likely no data).`);
        // Return 404 if generation failed (e.g., no underlying sleep data)
        return res.status(404).json({ message: 'Sleep summary not found. No sleep data available to generate one.', summary: null });
      }
       logger.info(`Sleep summary generated successfully on demand for user ${userId}.`);
    } else {
       logger.debug(`Retrieved existing sleep summary for user ${userId}.`);
    }

    return res.status(200).json({ summary });

  } catch (error) {
    logger.error(`Error getting sleep summary for user ${userId}:`, { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Failed to retrieve sleep summary.' });
  }
};


// --- Helper Functions (Internal) ---

/**
 * Calculates and updates sleep summary statistics in Firestore.
 * @param {string} userId - The user ID.
 * @returns {Promise<SleepSummary|null>} The generated SleepSummary object or null if no data.
 * @private
 */
const updateSleepSummaries = async (userId) => {
  const firestore = admin.firestore();
  const dailyCollectionRef = firestore.collection('sleepData').doc(userId).collection('daily');

  logger.info(`Starting sleep summary update for user ${userId}`);

  try {
    // Get all data for overall statistics (consider limiting if dataset is huge)
    // Adding a limit for sanity, e.g., last 2 years. Adjust as needed.
    const twoYearsAgo = moment.utc().subtract(2, 'years').startOf('day').toDate();
    const allDataSnapshot = await dailyCollectionRef
       .where('date', '>=', twoYearsAgo) // Limit query range
      .orderBy('date', 'asc')
      .get();

    if (allDataSnapshot.empty) {
      logger.info(`No sleep data found for user ${userId} within the summary period. Cannot generate summary.`);
      // Clean up potentially existing old summary? Optional.
      // await firestore.collection('sleepSummaries').doc(userId).delete();
      return null;
    }

    const allDocsData = allDataSnapshot.docs.map(doc => {
      const data = doc.data();
      // Ensure date is a Date object and score is a number
      const date = data.date?.toDate ? data.date.toDate() : (data.date instanceof Date ? data.date : null);
      const score = typeof data.ouraScore === 'number' ? data.ouraScore : null;
      if (!date || score === null) {
          logger.warn(`Skipping record in summary calculation due to invalid date/score for user ${userId}, doc ID ${doc.id}`);
          return null; // Skip invalid records
      }
      return {
        id: doc.id, // dateId (YYYY-MM-DD)
        date: date,
        score: score
      };
    }).filter(Boolean); // Filter out nulls


     if (allDocsData.length === 0) {
        logger.info(`No valid sleep records found after filtering for user ${userId}. Cannot generate summary.`);
        return null;
    }

    // Calculate averages using valid data
    const currentMonthStart = moment.utc().startOf('month');
    const previousMonthStart = moment.utc().subtract(1, 'month').startOf('month');
    const previousMonthEnd = moment.utc().subtract(1, 'month').endOf('month');

    const currentMonthData = allDocsData.filter(d => moment.utc(d.date).isSameOrAfter(currentMonthStart));
    const previousMonthData = allDocsData.filter(d => {
        const mDate = moment.utc(d.date);
        return mDate.isSameOrAfter(previousMonthStart) && mDate.isSameOrBefore(previousMonthEnd);
    });

    const currentMonthAvg = calculateAverageScore(currentMonthData);
    const previousMonthAvg = calculateAverageScore(previousMonthData);
    const overallAvg = calculateAverageScore(allDocsData);

    // Calculate best and worst scores
    const sortedByScore = [...allDocsData].sort((a, b) => b.score - a.score);
    const bestScoreData = sortedByScore[0]; // Highest score
    const worstScoreData = sortedByScore[sortedByScore.length - 1]; // Lowest score

    // Calculate streaks (using date-sorted data)
    const goodScoreThreshold = 75; // Example threshold
    const perfectScoreThreshold = 85; // Example threshold
    const goodScoreStreak = calculateStreak(allDocsData, goodScoreThreshold);
    const perfectScoreStreak = calculateStreak(allDocsData, perfectScoreThreshold);

    // Calculate monthly trend (last 6 months with data)
    const monthlyTrend = calculateMonthlyTrend(allDocsData);

    // Create summary object using the SleepSummary model
    const summary = new SleepSummary({
      userId,
      updatedAt: new Date(), // Use JS Date, Firestore converts
      currentMonth: {
        averageScore: currentMonthAvg,
        startDate: currentMonthStart.toDate(),
        endDate: moment.utc().endOf('day').toDate(), // Today
        recordCount: currentMonthData.length
      },
      previousMonth: {
        averageScore: previousMonthAvg,
        startDate: previousMonthStart.toDate(),
        endDate: previousMonthEnd.toDate(),
         recordCount: previousMonthData.length
      },
      overall: {
        averageScore: overallAvg,
        bestScore: bestScoreData ? bestScoreData.score : null,
        bestScoreDate: bestScoreData ? bestScoreData.date : null,
        worstScore: worstScoreData ? worstScoreData.score : null,
        worstScoreDate: worstScoreData ? worstScoreData.date : null,
        recordCount: allDocsData.length,
        firstDate: allDocsData[0]?.date, // Assumes allDocsData is date-sorted ASC
        lastDate: allDocsData[allDocsData.length - 1]?.date
      },
      streaks: {
        goodScoreThreshold: goodScoreThreshold,
        goodScore: goodScoreStreak,
        perfectScoreThreshold: perfectScoreThreshold,
        perfectScore: perfectScoreStreak
      },
      monthlyTrend: monthlyTrend // Array of { month: 'YYYY-MM', averageScore: X, recordCount: Y }
    });

    // Save summary to Firestore
    await firestore
      .collection('sleepSummaries')
      .doc(userId)
      .set(summary.toFirestore ? summary.toFirestore() : { ...summary }, { merge: true }); // Use toFirestore if available

     logger.info(`Successfully updated sleep summary for user ${userId}.`);
    return summary; // Return the generated summary

  } catch (error) {
    logger.error(`Error updating sleep summaries for user ${userId}:`, { error: error.message, stack: error.stack });
    // Don't re-throw, just log and return null to indicate failure
    return null;
  }
};

/**
 * Helper: Calculate average score from an array of data points.
 * @param {Array<{score: number}>} dataPoints - Array of objects with a 'score' property.
 * @returns {number} Calculated average score (rounded to 1 decimal) or 0 if no data.
 * @private
 */
const calculateAverageScore = (dataPoints) => {
  if (!dataPoints || dataPoints.length === 0) {
    return 0;
  }
  const validScores = dataPoints.map(d => d.score).filter(s => typeof s === 'number');
  if (validScores.length === 0) {
      return 0;
  }
  const sum = validScores.reduce((acc, score) => acc + score, 0);
  const average = sum / validScores.length;
  return Math.round(average * 10) / 10; // Round to one decimal place
};

/**
 * Helper: Calculate longest and current streak of scores >= threshold.
 * Assumes input `docs` are sorted by date ascending.
 * @param {Array<{date: Date, score: number}>} sortedDocs - Array of score objects sorted by date ASC.
 * @param {number} threshold - The score threshold for the streak.
 * @returns {object} Object containing current streak, longest streak details.
 * @private
 */
const calculateStreak = (sortedDocs, threshold) => {
  let currentStreak = 0;
  let longestStreak = 0;
  let longestStreakStartDate = null;
  let longestStreakEndDate = null;
  let currentStreakStartDate = null; // Track start date of current streak

  if (!sortedDocs || sortedDocs.length === 0) {
      return { current: 0, longest: 0, longestStartDate: null, longestEndDate: null };
  }

  // Ensure data is sorted by date (important!)
  // The caller should ideally provide sorted data, but we can sort here as a fallback
  // sortedDocs.sort((a, b) => a.date.getTime() - b.date.getTime()); // Uncomment if input might not be sorted

  sortedDocs.forEach((doc, index) => {
    if (doc.score >= threshold) {
      if (currentStreak === 0) {
        currentStreakStartDate = doc.date; // Start of a new streak
      }
      currentStreak++;
    } else {
      // Streak broken or never started
      if (currentStreak > longestStreak) {
        // The ended streak was the longest so far
        longestStreak = currentStreak;
        longestStreakStartDate = currentStreakStartDate;
        // End date is the date of the *last* successful day in the streak
        longestStreakEndDate = index > 0 ? sortedDocs[index - 1].date : currentStreakStartDate; // Handle edge case of first item breaking streak
      }
      // Reset current streak
      currentStreak = 0;
      currentStreakStartDate = null;
    }
  });

  // After the loop, check if the current running streak is the longest
  if (currentStreak > longestStreak) {
    longestStreak = currentStreak;
    longestStreakStartDate = currentStreakStartDate;
    longestStreakEndDate = sortedDocs[sortedDocs.length - 1].date; // Ends on the last day
  }

  // Determine if the *current* streak is ongoing (i.e., the last day met the threshold)
  const lastDayMetThreshold = sortedDocs[sortedDocs.length - 1]?.score >= threshold;
  const finalCurrentStreak = lastDayMetThreshold ? currentStreak : 0;


  return {
    current: finalCurrentStreak,
    longest: longestStreak,
    longestStartDate: longestStreakStartDate,
    longestEndDate: longestStreakEndDate
  };
};

/**
 * Helper: Calculate average score per month for the last N months with data.
 * Assumes input `docs` are sorted by date ascending.
 * @param {Array<{date: Date, score: number}>} sortedDocs - Array of score objects sorted by date ASC.
 * @param {number} [numMonths=6] - Number of recent months to include in the trend.
 * @returns {Array<object>} Array of { month: 'YYYY-MM', averageScore: X, recordCount: Y } for recent months.
 * @private
 */
const calculateMonthlyTrend = (sortedDocs, numMonths = 6) => {
  if (!sortedDocs || sortedDocs.length === 0) {
    return [];
  }

  const monthlyData = {}; // Use object keyed by 'YYYY-MM'

  sortedDocs.forEach(doc => {
    const monthKey = moment.utc(doc.date).format('YYYY-MM');
    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = {
        month: monthKey,
        scores: [],
        recordCount: 0
      };
    }
    monthlyData[monthKey].scores.push(doc.score);
    monthlyData[monthKey].recordCount++;
  });

  // Calculate average for each month and sort by month
  const trend = Object.values(monthlyData)
    .map(monthStats => ({
      month: monthStats.month,
      averageScore: calculateAverageScore(monthStats.scores.map(s => ({score: s}))), // Reuse helper
      recordCount: monthStats.recordCount
    }))
    .sort((a, b) => a.month.localeCompare(b.month)); // Sort chronologically

  // Return only the last N months
  return trend.slice(-numMonths);
};

// --- Module Exports ---
module.exports = {
  init,
  getSleepData,
  getSleepDataRange,
  syncOuraData,
  addSleepNote,
  getSleepSummary,
  // Expose summary update if needed for admin tasks, but generally internal
  // updateSleepSummaries
};