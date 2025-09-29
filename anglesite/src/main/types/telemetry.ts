export interface TelemetryEvent {
  id: string;
  timestamp: number;
  sessionId: string;
  version: string;
  environment: 'production' | 'development' | 'test';

  error: {
    message: string;
    stack?: string;
    componentStack?: string;
    errorBoundary?: string;
    errorBoundaryStack?: string;
  };

  component?: {
    name: string;
    props?: Record<string, unknown>;
    state?: Record<string, unknown>;
    hierarchy: string[];
  };

  context?: {
    userAction?: string;
    route?: string;
    websiteId?: string;
  };

  system: {
    platform: NodeJS.Platform;
    electronVersion: string;
    nodeVersion: string;
    memory: {
      used: number;
      total: number;
    };
  };
}

export interface TelemetryConfig {
  enabled: boolean;
  samplingRate: number; // 0-1
  maxBatchSize: number;
  batchIntervalMs: number;
  maxStorageMb: number;
  retentionDays: number;
  anonymizeErrors: boolean;
  endpoints?: TelemetryEndpoint[];
}

export interface TelemetryEndpoint {
  url: string;
  apiKey?: string;
  enabled: boolean;
  filter?: (event: TelemetryEvent) => boolean;
  retryConfig?: {
    maxRetries: number;
    backoffMs: number;
    maxBackoffMs: number;
  };
}

export interface TelemetryStats {
  totalEvents: number;
  eventsLast24h: number;
  eventsLast7d: number;
  eventsLast30d: number;
  topErrors: Array<{
    message: string;
    count: number;
    lastSeen: number;
  }>;
  topComponents: Array<{
    name: string;
    errorCount: number;
  }>;
  storageUsedMb: number;
}

export interface TelemetryQuery {
  startTime?: number;
  endTime?: number;
  componentName?: string;
  errorMessage?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'timestamp' | 'component' | 'error';
  order?: 'asc' | 'desc';
}

export interface TelemetryExport {
  format: 'json' | 'csv' | 'ndjson';
  query?: TelemetryQuery;
  includeSystemInfo?: boolean;
  anonymize?: boolean;
}
