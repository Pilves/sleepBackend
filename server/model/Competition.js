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
    
    // Handle different date formats
    this.startDate = this.parseDate(data.startDate) || new Date();
    this.endDate = this.parseDate(data.endDate) || new Date();
    
    // Handle status
    if (data.status) {
      // Normalize status based on common mappings
      if (data.status.toLowerCase() === 'upcoming') {
        this.status = 'PENDING';
      } else if (data.status.toLowerCase() === 'active') {
        this.status = 'ACTIVE';
      } else if (data.status.toLowerCase() === 'completed') {
        this.status = 'COMPLETED';
      } else {
        this.status = data.status.toUpperCase();
      }
    } else {
      this.status = 'PENDING';
    }
    
    this.rules = data.rules || {};
    this.prizes = data.prizes || [];
    this.participants = data.participants || [];
    this.winners = data.winners || [];
  }
  
  /**
   * Helper method to parse dates in various formats
   * @param {*} dateInput - Date input in any format
   * @returns {Date|null} Parsed Date object or null if invalid
   */
  parseDate(dateInput) {
    if (!dateInput) return null;
    
    try {
      // If already a Date object, return it
      if (dateInput instanceof Date) return dateInput;
      
      // If it's an ISO string or other string format, convert to Date
      if (typeof dateInput === 'string') {
        const parsedDate = new Date(dateInput);
        // Check if the date is valid
        if (!isNaN(parsedDate.getTime())) {
          return parsedDate;
        }
      }
      
      // If it's a timestamp (number), convert to Date
      if (typeof dateInput === 'number') {
        return new Date(dateInput);
      }
      
      console.warn('Unable to parse date:', dateInput);
      return null;
    } catch (error) {
      console.error('Error parsing date:', dateInput, error);
      return null;
    }
  }

  /**
   * Validates if the competition data is valid
   * @returns {Object} Validation result {valid: boolean, errors: string[]}
   */
  validate() {
    const errors = [];
    
    console.log('Validating competition:', {
      title: this.title,
      description: this.description,
      type: this.type,
      startDate: this.startDate,
      endDate: this.endDate,
      status: this.status
    });
    
    if (!this.title || typeof this.title !== 'string') {
      errors.push('Title is required and must be a string');
      console.log('Title validation failed:', { title: this.title, type: typeof this.title });
    }
    if (this.title && this.title.length < 3) {
      errors.push('Title must be at least 3 characters');
      console.log('Title length validation failed:', { title: this.title, length: this.title.length });
    }
    
    if (!this.description || typeof this.description !== 'string') {
      errors.push('Description is required and must be a string');
      console.log('Description validation failed:', { description: this.description, type: typeof this.description });
    }
    if (this.description && this.description.length < 3) {
      errors.push('Description must be at least 3 characters');
      console.log('Description length validation failed:', { description: this.description, length: this.description.length });
    }
    
    const validTypes = ['DAILY', 'WEEKLY', 'CHALLENGE', 'CUSTOM', 
                    'highest_score', 'improvement', 'consistency', 'deep_sleep', 'efficiency'];
    if (!validTypes.includes(this.type)) {
      errors.push(`Type must be one of: ${validTypes.join(', ')}`);
      console.log('Type validation failed:', { type: this.type, validTypes });
    }
    
    if (!(this.startDate instanceof Date)) {
      errors.push('Start date is required and must be a valid date');
      console.log('Start date validation failed:', { startDate: this.startDate, type: typeof this.startDate });
    }
    
    if (!(this.endDate instanceof Date)) {
      errors.push('End date is required and must be a valid date');
      console.log('End date validation failed:', { endDate: this.endDate, type: typeof this.endDate });
    }
    
    if (this.startDate instanceof Date && this.endDate instanceof Date && this.startDate >= this.endDate) {
      errors.push('End date must be after start date');
      console.log('Date range validation failed:', { startDate: this.startDate, endDate: this.endDate });
    }
    
    const validStatuses = ['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 
                      'upcoming', 'active', 'completed'];
    if (!validStatuses.includes(this.status)) {
      errors.push(`Status must be one of: ${validStatuses.join(', ')}`);
      console.log('Status validation failed:', { status: this.status, validStatuses });
    }
    
    const result = {
      valid: errors.length === 0,
      errors
    };
    
    console.log('Validation result:', result);
    
    return result;
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