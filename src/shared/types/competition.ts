
// competition types 
export type CompetitionType = "DAILY" | "WEEKLY" | "CHALLENGE" | "CUSTOM" | "highest_score" | "improvement" | "consistency" | "deep_sleep" | "efficiency";

// competition statuses
export type CompetitionStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "CANCELLED" | "upcoming" | "active" | "completed";


// competition rules
export interface  CompetitionRules {
  scoringMethod?: string;
  eligibilityCriteria?: {
    minimumTrackedNights?: number;
    minimumTenureDays?: number;
  };
  privateCompetition?: boolean;
  requiresInvitation?: boolean;
}


// competition prize
export interface CompetitionPrize {
  rank: number;
  description: string;
  value?: string;
}

// competition data
export interface Competition {
  id?: string;
  title: string;
  description: string;
  type: CompetitionType;
  startDate: Date;
  endDate: Date;
  status: CompetitionStatus;
  rules: CompetitionRules;
  prizes: CompetitionPrize[];
  participants: string[];
  winners: CompetitionWinner[];
}

// competition winner
export interface CompetitionWinner {
  userId: string;
  rank: number;
  score: number;
}

// leaderboard entry
export interface LeaderboardEntry {
  userId: string;
  position: number;
  score: number;
  username?: string;
}

// leaderboard entry 
export interface Leaderboard {
  id?: string;
  competitionId: string;
  generatedAt: Date;
  isLatest: boolean;
  rankings: LeaderboardEntry[];
}

// create competition request
export interface CreateCompetitionRequest {
  title: string;
  description: string;
  type: CompetitionType;
  startDate: Date | string;
  endDate: Date | string;
  status?: CompetitionStatus;
  rules?: CompetitionRules;
  prizes?: CompetitionPrize[];
}


  

