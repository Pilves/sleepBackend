/**
 * Oura API Service
 * Handles communication with the Oura Ring API
 */
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// Get base URL from environment variables with fallback
const OURA_API_URL = process.env.OURA_API_URL || 'https://api.ouraring.com/v2';

/**
 * Encrypt API key for secure storage
 * @param {string} apiKey - The Oura API key to encrypt
 * @returns {string} Encrypted API key
 */
const encryptApiKey = (apiKey) => {
  if (!process.env.ENCRYPTION_KEY) {
    console.warn('WARNING: No encryption key set. API keys will not be securely stored!');
    // In production, you would throw an error here
    return `insecure:${apiKey}`;
  }

  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      Buffer.from(process.env.ENCRYPTION_KEY, 'hex'),
      iv
    );
    
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    // Return initialization vector, auth tag, and encrypted data
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to secure API key');
  }
};

/**
 * Decrypt API key for use
 * @param {string} encryptedKey - The encrypted API key
 * @returns {string} Decrypted API key
 */
const decryptApiKey = (encryptedKey) => {
  if (!process.env.ENCRYPTION_KEY) {
    console.warn('WARNING: No encryption key set. Using insecure API key storage!');
    // In production, you would throw an error here
    return encryptedKey.split(':')[1]; // Remove 'insecure:' prefix
  }

  try {
    if (encryptedKey.startsWith('insecure:')) {
      return encryptedKey.substring(9); // Remove 'insecure:' prefix
    }
    
    const [ivHex, authTagHex, encrypted] = encryptedKey.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(process.env.ENCRYPTION_KEY, 'hex'),
      iv
    );
    
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to access API key');
  }
};

/**
 * Create API client for a specific user's Oura ring
 * @param {string} encryptedApiKey - The encrypted API key
 * @returns {Object} Oura API client
 */
const createOuraClient = (encryptedApiKey) => {
  const apiKey = decryptApiKey(encryptedApiKey);
  
  const client = axios.create({
    baseURL: OURA_API_URL,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });
  
  // Add request ID for tracing
  client.interceptors.request.use(config => {
    config.headers['X-Request-ID'] = uuidv4();
    return config;
  });
  
  // Add response logging and error handling
  client.interceptors.response.use(
    (response) => {
      return response;
    },
    (error) => {
      const requestId = error.config?.headers?.['X-Request-ID'];
      console.error(`Oura API error [${requestId}]:`, error.message);
      
      if (error.response) {
        console.error(`Status: ${error.response.status}, Data:`, error.response.data);
      }
      
      // Wrap in standardized error format
      throw {
        message: 'Error communicating with Oura API',
        status: error.response?.status || 500,
        error: error.response?.data || error.message,
        requestId
      };
    }
  );
  
  return client;
};

/**
 * Verify that an API key is valid
 * @param {string} apiKey - The API key to verify
 * @returns {Promise<Object>} Verification result
 */
const verifyApiKey = async (apiKey) => {
  try {
    const client = createOuraClient(`insecure:${apiKey}`);
    
    // Try to fetch user profile to verify key works
    const response = await client.get('/usercollection/personal_info');
    
    return {
      valid: true,
      email: response.data.email,
      userId: response.data.id
    };
  } catch (error) {
    console.error('API key verification failed:', error.message);
    return {
      valid: false,
      error: error.message
    };
  }
};

/**
 * Fetch sleep data for a specific date range
 * @param {string} encryptedApiKey - The encrypted API key
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Array>} Array of sleep records
 */
const fetchSleepData = async (encryptedApiKey, startDate, endDate) => {
  try {
    const client = createOuraClient(encryptedApiKey);
    
    const formattedStartDate = startDate.toISOString().split('T')[0];
    const formattedEndDate = endDate.toISOString().split('T')[0];
    
    const response = await client.get('/usercollection/daily_sleep', {
      params: {
        start_date: formattedStartDate,
        end_date: formattedEndDate
      }
    });
    
    return mapOuraDataToSleepData(response.data.data);
  } catch (error) {
    console.error('Failed to fetch sleep data:', error);
    throw error;
  }
};

/**
 * Map Oura API data format to our internal sleep data structure
 * @param {Array} ouraData - Original data from Oura API
 * @returns {Array} Mapped data in our format
 */
const mapOuraDataToSleepData = (ouraData) => {
  return ouraData.map(record => {
    // Get date in YYYY-MM-DD format
    const dateId = record.day;
    const date = new Date(record.day);
    
    return {
      dateId,
      date,
      ouraScore: record.sleep_score,
      metrics: {
        totalSleepTime: record.total_sleep_duration, // in seconds
        efficiency: record.efficiency,
        deepSleep: record.deep_sleep_duration, // in seconds
        remSleep: record.rem_sleep_duration, // in seconds
        lightSleep: record.light_sleep_duration, // in seconds
        latency: record.onset_latency, // in seconds
        heartRate: {
          average: record.average_heart_rate,
          lowest: record.lowest_heart_rate
        },
        hrv: record.average_hrv,
        respiratoryRate: record.average_breathing
      },
      tags: [],
      notes: ''
    };
  });
};

module.exports = {
  encryptApiKey,
  decryptApiKey,
  verifyApiKey,
  fetchSleepData
};