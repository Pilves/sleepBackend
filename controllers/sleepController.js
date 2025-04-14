const admin = require('firebase-admin');
const moment = require('moment');

// Import models and utilities
const SleepData = require('../model/SleepData');
const SleepSummary = require('../model/SleepSummary');
const User = require('../model/User');
const firestoreUtils = require('../utils/firestoreUtils');
const ouraApi = require('../utils/ouraApi');

// Get sleep data for a specific date
const getSleepData = async (req, res) => {
  try {
    const userId = req.userId;
    const { date } = req.params; // Format: YYYY-MM-DD

    if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return res.status(400).json({ error: 'Invalid date format. Please use YYYY-MM-DD' });
    }

    const sleepData = await firestoreUtils.getSleepData(userId, date);

    if (!sleepData) {
      return res.status(404).json({ error: 'Sleep data not found for this date' });
    }

    return res.status(200).json({ sleepData });
  } catch (error) {
    console.error('Error getting sleep data:', error);
    return res.status(500).json({ error: 'Failed to retrieve sleep data' });
  }
};

// Get sleep data for a date range
const getSleepDataRange = async (req, res) => {
  try {
    const userId = req.userId;
    const { startDate, endDate } = req.query; // Format: YYYY-MM-DD

    if (!startDate || !startDate.match(/^\d{4}-\d{2}-\d{2}$/) ||
        !endDate || !endDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return res.status(400).json({ error: 'Invalid date format. Please use YYYY-MM-DD' });
    }

    const start = moment(startDate);
    const end = moment(endDate);

    if (end.diff(start, 'days') > 30) {
      return res.status(400).json({ error: 'Date range cannot exceed 30 days' });
    }

    const sleepData = await firestoreUtils.getSleepDataRange(
      userId,
      new Date(startDate),
      new Date(endDate)
    );

    return res.status(200).json({ sleepData });
  } catch (error) {
    console.error('Error getting sleep data range:', error);
    return res.status(500).json({ error: 'Failed to retrieve sleep data range' });
  }
};

// Sync sleep data from Oura
const syncOuraData = async (req, res) => {
  const firestore = admin.firestore();

  try {
    const userId = req.userId;

    // Get user's Oura integration details
    const user = await firestoreUtils.getUser(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.ouraIntegration || !user.ouraIntegration.connected || !user.ouraIntegration.apiKeyHash) {
      return res.status(400).json({ error: 'Oura ring not connected' });
    }

    // Define sync period: last 30 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    // Fetch data from Oura API
    const ouraData = await ouraApi.fetchSleepData(
      user.ouraIntegration.apiKeyHash,
      startDate,
      endDate
    );

    // Process and store the data
    const batch = firestore.batch();
    let processedCount = 0;

    for (const sleepRecord of ouraData) {
      // Create a sleep data model
      const sleepData = new SleepData({
        userId,
        dateId: sleepRecord.dateId,
        date: sleepRecord.date,
        ouraScore: sleepRecord.ouraScore,
        metrics: sleepRecord.metrics,
        tags: [],
        notes: ''
      });

      // Get existing data to preserve any notes and tags
      const existingData = await firestoreUtils.getSleepData(userId, sleepRecord.dateId);
      if (existingData) {
        sleepData.tags = existingData.tags || [];
        sleepData.notes = existingData.notes || '';
      }

      // Add to batch
      const docRef = firestore
        .collection('sleepData')
        .doc(userId)
        .collection('daily')
        .doc(sleepRecord.dateId);

      batch.set(docRef, sleepData.toFirestore(), { merge: true });
      processedCount++;
    }

    // Execute batch
    await batch.commit();

    // Update last sync date
    user.ouraIntegration.lastSyncDate = new Date();
    await firestoreUtils.saveUser(user);

    // Update sleep summaries
    await updateSleepSummaries(userId);

    return res.status(200).json({
      message: 'Sleep data synchronized successfully',
      recordsProcessed: processedCount
    });
  } catch (error) {
    console.error('Error syncing sleep data:', error);

    // Provide better error messages for specific failure cases
    if (error.status === 401) {
      return res.status(401).json({
        error: 'Oura API authentication failed, please reconnect your Oura ring'
      });
    }

    if (error.status === 429) {
      return res.status(429).json({
        error: 'Oura API rate limit exceeded, please try again later'
      });
    }

    return res.status(500).json({
      error: 'Failed to sync sleep data',
      message: error.message || 'Unknown error'
    });
  }
};

// Add a note to sleep data
const addSleepNote = async (req, res) => {
  try {
    const userId = req.userId;
    const { date } = req.params; // Format: YYYY-MM-DD
    const { note, tags } = req.body;

    if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return res.status(400).json({ error: 'Invalid date format. Please use YYYY-MM-DD' });
    }

    // Input validation
    if (note && typeof note !== 'string') {
      return res.status(400).json({ error: 'Note must be a string' });
    }

    if (tags && !Array.isArray(tags)) {
      return res.status(400).json({ error: 'Tags must be an array' });
    }

    // Get existing sleep data
    const sleepData = await firestoreUtils.getSleepData(userId, date);

    if (!sleepData) {
      return res.status(404).json({ error: 'Sleep data not found for this date' });
    }

    // Update the data
    if (note !== undefined) {
      sleepData.notes = note;
    }

    if (tags !== undefined) {
      sleepData.tags = tags;
    }

    // Save the changes
    await firestoreUtils.saveSleepData(sleepData);

    return res.status(200).json({
      message: 'Sleep note added successfully',
      notes: sleepData.notes,
      tags: sleepData.tags
    });
  } catch (error) {
    console.error('Error adding sleep note:', error);
    return res.status(500).json({ error: 'Failed to add sleep note' });
  }
};

// Get sleep summary
const getSleepSummary = async (req, res) => {
  try {
    const userId = req.userId;

    let summary = await firestoreUtils.getSleepSummary(userId);

    if (!summary) {
      // If summary doesn't exist yet, generate it
      summary = await updateSleepSummaries(userId);

      if (!summary) {
        return res.status(404).json({ error: 'Sleep summary not found and could not be generated' });
      }
    }

    // Check if summary is stale (older than 1 day)
    const now = new Date();
    const summaryDate = summary.lastUpdated;

    if (summaryDate && (now - summaryDate) > (24 * 60 * 60 * 1000)) {
      // Update in background, but return current data to user
      updateSleepSummaries(userId).catch(err =>
        console.error('Background summary update failed:', err)
      );
    }

    return res.status(200).json({ sleepSummary: summary });
  } catch (error) {
    console.error('Error getting sleep summary:', error);
    return res.status(500).json({ error: 'Failed to retrieve sleep summary' });
  }
};

// Helper: Update sleep summaries
const updateSleepSummaries = async (userId) => {
  const firestore = admin.firestore();

  try {
    // Get user's sleep data from the sleepData collection
    const sleepDataRef = firestore
      .collection('sleepData')
      .doc(userId)
      .collection('daily');

    // Get current month data
    const currentMonth = moment().startOf('month');
    const currentMonthData = await sleepDataRef
      .where('date', '>=', currentMonth.toDate())
      .where('date', '<=', moment().toDate())
      .orderBy('date', 'asc')
      .get();

    // Get previous month data
    const previousMonth = moment().subtract(1, 'month').startOf('month');
    const previousMonthEnd = moment().subtract(1, 'month').endOf('month');
    const previousMonthData = await sleepDataRef
      .where('date', '>=', previousMonth.toDate())
      .where('date', '<=', previousMonthEnd.toDate())
      .orderBy('date', 'asc')
      .get();

    // Get all data for overall statistics
    const allData = await sleepDataRef
      .orderBy('date', 'asc')
      .get();

    if (allData.empty) {
      // No sleep data exists yet
      return null;
    }

    // Calculate averages
    const currentMonthAvg = calculateAverage(currentMonthData, 'ouraScore');
    const previousMonthAvg = calculateAverage(previousMonthData, 'ouraScore');
    const overallAvg = calculateAverage(allData, 'ouraScore');

    // Calculate best and worst scores
    let bestScore = 0;
    let worstScore = 100;

    allData.forEach(doc => {
      const data = doc.data();
      if (data.ouraScore > bestScore) bestScore = data.ouraScore;
      if (data.ouraScore < worstScore) worstScore = data.ouraScore;
    });

    // Calculate weekly and monthly trends
    const weeklyTrend = calculateWeeklyTrend(allData);
    const monthlyTrend = calculateMonthlyTrend(allData);

    // Calculate improvements
    const monthlyImprovement = calculateImprovement(currentMonthData);
    const overallImprovement = calculateImprovement(allData);

    // Create summary object using our model
    const summary = new SleepSummary({
      userId,
      dailyAverage: {
        currentMonth: currentMonthAvg,
        previousMonth: previousMonthAvg,
        overall: overallAvg
      },
      weeklyTrend,
      monthlyTrend,
      bestScore,
      worstScore,
      improvement: {
        monthly: monthlyImprovement,
        overall: overallImprovement
      },
      lastUpdated: new Date()
    });

    // Save to Firestore
    await firestoreUtils.saveSleepSummary(summary);

    return summary;
  } catch (error) {
    console.error('Error updating sleep summaries:', error);
    throw error;
  }
};

// Helper: Calculate average from QuerySnapshot
const calculateAverage = (snapshot, field) => {
  if (snapshot.empty) return 0;

  let total = 0;
  let count = 0;

  snapshot.forEach(doc => {
    const data = doc.data();
    if (data && data[field] !== undefined) {
      total += data[field];
      count++;
    }
  });

  return count > 0 ? Math.round((total / count) * 10) / 10 : 0;
};

// Helper: Calculate improvement (difference between first and last records)
const calculateImprovement = (snapshot) => {
  if (snapshot.empty || snapshot.size < 2) return 0;

  const docs = [];
  snapshot.forEach(doc => {
    docs.push({
      date: doc.data().date.toDate(),
      score: doc.data().ouraScore
    });
  });

  // Sort by date
  docs.sort((a, b) => a.date - b.date);

  // Calculate difference between first and last week averages
  const firstWeekDocs = docs.slice(0, Math.min(7, Math.ceil(docs.length / 2)));
  const lastWeekDocs = docs.slice(-Math.min(7, Math.ceil(docs.length / 2)));

  const firstWeekAvg = firstWeekDocs.reduce((sum, doc) => sum + doc.score, 0) / firstWeekDocs.length;
  const lastWeekAvg = lastWeekDocs.reduce((sum, doc) => sum + doc.score, 0) / lastWeekDocs.length;

  return Math.round((lastWeekAvg - firstWeekAvg) * 10) / 10;
};

// Helper: Calculate weekly trend (last 4 weeks)
const calculateWeeklyTrend = (snapshot) => {
  if (snapshot.empty) return [];

  const docs = [];
  snapshot.forEach(doc => {
    docs.push({
      date: doc.data().date.toDate(),
      score: doc.data().ouraScore
    });
  });

  // Sort by date
  docs.sort((a, b) => a.date - b.date);

  // Get only the last 28 days (4 weeks)
  const recentDocs = docs.slice(-28);

  // Group by week
  const weeks = {};

  recentDocs.forEach(doc => {
    const weekStart = moment(doc.date).startOf('week').format('YYYY-MM-DD');
    if (!weeks[weekStart]) {
      weeks[weekStart] = {
        week: weekStart,
        scores: []
      };
    }
    weeks[weekStart].scores.push(doc.score);
  });

  // Calculate average for each week
  // Only last 4 weeks
  return Object.values(weeks)
      .map(week => ({
        week: week.week,
        average: Math.round((week.scores.reduce((sum, score) => sum + score, 0) / week.scores.length) * 10) / 10
      }))
      .slice(-4);
};

// Helper: Calculate monthly trend (last 6 months)
const calculateMonthlyTrend = (snapshot) => {
  if (snapshot.empty) return [];

  const docs = [];
  snapshot.forEach(doc => {
    docs.push({
      date: doc.data().date.toDate(),
      score: doc.data().ouraScore
    });
  });

  // Sort by date
  docs.sort((a, b) => a.date - b.date);

  // Group by month
  const months = {};

  docs.forEach(doc => {
    const monthStart = moment(doc.date).startOf('month').format('YYYY-MM');
    if (!months[monthStart]) {
      months[monthStart] = {
        month: monthStart,
        scores: []
      };
    }
    months[monthStart].scores.push(doc.score);
  });

  // Calculate average for each month
  // Only last 6 months
  return Object.values(months)
      .map(month => ({
        month: month.month,
        average: Math.round((month.scores.reduce((sum, score) => sum + score, 0) / month.scores.length) * 10) / 10
      }))
      .slice(-6);
};

module.exports = {
  getSleepData,
  getSleepDataRange,
  syncOuraData,
  addSleepNote,
  getSleepSummary
};
