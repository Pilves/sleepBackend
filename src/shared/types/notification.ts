
// notification types
export type NotificationType = "SYSTEM" | "COMPETITION" | "INVITATION" | "ACHIEVEMENT" | "REMINDER" ;

// notification
export interface Notification {
  id?: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: Date;
  read: boolean;
  data?: any;
}

// notification request
export interface CreateNotificationRequest {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: any;
}

// bulk notification request
export interface BulkNotificationRequest {
  userIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  data?: any;
}


// notification count
export interface UnreadCount {
  unreadCount: number;
}

