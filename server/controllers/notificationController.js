const admin = require('firebase-admin');

/**
 * Helper function to ensure parent notification document exists and is properly initialized
 * @param {string} userId - The user ID
 * @returns {Promise<FirebaseFirestore.DocumentReference>} Reference to the notification parent document
 */
async function ensureNotificationParent(userId) {
  try {
    const firestore = admin.firestore();
    const docRef = firestore.collection('notifications').doc(userId);
    const docSnapshot = await docRef.get();
    
    if (!docSnapshot.exists) {
      console.log(`Creating parent notification document for user: ${userId}`);
      await docRef.set({
        userId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        unreadCount: 0,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    return docRef;
  } catch (error) {
    console.error(`Error ensuring notification parent for user ${userId}:`, error);
    throw error;
  }
}

// Get user notifications
const getUserNotifications = async (req, res) => {
  const firestore = admin.firestore();

  try {
    const userId = req.userId;
    const { limit = 20, offset = 0, unreadOnly = false } = req.query;

    // Convert query params to numbers
    const numLimit = parseInt(limit);
    const numOffset = parseInt(offset);
    const boolUnreadOnly = unreadOnly === 'true';

    // Validate query params
    if (isNaN(numLimit) || isNaN(numOffset) || numLimit <= 0 || numOffset < 0) {
      return res.status(400).json({ error: 'Invalid pagination parameters' });
    }


    // Build query
    let query = firestore
      .collection('notifications')
      .doc(userId)
      .collection('items')
      .orderBy('createdAt', 'desc');

    if (boolUnreadOnly) {
      query = query.where('read', '==', false);
    }

    // Execute query with pagination
    const snapshot = await query.limit(numLimit).offset(numOffset).get();

    if (snapshot.empty) {
      return res.status(200).json({ notifications: [] });
    }

    // Get total count for pagination
    const countSnapshot = boolUnreadOnly
      ? await firestore
          .collection('notifications')
          .doc(userId)
          .collection('items')
          .where('read', '==', false)
          .count()
          .get()
      : await firestore
          .collection('notifications')
          .doc(userId)
          .collection('items')
          .count()
          .get();

    const totalCount = countSnapshot.data().count;

    // Process notifications
    const notifications = [];
    snapshot.forEach(doc => {
      notifications.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return res.status(200).json({
      notifications,
      pagination: {
        total: totalCount,
        limit: numLimit,
        offset: numOffset,
        hasMore: numOffset + notifications.length < totalCount
      }
    });
  } catch (error) {
    console.error('Error getting user notifications:', error);
    return res.status(500).json({ error: 'Failed to retrieve notifications' });
  }
};

// Mark a notification as read
const markNotificationRead = async (req, res) => {
  try {
    const userId = req.userId;
    const { notificationId } = req.params;

    // Check if notification exists
    const notificationRef = firestore
      .collection('notifications')
      .doc(userId)
      .collection('items')
      .doc(notificationId);

    const notificationDoc = await notificationRef.get();

    if (!notificationDoc.exists) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    // Mark as read
    await notificationRef.update({ read: true });

    return res.status(200).json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    return res.status(500).json({ error: 'Failed to mark notification as read' });
  }
};

// Mark all notifications as read
const markAllNotificationsRead = async (req, res) => {
  const firestore = admin.firestore();

  try {
    const userId = req.userId;

    // Get all unread notifications
    const unreadSnapshot = await firestore
      .collection('notifications')
      .doc(userId)
      .collection('items')
      .where('read', '==', false)
      .get();

    if (unreadSnapshot.empty) {
      return res.status(200).json({ message: 'No unread notifications' });
    }

    // Use batch update for efficiency
    const batch = firestore.batch();

    unreadSnapshot.forEach(doc => {
      const notificationRef = firestore
        .collection('notifications')
        .doc(userId)
        .collection('items')
        .doc(doc.id);

      batch.update(notificationRef, { read: true });
    });

    await batch.commit();

    return res.status(200).json({
      message: 'All notifications marked as read',
      count: unreadSnapshot.size
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    return res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
};

// Get unread notification count
const getUnreadCount = async (req, res) => {
  const firestore = admin.firestore();

  try {
    const userId = req.userId;

    const countSnapshot = await firestore
      .collection('notifications')
      .doc(userId)
      .collection('items')
      .where('read', '==', false)
      .count()
      .get();

    const count = countSnapshot.data().count;

    return res.status(200).json({ unreadCount: count });
  } catch (error) {
    console.error('Error getting unread count:', error);
    return res.status(500).json({ error: 'Failed to get unread notification count' });
  }
};

// Delete a notification
const deleteNotification = async (req, res) => {
  const firestore = admin.firestore();

  try {
    const userId = req.userId;
    const { notificationId } = req.params;

    // Check if notification exists
    const notificationRef = firestore
      .collection('notifications')
      .doc(userId)
      .collection('items')
      .doc(notificationId);

    const notificationDoc = await notificationRef.get();

    if (!notificationDoc.exists) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    // Delete notification
    await notificationRef.delete();

    return res.status(200).json({ message: 'Notification deleted' });
  } catch (error) {
    console.error('Error deleting notification:', error);
    return res.status(500).json({ error: 'Failed to delete notification' });
  }
};

// Admin only: Create notification for a user
const createNotification = async (req, res) => {
  const firestore = admin.firestore();

  try {
    const { userId, type, title, message, data } = req.body;

    if (!userId || !type || !title || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if user exists
    const userDoc = await firestore.collection('users').doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create notification
    const notification = {
      type,
      title,
      message,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      read: false,
      data: data || {}
    };

    // Ensure the parent notification document exists
    await ensureNotificationParent(userId);

    // Add notification to subcollection
    const notificationRef = await firestore
      .collection('notifications')
      .doc(userId)
      .collection('items')
      .add(notification);
      
    // Update unread count in parent document
    await firestore
      .collection('notifications')
      .doc(userId)
      .update({
        unreadCount: admin.firestore.FieldValue.increment(1),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });

    return res.status(201).json({
      message: 'Notification created successfully',
      notificationId: notificationRef.id
    });
  } catch (error) {
    console.error('Error creating notification:', error);
    return res.status(500).json({ error: 'Failed to create notification' });
  }
};

// Admin only: Create notification for multiple users
const createBulkNotifications = async (req, res) => {
  try {
    const { userIds, type, title, message, data } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0 || !type || !title || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create notification object
    const notification = {
      type,
      title,
      message,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      read: false,
      data: data || {}
    };
    
    // First, validate users exist and ensure parent notification documents
    const firestore = admin.firestore();
    const validUsers = [];
    
    // Get all valid users in one query to improve performance
    const usersSnapshot = await firestore
      .collection('users')
      .where(admin.firestore.FieldPath.documentId(), 'in', 
        userIds.slice(0, Math.min(userIds.length, 30))) // Firestore 'in' clauses are limited to 30 values
      .get();
    
    const validUserIds = usersSnapshot.docs.map(doc => doc.id);
    console.log(`Found ${validUserIds.length} valid users out of ${userIds.length} requested`);
    
    // For larger sets, we'll need to process in chunks
    if (userIds.length > 30) {
      for (let i = 30; i < userIds.length; i += 30) {
        const chunk = userIds.slice(i, i + 30);
        const chunkedSnapshot = await firestore
          .collection('users')
          .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
          .get();
          
        chunkedSnapshot.docs.forEach(doc => validUserIds.push(doc.id));
      }
      console.log(`Total valid users after processing all chunks: ${validUserIds.length}`);
    }
    
    // Create parent notification documents for all valid users first
    for (const userId of validUserIds) {
      try {
        await ensureNotificationParent(userId);
      } catch (error) {
        console.error(`Error ensuring notification parent for user ${userId}:`, error);
        // Continue with other users even if one fails
      }
    }
    
    // Use batched writes for efficiency with items subcollection and unread counts
    const batches = [];
    const batchSize = 250; // Reduced from 500 since we have 2 operations per user now

    for (let i = 0; i < validUserIds.length; i += batchSize) {
      const batch = firestore.batch();
      const chunk = validUserIds.slice(i, i + batchSize);

      for (const userId of chunk) {
        // Add notification item
        const notificationRef = firestore
          .collection('notifications')
          .doc(userId)
          .collection('items')
          .doc(); // Auto-generate ID

        batch.set(notificationRef, notification);
        
        // Update parent document unread count
        const parentRef = firestore.collection('notifications').doc(userId);
        batch.update(parentRef, {
          unreadCount: admin.firestore.FieldValue.increment(1),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      batches.push(batch.commit());
    }

    await Promise.all(batches);

    return res.status(201).json({
      message: 'Bulk notifications created successfully',
      count: userIds.length
    });
  } catch (error) {
    console.error('Error creating bulk notifications:', error);
    return res.status(500).json({ error: 'Failed to create bulk notifications' });
  }
};

module.exports = {
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadCount,
  deleteNotification,
  createNotification,
  createBulkNotifications
};
