/**
 * Sleep Data Routes
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validator');
const sleepController = require('../controllers/sleepController');

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

module.exports = router;