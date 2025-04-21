
// user profile data
export interface UserProfileData {
  gender?: "male" | "female" | "other" | "prefer not to say";
  age?: number;
  aboutMe?: string;
  profilePicture?: string;
}

// notification preferences
export interface NotificationPreferences {
  email: boolean;
  inApp: boolean;
}

// oura integration
export interface OuraIntegration {
  connected: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
  lastRefreshed?: Date;
  lastSyncDate?: Date;
  connectedAt?: Date;
  tokenInvalid?: boolean;
  userId?: string;
}

// competition participation
export interface UserCompetitions {
  participating: string[];
  won: string[];
}


// user data
export interface userData {
  id?: number;
  email: string;
  username: string;
  createdAt?: Date;
  updatedAt?: Date;
  isActive: boolean;
  isAdmin: boolean;
  profileData: UserProfileData;
  OuraIntegration: OuraIntegration;
  notifications: NotificationPreferences;
  competitions: UserCompetitions;
  roles: string[];
}

// profile update request
export interface ProfileUpdateRequest {
  username?: string;
  profileData?: Partial<UserProfileData>;
  notifications?: Partial<NotificationPreferences>;
}


