
// invitation statuses
export type InvitationStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED" ;

// invitation
export interface Invitation {
  id?: string;
  email: string;
  status: InvitationStatus;
  createdAt: Date;
  expiresAt: Date;
  invitedBy: string;
  code: string;
  acceptedByUid?: string;
  acceptedAt?: Date;
}

// create invitation request
export interface CreateInvitationRequest {
  email: string;
}

// validate invitation response
export interface ValidateInvitationResponse {
  valid: boolean;
  email?: string;
  expiresAt?: Date;
  error?: string;
}

// accept invitation
export interface AcceptInvitationRequest {
  code: string;
}

