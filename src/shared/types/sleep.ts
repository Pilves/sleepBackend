
// sleep metrics
export interface SleepMetrics {
  totalSleepTime: number;
  efficienty: number;
  deepSleep: number;
  remSleep: number;
  lightSleep: number;
  latency: number;
  heartRate?: {
    average: number;
    lowest: number;
  };
  hrv?: number;
  respiratoryRate?: number;
}

// sleep data source
export interface SleepSourceData {
  provider: "oura" | "manual";
  providerUserId?: string;
  sourceType: string;
  sourceId: string;
}

// sleep data 
export interface SleepData {
  id?: string;
  userId: string;
  dateId: string;
  date: Date;
  ouraScore: number;
  metrics: SleepMetrics;
  tags: string[];
  notes: string;
  sourceData?: SleepSourceData;
}

// sleep summary
export interface SleepSummary {
  userId: string;
  updated: Date;
  currentMonth: {
    average: number;
    startDate: Date;
    endDate: Date;
  };
  previousMonth: {
    average: number;
    startDate: Date;
    endDate: Date;
  };
  overall: {
    average: number;
    bestScore: number;
    bestScoreDate: Date | null;
    worstScore: number;
    worstScoreDate: Date | null;
  };
  streaks: {
    goodScore: {
      current: number;
      longest: number;
      longestStart: Date | null;
      longestEnd: Date | null;
    };
    perfectScore: {
      current: number;
      longest: number;
      longestStart: Date | null;
      longestEnd: Date | null;
    };
  };
  monthlyTrend: Array<{
    month: string;
    average: number;
  }>;
}

// oura sync response
export interface SyncResult {
  message: string;
  recordsProcessed: number;
  recordsInvalid: number;
  recordsTotal: number;
  tokenExpired?: booleian;
  noConnection?: boolean;
}


// sleep note update
export interface SleepNoteRequest {
  note?: string;
  tags?: string;
}



