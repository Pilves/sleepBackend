/**
 * Leaderboard model for Firebase Firestore
 * Represents competition rankings at a specific point in time
 */
class Leaderboard {
  /**
   * Creates a new Leaderboard instance
   * @param {Object} data - Leaderboard data
   */
  constructor(data = {}) {
    this.id = data.id || null;
    this.competitionId = data.competitionId || '';
    this.generatedAt = data.generatedAt || new Date();
    this.isLatest = data.isLatest !== undefined ? data.isLatest : true;
    this.rankings = data.rankings || [];
  }

  /**
   * Adds or updates a user's ranking
   * @param {Object} ranking - The ranking data
   * @returns {boolean} Whether the ranking was updated
   */
  updateRanking(ranking) {
    if (!ranking || !ranking.userId) return false;
    
    const existingIndex = this.rankings.findIndex(r => r.userId === ranking.userId);
    
    if (existingIndex >= 0) {
      // Update existing ranking
      this.rankings[existingIndex] = { 
        ...this.rankings[existingIndex],
        ...ranking
      };
    } else {
      // Add new ranking
      this.rankings.push(ranking);
    }
    
    return true;
  }

  /**
   * Sorts rankings by score (descending) and assigns positions
   */
  sortAndAssignPositions() {
    // Sort by score (descending)
    this.rankings.sort((a, b) => b.score - a.score);
    
    // Assign positions
    this.rankings.forEach((ranking, index) => {
      ranking.position = index + 1;
    });
  }

  /**
   * Converts this model to a Firestore document
   * @returns {Object} Firestore document representation
   */
  toFirestore() {
    return {
      competitionId: this.competitionId,
      generatedAt: this.generatedAt,
      isLatest: this.isLatest,
      rankings: this.rankings
    };
  }

  /**
   * Creates a Leaderboard model from a Firestore document
   * @param {Object} doc - Firestore document data
   * @returns {Leaderboard} Leaderboard model instance
   */
  static fromFirestore(doc) {
    const data = doc.data();
    // Handle Firestore timestamps
    const generatedAt = data.generatedAt?.toDate ? data.generatedAt.toDate() : data.generatedAt;
    
    return new Leaderboard({
      ...data,
      id: doc.id,
      generatedAt
    });
  }
}

module.exports = Leaderboard;