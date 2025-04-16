/**
 * Log Sanitizer Script
 * 
 * This script sanitizes log files by removing sensitive information.
 * It's useful for preparing logs for alpha testing or public sharing.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Configuration
const LOG_DIR = path.join(__dirname, '../logs');
const OUTPUT_DIR = path.join(__dirname, '../logs/sanitized');
const SENSITIVE_PATTERNS = [
  // Email addresses
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' },
  
  // JWT tokens
  { pattern: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, replacement: '[JWT]' },
  
  // Firebase Auth/API keys
  { pattern: /AIza[0-9A-Za-z-_]{35}/g, replacement: '[FIREBASE_API_KEY]' },
  
  // Generic API Keys
  { pattern: /api[_-]?key[=:]["']?\w{20,}["']?/gi, replacement: 'api_key="[API_KEY]"' },
  
  // OAuth tokens
  { pattern: /(access|refresh)_token[=:]["']?\w{20,}["']?/gi, replacement: '$1_token="[OAUTH_TOKEN]"' },
  
  // IP addresses
  { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: '[IP_ADDRESS]' },
  
  // Passwords in request bodies
  { pattern: /"password":\s*"[^"]*"/g, replacement: '"password":"[REDACTED]"' },
  
  // Oura API tokens
  { pattern: /oura[_-]api[_-]token[=:]["']?\w{20,}["']?/gi, replacement: 'oura_api_token="[REDACTED]"' },
  
  // Firebase service account data
  { pattern: /"private_key": "-----BEGIN PRIVATE KEY-----.+?-----END PRIVATE KEY-----\\n"/gs, replacement: '"private_key":"[REDACTED]"' },
  { pattern: /"client_email": "[^"]+"/g, replacement: '"client_email":"[REDACTED]"' },
  { pattern: /"client_id": "[^"]+"/g, replacement: '"client_id":"[REDACTED]"' },
  { pattern: /"private_key_id": "[^"]+"/g, replacement: '"private_key_id":"[REDACTED]"' },
  
  // User IDs (simplistic approach, you might need to adjust based on your ID format)
  { pattern: /userId["']?:\s*["']?([a-zA-Z0-9]{20,})["']?/g, replacement: 'userId:"[USER_ID]"' }
];

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Sanitizes a line by replacing sensitive information
 * @param {string} line The log line to sanitize
 * @returns {string} The sanitized log line
 */
function sanitizeLine(line) {
  let sanitizedLine = line;
  
  SENSITIVE_PATTERNS.forEach(({ pattern, replacement }) => {
    sanitizedLine = sanitizedLine.replace(pattern, replacement);
  });
  
  return sanitizedLine;
}

/**
 * Processes a log file, sanitizing its contents
 * @param {string} filename The log file to process
 */
async function processLogFile(filename) {
  const inputPath = path.join(LOG_DIR, filename);
  const outputPath = path.join(OUTPUT_DIR, `sanitized-${filename}`);
  
  console.log(`Processing ${filename}...`);
  
  const fileStream = fs.createReadStream(inputPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  const outputStream = fs.createWriteStream(outputPath);
  
  for await (const line of rl) {
    const sanitizedLine = sanitizeLine(line);
    outputStream.write(sanitizedLine + '\n');
  }
  
  outputStream.end();
  console.log(`Sanitized log saved to ${outputPath}`);
}

/**
 * Main function to process all log files
 */
async function main() {
  try {
    const files = fs.readdirSync(LOG_DIR);
    
    // Filter for log files
    const logFiles = files.filter(file => 
      file.endsWith('.log') && 
      !file.startsWith('sanitized-') &&
      fs.statSync(path.join(LOG_DIR, file)).isFile()
    );
    
    if (logFiles.length === 0) {
      console.log('No log files found.');
      return;
    }
    
    console.log(`Found ${logFiles.length} log files to process.`);
    
    for (const file of logFiles) {
      await processLogFile(file);
    }
    
    console.log('All logs processed successfully!');
  } catch (error) {
    console.error('Error processing log files:', error);
  }
}

// Execute the main function
main();