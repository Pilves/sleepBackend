/**
 * User model for Firebase Firestore
 * Represents a user in the Sleep Olympics application
 */
class User {
  /**
   * Creates a new User instance
   * @param {Object} data - User data
   */
  constructor(data = {}) {
    this.email = data.email || '';
    this.username = data.username || '';
    this.displayName = data.displayName || '';
    this.createdAt = data.createdAt || new Date();
    this.isActive = data.isActive !== undefined ? data.isActive : true;
    this.profileData = data.profileData || {};
    this.ouraIntegration = data.ouraIntegration || { connected: false };
    this.notifications = data.notifications || { email: true, inApp: true };
    this.competitions = data.competitions || { participating: [], won: [] };
    this.roles = data.roles || ['user'];
  }

  /**
   * Converts this model to a Firestore document
   * @returns {Object} Firestore document representation
   */
  toFirestore() {
    return {
      email: this.email,
      username: this.username,
      displayName: this.displayName,
      createdAt: this.createdAt,
      isActive: this.isActive,
      profileData: this.profileData,
      ouraIntegration: this.ouraIntegration,
      notifications: this.notifications,
      competitions: this.competitions,
      roles: this.roles
    };
  }

  /**
   * Creates a User model from a Firestore document
   * @param {Object} doc - Firestore document data
   * @returns {User} User model instance
   */
  static fromFirestore(doc) {
    const data = doc.data();
    return new User({
      ...data,
      id: doc.id
    });
  }
}

module.exports = User;