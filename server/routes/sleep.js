/**
 * Sleep Data Routes
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validator');
const sleepController = require('../controllers/sleepController');

// Return a router function that accepts firestoreUtils
module.exports = (firestoreUtils) => {
  const router = express.Router();
  
  // Initialize the controller with firestoreUtils
  sleepController.init(firestoreUtils);

  // Get sleep data for a specific date
  router.get('/data/:date', 
    authenticate, 
    validate('dateParam'),
    sleepController.getSleepData
  );

  // Get sleep data for a date range
  router.get('/data', 
    authenticate, 
    validate('dateRange'),
    sleepController.getSleepDataRange
  );

  // Sync sleep data from Oura
  router.post('/sync', 
    authenticate, 
    sleepController.syncOuraData
  );

  // Add a note to sleep data
  router.post('/data/:date/note', 
    authenticate, 
    validate('dateParam'),
    validate('addSleepNote'),
    sleepController.addSleepNote
  );

  // Get sleep summary
  router.get('/summary', 
    authenticate, 
    sleepController.getSleepSummary
  );

  return router;
};