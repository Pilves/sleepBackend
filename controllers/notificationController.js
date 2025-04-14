const admin = require('firebase-admin');

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

    const notificationRef = await firestore
      .collection('notifications')
      .doc(userId)
      .collection('items')
      .add(notification);

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

    // Use batched writes for efficiency
    const batches = [];
    const batchSize = 500; // Firestore limits batches to 500 operations

    for (let i = 0; i < userIds.length; i += batchSize) {
      const firestore = admin.firestore();

      const batch = firestore.batch();
      const chunk = userIds.slice(i, i + batchSize);

      for (const userId of chunk) {
        const notificationRef = firestore
          .collection('notifications')
          .doc(userId)
          .collection('items')
          .doc(); // Auto-generate ID

        batch.set(notificationRef, notification);
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
