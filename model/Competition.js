/**
 * Competition model for Firebase Firestore
 * Represents a sleep competition in the Sleep Olympics application
 */
class Competition {
  /**
   * Creates a new Competition instance
   * @param {Object} data - Competition data
   */
  constructor(data = {}) {
    this.id = data.id || null;
    this.title = data.title || '';
    this.description = data.description || '';
    this.type = data.type || 'CHALLENGE';
    this.startDate = data.startDate || new Date();
    this.endDate = data.endDate || new Date();
    this.status = data.status || 'PENDING';
    this.rules = data.rules || {};
    this.prizes = data.prizes || [];
    this.participants = data.participants || [];
    this.winners = data.winners || [];
  }

  /**
   * Validates if the competition data is valid
   * @returns {Object} Validation result {valid: boolean, errors: string[]}
   */
  validate() {
    const errors = [];
    
    if (!this.title) errors.push('Title is required');
    if (!this.description) errors.push('Description is required');
    
    const validTypes = ['DAILY', 'WEEKLY', 'CHALLENGE', 'CUSTOM'];
    if (!validTypes.includes(this.type)) {
      errors.push(`Type must be one of: ${validTypes.join(', ')}`);
    }
    
    if (!(this.startDate instanceof Date)) errors.push('Start date is required');
    if (!(this.endDate instanceof Date)) errors.push('End date is required');
    
    const validStatuses = ['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED'];
    if (!validStatuses.includes(this.status)) {
      errors.push(`Status must be one of: ${validStatuses.join(', ')}`);
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Converts this model to a Firestore document
   * @returns {Object} Firestore document representation
   */
  toFirestore() {
    return {
      title: this.title,
      description: this.description,
      type: this.type,
      startDate: this.startDate,
      endDate: this.endDate,
      status: this.status,
      rules: this.rules,
      prizes: this.prizes,
      participants: this.participants,
      winners: this.winners
    };
  }

  /**
   * Creates a Competition model from a Firestore document
   * @param {Object} doc - Firestore document data
   * @returns {Competition} Competition model instance
   */
  static fromFirestore(doc) {
    const data = doc.data();
    // Handle Firestore timestamps
    const startDate = data.startDate?.toDate ? data.startDate.toDate() : data.startDate;
    const endDate = data.endDate?.toDate ? data.endDate.toDate() : data.endDate;
    
    return new Competition({
      ...data,
      id: doc.id,
      startDate,
      endDate
    });
  }
}

module.exports = Competition;