/**
 * Invitation model for Firebase Firestore
 * Represents an invitation to join the Sleep Olympics platform
 */
class Invitation {
  /**
   * Creates a new Invitation instance
   * @param {Object} data - Invitation data
   */
  constructor(data = {}) {
    this.id = data.id || null;
    this.email = data.email || '';
    this.status = data.status || 'PENDING';
    this.createdAt = data.createdAt || new Date();
    this.expiresAt = data.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default 7 days
    this.invitedBy = data.invitedBy || '';
    this.code = data.code || '';
  }

  /**
   * Validates if the invitation data is valid
   * @returns {Object} Validation result {valid: boolean, errors: string[]}
   */
  validate() {
    const errors = [];

    if (!this.email) errors.push('Email is required');
    if (!this.invitedBy) errors.push('Invited by is required');
    if (!this.code) errors.push('Invitation code is required');

    if (!(this.expiresAt instanceof Date)) errors.push('Expiration date is required');

    const validStatuses = ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED'];
    if (!validStatuses.includes(this.status)) {
      errors.push(`Status must be one of: ${validStatuses.join(', ')}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Checks if the invitation is valid (not expired or used)
   * @returns {boolean} Whether the invitation is valid
   */
  isValid() {
    const now = new Date();
    return this.status === 'PENDING' && this.expiresAt > now;
  }

  /**
   * Accepts the invitation
   * @returns {boolean} Whether the invitation was accepted
   */
  accept() {
    if (!this.isValid()) return false;
    this.status = 'ACCEPTED';
    return true;
  }

  /**
   * Rejects the invitation
   * @returns {boolean} Whether the invitation was rejected
   */
  reject() {
    if (!this.isValid()) return false;
    this.status = 'REJECTED';
    return true;
  }

  /**
   * Generates a random invitation code
   * @returns {string} A unique invitation code
   */
  static generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 12; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Converts this model to a Firestore document
   * @returns {Object} Firestore document representation
   */
  toFirestore() {
    return {
      email: this.email,
      status: this.status,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
      invitedBy: this.invitedBy,
      code: this.code
    };
  }

  /**
   * Creates an Invitation model from a Firestore document
   * @param {Object} doc - Firestore document data
   * @returns {Invitation} Invitation model instance
   */
  static fromFirestore(doc) {
    const data = doc.data();
    const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt;
    const expiresAt = data.expiresAt?.toDate ? data.expiresAt.toDate() : data.expiresAt;

    return new Invitation({
      ...data,
      id: doc.id,
      createdAt,
      expiresAt
    });
  }
}

module.exports = Invitation;
