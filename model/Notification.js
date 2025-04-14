/**
 * Notification model for Firebase Firestore
 * Represents user notifications for various events
 */
class Notification {
  /**
   * Creates a new Notification instance
   * @param {Object} data - Notification data
   */
  constructor(data = {}) {
    this.id = data.id || null;
    this.userId = data.userId || '';
    this.type = data.type || 'SYSTEM';
    this.title = data.title || '';
    this.message = data.message || '';
    this.createdAt = data.createdAt || new Date();
    this.read = data.read !== undefined ? data.read : false;
    this.data = data.data || {};
  }

  /**
   * Validates if the notification data is valid
   * @returns {Object} Validation result {valid: boolean, errors: string[]}
   */
  validate() {
    const errors = [];
    
    if (!this.userId) errors.push('User ID is required');
    if (!this.title) errors.push('Title is required');
    if (!this.message) errors.push('Message is required');
    
    const validTypes = ['SYSTEM', 'COMPETITION', 'INVITATION', 'ACHIEVEMENT', 'REMINDER'];
    if (!validTypes.includes(this.type)) {
      errors.push(`Type must be one of: ${validTypes.join(', ')}`);
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Marks the notification as read
   */
  markAsRead() {
    this.read = true;
  }

  /**
   * Converts this model to a Firestore document
   * @returns {Object} Firestore document representation
   */
  toFirestore() {
    return {
      userId: this.userId,
      type: this.type,
      title: this.title,
      message: this.message,
      createdAt: this.createdAt,
      read: this.read,
      data: this.data
    };
  }

  /**
   * Creates a Notification model from a Firestore document
   * @param {Object} doc - Firestore document data
   * @returns {Notification} Notification model instance
   */
  static fromFirestore(doc) {
    const data = doc.data();
    // Handle Firestore timestamps
    const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt;
    
    return new Notification({
      ...data,
      id: doc.id,
      createdAt
    });
  }
}

module.exports = Notification;