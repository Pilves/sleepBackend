/**
 * Competition Routes
 */
const express = require('express');
const { authenticate, isAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validator');
const competitionController = require('../controllers/competitionController');

// Return a router function that accepts firestoreUtils
module.exports = (firestoreUtils) => {
  const router = express.Router();
  
  // Initialize the controller with firestoreUtils
  if (competitionController.init) {
    console.log('Initializing competition controller with firestoreUtils');
    competitionController.init(firestoreUtils);
  } else {
    console.warn('Competition controller has no init method!');
  }

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
    validate('updateCompetition'),
    competitionController.updateCompetition
  );

  // Update competition winners
  router.put('/:competitionId/winners', 
    authenticate, 
    isAdmin, 
    validate('competitionId'),
    competitionController.updateCompetitionWinners
  );

  return router;
};