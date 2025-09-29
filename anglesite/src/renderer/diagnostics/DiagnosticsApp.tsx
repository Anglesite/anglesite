/**
 * @file Main Diagnostics Application component
 * @description Root component for the diagnostics window
 */
import React, { useState, useEffect, useCallback } from 'react';
import DiagnosticsLayout from './components/Layout/DiagnosticsLayout';
import DiagnosticsErrorBoundary from './components/Layout/ErrorBoundary';
import LoadingSpinner from './components/Layout/LoadingSpinner';
import ErrorDashboard from './components/Dashboard/ErrorDashboard';
import ErrorList from './components/ErrorList/ErrorList';
import ErrorFilters from './components/Filters/ErrorFilters';
import NotificationManager from './components/Notifications/NotificationManager';
import { useErrorFilters } from './hooks/useErrorFilters';
import { useRealTimeUpdates } from './hooks/useRealTimeUpdates';
import type { DiagnosticsUIState } from './types/diagnostics';
import { ErrorSeverity } from './types/diagnostics';
import type { ErrorStatistics as BaseErrorStatistics } from '../types/diagnostics.d';

const DiagnosticsApp: React.FC = () => {
  // Initialize error filtering hook
  const { filter, updateFilter, clearFilter, filterErrors } = useErrorFilters();

  // Initialize real-time updates hook
  const { realTimeState, errors, statistics, connect, disconnect, refresh, clearErrors } = useRealTimeUpdates({
    autoConnect: true,
    maxErrors: 1000,
    retryInterval: 5000,
    maxRetries: 3,
  });

  const [state, setState] = useState<Omit<DiagnosticsUIState, 'errors' | 'statistics' | 'realTime'>>({
    notifications: [],
    filteredErrors: [],
    serviceHealth: {
      isHealthy: true,
      errorReportingConnected: realTimeState.connected,
      activeSubscriptions: realTimeState.connected ? 1 : 0,
      pendingNotifications: 0,
    },
    loading: {
      errors: false,
      statistics: false,
      notifications: false,
    },
    error: {
      message: realTimeState.subscriptionError,
      type: realTimeState.subscriptionError ? 'connection' : null,
    },
    filter: {
      severity: [],
      category: [],
      dateRange: { start: null, end: null },
      searchText: '',
      isActive: false,
    },
  });

  const [isInitialized, setIsInitialized] = useState(false);
  const [selectedErrors, setSelectedErrors] = useState<string[]>([]);

  // Compute filtered errors using the filter hook
  const filteredErrors = filterErrors(errors);

  // Update service health based on real-time connection state
  useEffect(() => {
    setState((prev) => ({
      ...prev,
      serviceHealth: {
        ...prev.serviceHealth,
        errorReportingConnected: realTimeState.connected,
        activeSubscriptions: realTimeState.connected ? 1 : 0,
      },
      error: {
        message: realTimeState.subscriptionError,
        type: realTimeState.subscriptionError ? 'connection' : null,
      },
    }));

    // Mark as initialized once we have a connection state (even if failed)
    if (!isInitialized && (realTimeState.connected || realTimeState.subscriptionError)) {
      setIsInitialized(true);
    }
  }, [realTimeState, isInitialized]);

  // Error selection handlers
  const handleErrorSelect = useCallback((errorId: string) => {
    setSelectedErrors((prev) => {
      if (prev.includes(errorId)) {
        return prev.filter((id) => id !== errorId);
      }
      return [...prev, errorId];
    });
  }, []);

  const handleErrorsSelect = useCallback((errorIds: string[]) => {
    setSelectedErrors(errorIds);
  }, []);

  // Notification handlers
  const handleNotificationDismiss = useCallback((errorId: string) => {
    console.log('Notification dismissed for error:', errorId);
  }, []);

  const handleViewErrorDetails = useCallback((errorId: string) => {
    // Select the error and ensure it's visible in the error list
    setSelectedErrors([errorId]);
    console.log('Viewing details for error:', errorId);
  }, []);

  // Retry connection handler
  const handleRetry = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      error: { message: null, type: null },
    }));

    try {
      await connect();
    } catch (error) {
      console.error('Retry connection failed:', error);
    }
  }, [connect]);

  // Show initialization loading state
  if (!isInitialized && !state.error.message) {
    return (
      <DiagnosticsLayout loading={true}>
        <LoadingSpinner size="large" message="Initializing diagnostics interface..." testId="initialization-spinner" />
      </DiagnosticsLayout>
    );
  }

  return (
    <DiagnosticsErrorBoundary>
      <DiagnosticsLayout error={state.error.message} onRetry={handleRetry} data-testid="diagnostics-app">
        {/* Main Content */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '320px 1fr 1fr',
            gridTemplateRows: '1fr',
            height: '100%',
            gap: '0',
          }}
        >
          {/* Filters Section */}
          <div
            data-testid="filters-section"
            style={{ overflow: 'auto', borderRight: '1px solid var(--colorNeutralStroke2)' }}
          >
            <ErrorFilters filter={filter} onFilterChange={updateFilter} onFilterClear={clearFilter} />
          </div>

          {/* Dashboard Section */}
          <div data-testid="dashboard-section" style={{ overflow: 'auto' }}>
            <ErrorDashboard statistics={statistics} loading={state.loading.statistics} error={state.error.message} />
          </div>

          {/* Error List Section */}
          <div data-testid="error-list-section" style={{ overflow: 'auto' }}>
            <ErrorList
              errors={filteredErrors}
              loading={state.loading.errors}
              error={state.error.message}
              selectedErrors={selectedErrors}
              onErrorSelect={handleErrorSelect}
              onErrorsSelect={handleErrorsSelect}
            />

            {/* Filter Results Summary */}
            {filter.isActive && (
              <div
                style={{
                  position: 'sticky',
                  bottom: '0',
                  padding: '12px 16px',
                  backgroundColor: 'var(--colorNeutralBackground2)',
                  borderTop: '1px solid var(--colorNeutralStroke2)',
                  fontSize: '12px',
                  color: 'var(--colorNeutralForeground2)',
                  textAlign: 'center',
                }}
              >
                Showing {filteredErrors.length} of {errors.length} errors
                {filteredErrors.length !== errors.length && (
                  <span style={{ color: 'var(--colorBrandForeground1)' }}>
                    {' '}
                    ({errors.length - filteredErrors.length} hidden by filters)
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Real-time Notifications */}
        <NotificationManager
          errors={errors}
          maxVisible={3}
          autoDismissDelay={10000}
          severityFilter={[ErrorSeverity.CRITICAL, ErrorSeverity.HIGH]}
          onNotificationDismiss={handleNotificationDismiss}
          onViewErrorDetails={handleViewErrorDetails}
          enabled={realTimeState.connected}
        />

        {/* Development info */}
        {process.env.NODE_ENV === 'development' && (
          <div
            style={{
              position: 'fixed',
              bottom: '60px',
              right: '16px',
              backgroundColor: 'var(--colorNeutralBackground2)',
              padding: '8px 12px',
              borderRadius: '4px',
              fontSize: '12px',
              color: 'var(--colorNeutralForeground2)',
              border: '1px solid var(--colorNeutralStroke2)',
              zIndex: 1000,
            }}
          >
            <div>Service Health: {state.serviceHealth.isHealthy ? '✅' : '❌'}</div>
            <div>Connection: {realTimeState.connected ? '🟢' : '🔴'}</div>
            <div>API Available: {window.electronAPI?.diagnostics ? '✅' : '❌'}</div>
            <div>Errors: {errors.length}</div>
            <div>Filtered: {filteredErrors.length}</div>
            {realTimeState.lastUpdate && <div>Last Update: {realTimeState.lastUpdate.toLocaleTimeString()}</div>}
          </div>
        )}
      </DiagnosticsLayout>
    </DiagnosticsErrorBoundary>
  );
};

export default DiagnosticsApp;
