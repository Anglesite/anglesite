/**
 * @file TypeScript types for Diagnostics React components
 * @description Component-specific type definitions extending the base IPC types
 */

// Import and re-export the base diagnostics types from the IPC layer
import type { ErrorStatistics, ErrorNotification, ServiceHealth } from '../../types/diagnostics.d';
export type { ErrorStatistics, ErrorNotification, ServiceHealth };

// Component-specific types
export interface HourlyTrend {
  /** Hour in format "HH:MM" */
  hour: string;
  /** Number of errors in this hour */
  errorCount: number;
}
export interface ComponentError {
  id: string;
  message: string;
  code: string;
  severity: ErrorSeverity;
  category: ErrorCategory;
  timestamp: Date;
  metadata: {
    operation?: string;
    context?: Record<string, unknown>;
    stack?: string;
  };
}

export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum ErrorCategory {
  SYSTEM = 'SYSTEM',
  NETWORK = 'NETWORK',
  FILE_SYSTEM = 'FILE_SYSTEM',
  BUSINESS_LOGIC = 'BUSINESS_LOGIC',
  VALIDATION = 'VALIDATION',
  ATOMIC_OPERATION = 'ATOMIC_OPERATION',
  SECURITY = 'SECURITY',
  USER_INPUT = 'USER_INPUT',
  SERVICE_MANAGEMENT = 'SERVICE_MANAGEMENT',
  IPC_COMMUNICATION = 'IPC_COMMUNICATION',
  UI_COMPONENT = 'UI_COMPONENT',
  FILE_OPERATION = 'FILE_OPERATION',
  WEBSITE_MANAGEMENT = 'WEBSITE_MANAGEMENT',
  EXPORT_OPERATION = 'EXPORT_OPERATION',
}

// Real-time connection state
export interface RealTimeState {
  connected: boolean;
  lastUpdate: Date | null;
  subscriptionError: string | null;
}

// Filter state for UI components
export interface FilterState {
  severity: ErrorSeverity[];
  category: ErrorCategory[];
  dateRange: {
    start: Date | null;
    end: Date | null;
  };
  searchText: string;
  isActive: boolean;
}

// UI State interfaces
export interface DiagnosticsUIState {
  errors: ComponentError[];
  filteredErrors: ComponentError[];
  statistics: ErrorStatistics;
  notifications: ErrorNotification[];
  serviceHealth: ServiceHealth;
  loading: {
    errors: boolean;
    statistics: boolean;
    notifications: boolean;
  };
  error: {
    message: string | null;
    type: 'load' | 'connection' | 'operation' | null;
  };
  filter: FilterState;
  realTime: {
    connected: boolean;
    lastUpdate: Date | null;
    subscriptionError: string | null;
  };
}

// Component props interfaces
export interface ErrorListProps {
  errors: ComponentError[];
  loading?: boolean;
  onErrorSelect?: (errorId: string) => void;
  onErrorsSelect?: (errorIds: string[]) => void;
  selectedErrors?: string[];
  className?: string;
}

export interface ErrorListItemProps {
  error: ComponentError;
  isSelected?: boolean;
  isExpanded?: boolean;
  onSelect?: (errorId: string) => void;
  onToggleExpand?: (errorId: string) => void;
  className?: string;
}

export interface ErrorDashboardProps {
  statistics: ErrorStatistics;
  serviceHealth: ServiceHealth;
  loading?: boolean;
  onRefresh?: () => void;
  className?: string;
}

export interface ErrorFiltersProps {
  filter: FilterState;
  onFilterChange: (filter: Partial<FilterState>) => void;
  onFilterClear: () => void;
  availableCategories?: ErrorCategory[];
  className?: string;
}

export interface NotificationPanelProps {
  notifications: ErrorNotification[];
  onDismiss: (notificationId: string) => void;
  onDismissAll: () => void;
  className?: string;
}

// Utility types for component state management
export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  data: T | null;
  status: LoadingState;
  error: string | null;
  lastUpdated: Date | null;
}

// Hook return types
export interface UseDiagnosticsDataReturn {
  state: DiagnosticsUIState;
  actions: {
    refreshErrors: () => Promise<void>;
    refreshStatistics: () => Promise<void>;
    refreshNotifications: () => Promise<void>;
    clearErrors: (errorIds?: string[]) => Promise<void>;
    dismissNotification: (notificationId: string) => Promise<void>;
    exportErrors: (filter?: Partial<FilterState>) => Promise<string>;
  };
}

export interface UseErrorFiltersReturn {
  filter: FilterState;
  filteredErrors: ComponentError[];
  actions: {
    updateFilter: (update: Partial<FilterState>) => void;
    clearFilter: () => void;
    setSearchText: (text: string) => void;
    setSeverityFilter: (severities: ErrorSeverity[]) => void;
    setCategoryFilter: (categories: ErrorCategory[]) => void;
    setDateRange: (start: Date | null, end: Date | null) => void;
  };
}

export interface UseRealTimeErrorsReturn {
  isConnected: boolean;
  connectionError: string | null;
  lastUpdate: Date | null;
  connect: () => void;
  disconnect: () => void;
}

// Chart and visualization types
export interface TrendDataPoint {
  timestamp: Date;
  count: number;
  hour: string; // Human readable hour label
}

export interface SeverityDistribution {
  severity: ErrorSeverity;
  count: number;
  percentage: number;
  color: string;
}

export interface CategoryDistribution {
  category: ErrorCategory;
  count: number;
  percentage: number;
  displayName: string;
}

// Theme integration types
export interface DiagnosticsTheme {
  colors: {
    background: {
      primary: string;
      secondary: string;
      card: string;
    };
    text: {
      primary: string;
      secondary: string;
      muted: string;
    };
    status: {
      success: string;
      warning: string;
      error: string;
      info: string;
    };
    severity: {
      [K in ErrorSeverity]: string;
    };
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  borderRadius: string;
  shadows: {
    card: string;
    modal: string;
  };
}

// Error boundary types
export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: { componentStack: string } | null;
}

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<{ error: Error; retry: () => void }>;
  onError?: (error: Error, errorInfo: { componentStack: string }) => void;
}

// Layout and navigation types
export interface LayoutProps {
  children: React.ReactNode;
  title?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

// Export configuration types
export interface ExportConfig {
  format: 'json' | 'csv' | 'txt';
  includeMetadata: boolean;
  includeStackTraces: boolean;
  dateRange?: {
    start: Date;
    end: Date;
  };
  filter?: Partial<FilterState>;
}

export interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (config: ExportConfig) => Promise<void>;
  totalErrors: number;
  filteredErrors: number;
}
