/**
 * SleepData model for Firebase Firestore
 * Represents a daily sleep record in the Sleep Olympics application
 */
class SleepData {
  /**
   * Creates a new SleepData instance
   * @param {Object} data - Sleep data
   */
  constructor(data = {}) {
    this.id = data.id || null;
    this.userId = data.userId || '';
    this.dateId = data.dateId || ''; // Format: YYYY-MM-DD
    this.date = data.date || new Date();
    this.ouraScore = data.ouraScore || 0;
    this.metrics = data.metrics || {};
    this.tags = data.tags || [];
    this.notes = data.notes || '';
  }

  /**
   * Validates if the sleep data is valid
   * @returns {Object} Validation result {valid: boolean, errors: string[]}
   */
  validate() {
    const errors = [];
    
    if (!this.userId) errors.push('User ID is required');
    if (!this.dateId) errors.push('Date ID is required');
    if (!(this.date instanceof Date)) errors.push('Date is required');
    if (typeof this.ouraScore !== 'number') errors.push('Oura score is required and must be a number');
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Generates a dateId (YYYY-MM-DD) from a Date object
   * @param {Date} date - The date to convert
   * @returns {string} Formatted date string
   */
  static generateDateId(date) {
    return date.toISOString().split('T')[0];
  }

  /**
   * Converts this model to a Firestore document
   * @returns {Object} Firestore document representation
   */
  toFirestore() {
    return {
      userId: this.userId,
      dateId: this.dateId,
      date: this.date,
      ouraScore: this.ouraScore,
      metrics: this.metrics,
      tags: this.tags,
      notes: this.notes
    };
  }

  /**
   * Creates a SleepData model from a Firestore document
   * @param {Object} doc - Firestore document data
   * @returns {SleepData} SleepData model instance
   */
  static fromFirestore(doc) {
    const data = doc.data();
    // Handle Firestore timestamps
    const date = data.date?.toDate ? data.date.toDate() : data.date;
    
    return new SleepData({
      ...data,
      id: doc.id,
      date
    });
  }
}

module.exports = SleepData;