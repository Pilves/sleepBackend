

// common API response format
export interface ApiResponse<T = any> {
  data?: T;
  error?: {
    message: string;
    code: number;
    details?: any;
  };
  meta?: {
    requestId?: string;
    timestamp?: string;
  };
}

// pagination
export interface PaginationParams {
  page?: number;
  limit?: number;
  offset?: number;
}

// pagination metadata
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

//  date range
export interface DateRange {
  startDate: Date | string;
  endDate: Date | string;
}


// base entity w/ timestamp
export interface BaseEntity {
  createdAt?: Date;
  updatedAt?: Date;
}

// object with string keys
export type Dictionary<T> = { [key: string]: T };








