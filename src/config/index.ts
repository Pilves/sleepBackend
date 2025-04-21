import dotenv from 'dotenv';

dotenv.config();

export const config = {
    port: process.env.PORT || 5000,
    nodeEnv: process.env.NODE_ENV || 'development',
    firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT || '',
    ouraApiUrl: process.env.OURA_API_URL || 'https://api.ouraring.com/v2',
    ouraClientId: process.env.OURA_CLIENT_ID || '',
    ouraClientSecret: process.env.OURA_CLIENT_SECRET || '',
    ouraRedirectUri: process.env.OURA_REDIRECT_URI || 'localhost:5000/auth/oura/callback',
    logLevel: process.env.LOG_LEVEL || 'info',
    allowedOrigins: process.env.ALLOWED_ORIGINS
}
