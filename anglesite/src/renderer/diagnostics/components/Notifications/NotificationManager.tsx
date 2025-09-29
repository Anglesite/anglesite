/**
 * @file Notification Manager component
 * @description Manages display of multiple error notifications with queueing and positioning
 */
import React, { useState, useCallback, useEffect } from 'react';
import ErrorNotification from './ErrorNotification';
import type { ComponentError } from '../../types/diagnostics';
import { ErrorSeverity } from '../../types/diagnostics';

export interface NotificationState {
  id: string;
  error: ComponentError;
  timestamp: Date;
  dismissed: boolean;
}

export interface NotificationManagerProps {
  /** Errors to potentially show as notifications */
  errors: ComponentError[];
  /** Maximum number of simultaneous notifications (default: 3) */
  maxVisible?: number;
  /** Auto-dismiss delay in ms (0 = no auto-dismiss, default: 10000) */
  autoDismissDelay?: number;
  /** Only show notifications for these severity levels */
  severityFilter?: ComponentError['severity'][];
  /** Callback when notification is dismissed */
  onNotificationDismiss?: (errorId: string) => void;
  /** Callback when user views error details */
  onViewErrorDetails?: (errorId: string) => void;
  /** Whether to show notifications (default: true) */
  enabled?: boolean;
  /** Additional CSS class */
  className?: string;
}

const NotificationManager: React.FC<NotificationManagerProps> = ({
  errors,
  maxVisible = 3,
  autoDismissDelay = 10000,
  severityFilter = [ErrorSeverity.CRITICAL, ErrorSeverity.HIGH],
  onNotificationDismiss,
  onViewErrorDetails,
  enabled = true,
  className = '',
}) => {
  const [notifications, setNotifications] = useState<NotificationState[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Handle notification dismissal
  const handleDismiss = useCallback(
    (errorId: string) => {
      setDismissedIds((prev) => new Set(prev).add(errorId));
      setNotifications((prev) => prev.filter((notification) => notification.id !== errorId));
      onNotificationDismiss?.(errorId);
    },
    [onNotificationDismiss]
  );

  // Handle copying notification
  const handleCopy = useCallback((errorId: string) => {
    // Optional callback for copy actions (could be used for analytics)
    console.log('Error notification copied:', errorId);
  }, []);

  // Handle viewing error details
  const handleViewDetails = useCallback(
    (errorId: string) => {
      // Dismiss notification when details are viewed
      handleDismiss(errorId);
      onViewErrorDetails?.(errorId);
    },
    [handleDismiss, onViewErrorDetails]
  );

  // Process new errors and create notifications
  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Filter errors that should become notifications
    const newNotificationErrors = errors.filter((error) => {
      return (
        severityFilter.includes(error.severity) && // Matches severity filter
        !dismissedIds.has(error.id) && // Not manually dismissed
        !notifications.some((n) => n.id === error.id) // Not already showing
      );
    });

    if (newNotificationErrors.length === 0) {
      return;
    }

    // Create new notifications
    const newNotifications: NotificationState[] = newNotificationErrors.map((error) => ({
      id: error.id,
      error,
      timestamp: new Date(),
      dismissed: false,
    }));

    setNotifications((prev) => {
      // Combine existing and new notifications
      const combined = [...prev, ...newNotifications];

      // Sort by timestamp (newest first) and limit to maxVisible
      return combined.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, maxVisible);
    });
  }, [errors, severityFilter, dismissedIds, notifications, maxVisible, enabled]);

  // Clean up dismissed notifications periodically
  useEffect(() => {
    const interval = setInterval(
      () => {
        // Clear dismissed IDs older than 5 minutes to prevent memory leaks
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        setDismissedIds((prev) => {
          const filtered = new Set<string>();
          // Note: We can't easily filter by timestamp here since we don't store it
          // For now, we'll keep the Set bounded by clearing old entries periodically
          const recentDismissed = Array.from(prev).slice(-100); // Keep last 100 dismissed IDs
          recentDismissed.forEach((id) => filtered.add(id));
          return filtered;
        });
      },
      5 * 60 * 1000
    ); // Run every 5 minutes

    return () => clearInterval(interval);
  }, []);

  if (!enabled || notifications.length === 0) {
    return null;
  }

  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    top: '20px',
    right: '20px',
    zIndex: 10000,
    pointerEvents: 'none',
  };

  return (
    <div className={className} style={containerStyle} data-testid="notification-manager">
      {notifications.map((notification, index) => (
        <div
          key={notification.id}
          style={{
            marginBottom: index < notifications.length - 1 ? '12px' : '0',
            pointerEvents: 'auto',
          }}
        >
          <ErrorNotification
            error={notification.error}
            isVisible={true}
            onDismiss={handleDismiss}
            onViewDetails={onViewErrorDetails ? handleViewDetails : undefined}
            onCopy={handleCopy}
            autoDismissDelay={autoDismissDelay}
          />
        </div>
      ))}
    </div>
  );
};

export default NotificationManager;
