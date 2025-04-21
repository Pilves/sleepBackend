
// auth tokens
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// login request
export interface LoginRequest {
  email: string;
  password: string;
}

// register request 
export interface RegisterRequest {
  email: string;
  password: string;
  username: string;
  invitationCode: string;
}

// password reset
export interface PasswordResetRequest {
  email: string;
}

// refresh token
export interface RefreshTokenData {
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt?: Date;
}


