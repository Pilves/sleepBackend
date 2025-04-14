/**
 * Competition Routes
 */
const express = require('express');
const router = express.Router();
const { authenticate, isAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validator');
const competitionController = require('../controllers/competitionController');

// Get all competitions (filterable by status)
router.get('/', 
  authenticate, 
  competitionController.getCompetitions
);

// Get a specific competition
router.get('/:competitionId', 
  authenticate, 
  validate('competitionId'),
  competitionController.getCompetition
);

// Join a competition
router.post('/:competitionId/join', 
  authenticate, 
  validate('competitionId'),
  competitionController.joinCompetition
);

// Leave a competition
router.post('/:competitionId/leave', 
  authenticate, 
  validate('competitionId'),
  competitionController.leaveCompetition
);

// Get leaderboard for a competition
router.get('/:competitionId/leaderboard', 
  authenticate, 
  validate('competitionId'),
  competitionController.getLeaderboard
);

// Get user's competitions
router.get('/user/me', 
  authenticate, 
  competitionController.getUserCompetitions
);

// Admin routes
// Create a competition
router.post('/', 
  authenticate, 
  isAdmin, 
  validate('createCompetition'),
  competitionController.createCompetition
);

// Update a competition
router.put('/:competitionId', 
  authenticate, 
  isAdmin, 
  validate('competitionId'),
  competitionController.updateCompetition
);

// Update competition winners
router.put('/:competitionId/winners', 
  authenticate, 
  isAdmin, 
  validate('competitionId'),
  competitionController.updateCompetitionWinners
);

module.exports = router;