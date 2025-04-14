/**
 * SleepSummary model for Firebase Firestore
 * Represents aggregated sleep statistics for a user
 */
class SleepSummary {
  /**
   * Creates a new SleepSummary instance
   * @param {Object} data - Sleep summary data
   */
  constructor(data = {}) {
    this.id = data.id || null;
    this.userId = data.userId || '';
    this.dailyAverage = data.dailyAverage || {
      currentMonth: 0,
      previousMonth: 0,
      overall: 0
    };
    this.weeklyTrend = data.weeklyTrend || [];
    this.monthlyTrend = data.monthlyTrend || [];
    this.bestScore = data.bestScore || 0;
    this.worstScore = data.worstScore || 0;
    this.improvement = data.improvement || {
      monthly: 0,
      overall: 0
    };
    this.lastUpdated = data.lastUpdated || new Date();
  }

  /**
   * Updates the summary with a new sleep score
   * @param {number} score - The new sleep score
   * @param {Date} date - The date of the sleep score
   * @returns {boolean} Whether the summary was updated
   */
  updateWithScore(score, date) {
    if (typeof score !== 'number' || !date) return false;
    
    // Update best and worst scores
    if (score > this.bestScore) this.bestScore = score;
    if (this.worstScore === 0 || score < this.worstScore) this.worstScore = score;
    
    this.lastUpdated = new Date();
    return true;
  }

  /**
   * Converts this model to a Firestore document
   * @returns {Object} Firestore document representation
   */
  toFirestore() {
    return {
      userId: this.userId,
      dailyAverage: this.dailyAverage,
      weeklyTrend: this.weeklyTrend,
      monthlyTrend: this.monthlyTrend,
      bestScore: this.bestScore,
      worstScore: this.worstScore,
      improvement: this.improvement,
      lastUpdated: this.lastUpdated
    };
  }

  /**
   * Creates a SleepSummary model from a Firestore document
   * @param {Object} doc - Firestore document data
   * @returns {SleepSummary} SleepSummary model instance
   */
  static fromFirestore(doc) {
    const data = doc.data();
    // Handle Firestore timestamps
    const lastUpdated = data.lastUpdated?.toDate ? data.lastUpdated.toDate() : data.lastUpdated;
    
    return new SleepSummary({
      ...data,
      id: doc.id,
      lastUpdated
    });
  }
}

module.exports = SleepSummary;