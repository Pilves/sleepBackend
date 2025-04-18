/**
 * Log Maintenance Script
 * 
 * This script performs two main functions:
 * 1. Log Rotation: Rotates logs when they reach a certain size and archives them
 * 2. Log Sanitization: Sanitizes log files by removing sensitive information
 * 
 * It's useful for both production maintenance and preparing logs for sharing.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');
const { promisify } = require('util');

// Promisify functions for async operations
const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

// Configuration
const LOG_DIR = path.join(__dirname, '../logs');
const OUTPUT_DIR = path.join(__dirname, '../logs/sanitized');
const ARCHIVE_DIR = path.join(LOG_DIR, 'archive');
const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_LOG_AGE_DAYS = 30;
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
 * Ensure archive directory exists
 */
async function ensureArchiveDir() {
  try {
    await stat(ARCHIVE_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await mkdir(ARCHIVE_DIR, { recursive: true });
      console.log(`Created archive directory: ${ARCHIVE_DIR}`);
    } else {
      throw err;
    }
  }
}

/**
 * Rotate a single log file if needed
 * @param {string} logFile The log file to rotate
 */
async function rotateLogFile(logFile) {
  const logPath = path.join(LOG_DIR, logFile);
  
  try {
    const stats = await stat(logPath);
    
    // Check if file is larger than the maximum size
    if (stats.size > MAX_LOG_SIZE_BYTES) {
      console.log(`Rotating log file: ${logFile} (${Math.round(stats.size / 1024 / 1024)}MB)`);
      
      // Create timestamp for archive filename
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const archiveFilename = `${logFile}.${timestamp}.gz`;
      const archivePath = path.join(ARCHIVE_DIR, archiveFilename);
      
      // Read the log file
      const content = await readFile(logPath);
      
      // Compress the content
      const compressed = zlib.gzipSync(content);
      
      // Write compressed content to archive
      await writeFile(archivePath, compressed);
      console.log(`Archived to: ${archiveFilename}`);
      
      // Truncate the original log file
      await writeFile(logPath, '');
      console.log(`Truncated: ${logFile}`);
    }
  } catch (err) {
    // Handle case where log file doesn't exist yet
    if (err.code === 'ENOENT') {
      console.log(`Log file does not exist yet: ${logFile}`);
    } else {
      console.error(`Error rotating log file ${logFile}:`, err);
    }
  }
}

/**
 * Delete old archive files
 */
async function cleanOldArchives() {
  try {
    const files = await readdir(ARCHIVE_DIR);
    const now = new Date();
    
    for (const file of files) {
      const filePath = path.join(ARCHIVE_DIR, file);
      const stats = await stat(filePath);
      
      // Calculate age in days
      const fileAgeDays = (now - stats.mtime) / (1000 * 60 * 60 * 24);
      
      if (fileAgeDays > MAX_LOG_AGE_DAYS) {
        await unlink(filePath);
        console.log(`Deleted old log archive: ${file} (${Math.round(fileAgeDays)} days old)`);
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Error cleaning old archives:', err);
    }
  }
}

/**
 * Main function to handle log rotation and sanitization
 */
async function main() {
  try {
    console.log('Starting log maintenance...');
    
    // Ensure archive directory exists
    await ensureArchiveDir();
    
    // Get all log files
    const files = await readdir(LOG_DIR);
    
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
    
    // First rotate logs if needed
    for (const file of logFiles) {
      await rotateLogFile(file);
    }
    
    // Clean up old archives
    await cleanOldArchives();
    
    // Then sanitize logs if requested
    if (process.argv.includes('--sanitize')) {
      for (const file of logFiles) {
        await processLogFile(file);
      }
      console.log('All logs sanitized successfully!');
    }
    
    console.log('Log maintenance completed successfully.');
  } catch (error) {
    console.error('Error during log maintenance:', error);
    process.exit(1);
  }
}

// Execute the main function
main();