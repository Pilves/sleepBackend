const axios = require('axios');
const crypto = require('crypto');
const { logger } = require('./logger');

//conf
const OURA_AUTH_URL = 'https://cloud.ouraring.com/oauth/authorize';
const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token';
const CLIENT_ID = process.env.OURA_CLIENT_ID;
const CLIENT_SECRET = process.env.OURA_CLIENT_SECRET;
const REDIRECT_URI = process.env.OURA_REDIRECT_URI || 'http://localhost:5000/api/users/oura/callback';

//scopes
const SCOPES = ['email', 'personal', 'daily', 'heartrate', 'workout', 'session', 'spo2Daily'];

// Derive a 32-byte key from the provided key (cached for performance)
let derivedKey = null;

// Function to get properly sized encryption key
const getEncryptionKey = () => {
    // Return cached key if already derived
    if (derivedKey) {
        return derivedKey;
    }

    if (!process.env.ENCRYPTION_KEY) {
        logger.warn('No encryption key provided. Data will not be securely encrypted.');
        // Create a fixed insecure key for development
        derivedKey = Buffer.alloc(32, 1); // Insecure but consistent key
        return derivedKey;
    }

    try {
        // Use crypto.scrypt to derive a proper 32-byte key from the provided key
        const rawKey = process.env.ENCRYPTION_KEY;
        // Use a fixed salt for consistency (this is OK for this purpose)
        const salt = Buffer.from('SleepOlympicsSaltForKeyDerivation', 'utf8');
        
        // Sync version for simplicity in this case
        derivedKey = crypto.scryptSync(rawKey, salt, 32);
        return derivedKey;
    } catch (error) {
        logger.error('Error deriving encryption key:', error);
        // Fallback to a direct method if scrypt fails
        const rawKey = process.env.ENCRYPTION_KEY;
        // Create a buffer and ensure it's 32 bytes
        const keyBuffer = Buffer.from(rawKey.repeat(4), 'utf8'); // Repeat to ensure sufficient length
        derivedKey = keyBuffer.slice(0, 32);
        return derivedKey;
    }
};

// encrypt for firestore
const encryptData = (data) => {
    if (!process.env.ENCRYPTION_KEY) {
        logger.warn('Warning: No encryption key provided. Data will not be encrypted.');
        return `insecure:${data}`;
    }

    try {
        // Get properly sized key using key derivation
        const key = getEncryptionKey();
        
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(
            'aes-256-gcm',
            key,
            iv
        );

        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const authTag = cipher.getAuthTag().toString('hex');

        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (error) {
        logger.error('Error encrypting data:', error);
        throw new Error('Failed to secure sensitive data');
    }
};

// decrypt from firestore
const decryptData = (encryptedData) => {
    if (!process.env.ENCRYPTION_KEY) {
        logger.warn('Warning: No encryption key provided. Using insecure storage.');
        return encryptedData.split(':')[1];
    }

    try {
        if (encryptedData.startsWith('insecure:')) {
            return encryptedData.substring(9);
        }

        // Get properly sized key using key derivation
        const key = getEncryptionKey();

        const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');

        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            key,
            iv
        );

        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        logger.error('Error decrypting data:', error);
        throw new Error('Failed to retrieve sensitive data');
    }
};


// Generate the authorization URL
const getAuthorizationUrl = (state) => {
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: SCOPES.join(' '),
        state,
    });

    return `${OURA_AUTH_URL}?${params.toString()}`;
}

// Exchange the authorization code for an access token
const exchangeCodeForToken = async (code) => {
    try {
        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI
        });

        const response = await axios.post(OURA_TOKEN_URL, params.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        return response.data;
    } catch (error) {
        logger.error('Token exchange error:', error.response?.data || error.message);
        throw new Error('Failed to exchange code for tokens');
    }
};

// Refresh the access token using the refresh token
const refreshAccessToken = async (refreshToken) => {
    try {
        // Log the encrypted refresh token format (without exposing its value)
        logger.info(`Refresh token format check: ${refreshToken.substring(0, 10)}...`);
        
        // Decrypt the refresh token
        let decryptedRefreshToken;
        try {
            decryptedRefreshToken = decryptData(refreshToken);
            logger.info('Successfully decrypted refresh token');
        } catch (decryptError) {
            logger.error('Error decrypting refresh token:', decryptError);
            // Re-throw with more context
            throw new Error(`Failed to decrypt refresh token: ${decryptError.message}`);
        }
        
        // Validate the decrypted token
        if (!decryptedRefreshToken || decryptedRefreshToken.length < 10) {
            logger.error('Invalid refresh token after decryption');
            throw new Error('Invalid refresh token');
        }
        
        logger.info('Preparing refresh token request to Oura API');
        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: decryptedRefreshToken,
        });
        
        // Log request parameters (without exposing the actual token)
        logger.info('Refresh token request parameters:', { 
            client_id: CLIENT_ID,
            // Omit client_secret for security
            grant_type: 'refresh_token',
            refresh_token_length: decryptedRefreshToken.length
        });

        const response = await axios.post(OURA_TOKEN_URL, params.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });
        
        logger.info('Successfully refreshed Oura token');
        // Log receipt of new tokens (without exposing them)
        logger.info('Received new tokens:', { 
            has_access_token: !!response.data.access_token,
            has_refresh_token: !!response.data.refresh_token,
            expires_in: response.data.expires_in
        });

        return response.data;
    } catch (error) {
        // Enhanced error logging
        if (error.response) {
            logger.error('Token refresh API error:', { 
                status: error.response.status,
                data: error.response.data,
                error: error.message
            });
        } else {
            logger.error('Token refresh error:', error.message);
        }
        throw new Error(`Failed to refresh access token: ${error.message}`);
    }
};

// Create API client for Oura
const createOuraClient = (encryptedAccessToken, requestId = require('uuid').v4()) => {
    try {
        logger.info('Creating Oura API client with encrypted token', { requestId });
        
        // Check for insecure token format
        if (encryptedAccessToken.startsWith('insecure:')) {
            const accessToken = encryptedAccessToken.substring(9);
            logger.warn('Using insecure token format - recommend enabling encryption in production', { requestId });
            
            if (!accessToken) {
                logger.error('Empty access token', { requestId });
                throw new Error('Invalid access token');
            }
            
            return createClientWithToken(accessToken, requestId);
        }
        
        // Normal encrypted token handling
        try {
            const accessToken = decryptData(encryptedAccessToken);
            
            if (!accessToken) {
                logger.error('Failed to decrypt access token', { requestId });
                throw new Error('Invalid access token');
            }
            
            logger.info('Successfully decrypted Oura access token', { requestId });
            return createClientWithToken(accessToken, requestId);
            
        } catch (decryptError) {
            logger.error('Error decrypting Oura access token', { requestId, error: decryptError.message });
            throw new Error(`Token decryption failed: ${decryptError.message}`);
        }
    } catch (error) {
        logger.error('Error creating Oura API client:', { requestId, error: error.message });
        throw new Error(`Failed to create Oura API client: ${error.message}`);
    }
};

// Helper function to create Axios client with token
const createClientWithToken = (accessToken, requestId) => {
    // Create Axios client
    const client = axios.create({
        baseURL: 'https://api.ouraring.com/v2/',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Request-ID': requestId
        },
        timeout: 10000 // 10 second timeout
    });
    
    // Add request interceptor to log requests
    client.interceptors.request.use(config => {
        // Use existing request ID or create one
        const reqId = config.headers['X-Request-ID'] || requestId;
        logger.info(`Oura API request: ${config.method.toUpperCase()} ${config.url}`, { requestId: reqId });
        return config;
    }, error => {
        logger.error('Oura API request error:', { requestId, error: error.message });
        return Promise.reject(error);
    });
    
    // Add response interceptor to log responses with more details
    client.interceptors.response.use(response => {
        const reqId = response.config.headers['X-Request-ID'] || requestId;
        
        // Log standard info
        logger.info(`Oura API response: ${response.status} ${response.config.method.toUpperCase()} ${response.config.url}`, { 
            requestId: reqId,
            status: response.status
        });
        
        // Log data structure summary for debugging
        if (response.data) {
            const dataSummary = {};
            
            // If data is an object with properties
            if (typeof response.data === 'object' && response.data !== null) {
                // For each top level property, log its type and length if array
                Object.keys(response.data).forEach(key => {
                    const value = response.data[key];
                    if (Array.isArray(value)) {
                        dataSummary[key] = `Array(${value.length})`;
                    } else if (typeof value === 'object' && value !== null) {
                        dataSummary[key] = 'Object';
                    } else {
                        dataSummary[key] = typeof value;
                    }
                });
                
                logger.info('Oura API response data structure:', { requestId: reqId, structure: dataSummary });
                
                // If this is sleep data, log the raw response data for mapping
                if (response.config.url.includes('/daily_sleep')) {
                    console.log("=== OURA API RESPONSE DATA ===");
                    console.log(JSON.stringify(response.data, null, 2));
                    console.log("=== END RESPONSE DATA ===");
                }
            }
        }
        
        return response;
    }, error => {
        const reqId = error.config?.headers?.['X-Request-ID'] || requestId;
        logger.error(`Oura API error: ${error.message}`, { requestId: reqId });
        
        if (error.response) {
            logger.error(`Status: ${error.response.status}`, { 
                requestId: reqId,
                data: error.response.data
            });
        } else if (error.code === 'ECONNABORTED') {
            logger.error('Oura API request timed out', { requestId: reqId });
        }
        
        return Promise.reject(error);
    });

    return client;
};

module.exports = {
    encryptData,
    decryptData,
    getAuthorizationUrl,
    exchangeCodeForToken,
    refreshAccessToken,
    createOuraClient
};
