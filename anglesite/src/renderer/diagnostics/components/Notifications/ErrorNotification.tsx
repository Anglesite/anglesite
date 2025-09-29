/**
 * @file Critical Error Notification component
 * @description Displays urgent error notifications with actions
 */
import React, { useCallback } from 'react';
import { FluentButton } from '../../../ui/react/fluent/FluentButton';
import type { ComponentError } from '../../types/diagnostics';

export interface ErrorNotificationProps {
  /** The error to display */
  error: ComponentError;
  /** Whether the notification is visible */
  isVisible: boolean;
  /** Callback when notification is dismissed */
  onDismiss: (errorId: string) => void;
  /** Callback when user wants to view error details */
  onViewDetails?: (errorId: string) => void;
  /** Callback when user wants to copy error info */
  onCopy?: (errorId: string) => void;
  /** Auto-dismiss after specified ms (0 = no auto-dismiss) */
  autoDismissDelay?: number;
  /** Additional CSS class */
  className?: string;
}

const ErrorNotification: React.FC<ErrorNotificationProps> = ({
  error,
  isVisible,
  onDismiss,
  onViewDetails,
  onCopy,
  autoDismissDelay = 0,
  className = '',
}) => {
  // Handle dismiss
  const handleDismiss = useCallback(() => {
    onDismiss(error.id);
  }, [error.id, onDismiss]);

  // Handle view details
  const handleViewDetails = useCallback(() => {
    onViewDetails?.(error.id);
  }, [error.id, onViewDetails]);

  // Handle copy
  const handleCopy = useCallback(async () => {
    try {
      const errorText = [
        `Error: ${error.message}`,
        `Code: ${error.code}`,
        `Severity: ${error.severity}`,
        `Category: ${error.category}`,
        `Time: ${error.timestamp.toISOString()}`,
        error.metadata?.operation && `Operation: ${error.metadata.operation}`,
        error.metadata?.stack && `Stack: ${error.metadata.stack}`,
      ]
        .filter(Boolean)
        .join('\n');

      if (window.electronAPI?.clipboard) {
        await window.electronAPI.clipboard.writeText(errorText);
      } else {
        await navigator.clipboard.writeText(errorText);
      }

      onCopy?.(error.id);
    } catch (err) {
      console.error('Failed to copy error:', err);
    }
  }, [error, onCopy]);

  // Auto-dismiss effect
  React.useEffect(() => {
    if (isVisible && autoDismissDelay > 0) {
      const timer = setTimeout(handleDismiss, autoDismissDelay);
      return () => clearTimeout(timer);
    }
  }, [isVisible, autoDismissDelay, handleDismiss]);

  // Get severity color and icon
  const getSeverityStyle = () => {
    switch (error.severity) {
      case 'CRITICAL':
        return {
          color: '#d13438',
          backgroundColor: '#fdf2f2',
          borderColor: '#d13438',
          icon: '🔴',
        };
      case 'HIGH':
        return {
          color: '#e3630b',
          backgroundColor: '#fef9f5',
          borderColor: '#e3630b',
          icon: '🟠',
        };
      case 'MEDIUM':
        return {
          color: '#0066cc',
          backgroundColor: '#f5f9ff',
          borderColor: '#0066cc',
          icon: '🔵',
        };
      case 'LOW':
        return {
          color: '#107c10',
          backgroundColor: '#f5fff5',
          borderColor: '#107c10',
          icon: '🟢',
        };
      default:
        return {
          color: '#323130',
          backgroundColor: '#f8f8f8',
          borderColor: '#8a8886',
          icon: '⚪',
        };
    }
  };

  const severityStyle = getSeverityStyle();

  // Format time relative to now
  const formatTimeAgo = (timestamp: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - timestamp.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes === 1) return '1 minute ago';
    if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
    if (diffHours === 1) return '1 hour ago';
    if (diffHours < 24) return `${diffHours} hours ago`;
    return timestamp.toLocaleDateString();
  };

  if (!isVisible) {
    return null;
  }

  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    top: '20px',
    right: '20px',
    width: '380px',
    maxWidth: 'calc(100vw - 40px)',
    backgroundColor: severityStyle.backgroundColor,
    border: `2px solid ${severityStyle.borderColor}`,
    borderRadius: '8px',
    padding: '16px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08)',
    zIndex: 10000,
    animation: 'slideInFromRight 0.3s ease-out',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: '12px',
  };

  const titleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: '14px',
    fontWeight: 600,
    color: severityStyle.color,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };

  const messageStyle: React.CSSProperties = {
    fontSize: '13px',
    color: '#323130',
    lineHeight: '1.4',
    marginBottom: '12px',
    wordBreak: 'break-word',
  };

  const metaStyle: React.CSSProperties = {
    fontSize: '11px',
    color: '#605e5c',
    marginBottom: '12px',
  };

  const actionsStyle: React.CSSProperties = {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  };

  const closeButtonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#605e5c',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '3px',
    fontSize: '16px',
    lineHeight: 1,
  };

  return (
    <>
      <style>
        {`
          @keyframes slideInFromRight {
            from {
              transform: translateX(100%);
              opacity: 0;
            }
            to {
              transform: translateX(0);
              opacity: 1;
            }
          }
        `}
      </style>
      <div
        className={className}
        style={containerStyle}
        data-testid={`error-notification-${error.id}`}
        role="alert"
        aria-live="assertive"
      >
        {/* Header */}
        <div style={headerStyle}>
          <h4 style={titleStyle}>
            <span>{severityStyle.icon}</span>
            <span>
              {error.severity.toLowerCase().charAt(0).toUpperCase() + error.severity.toLowerCase().slice(1)} Error
            </span>
          </h4>
          <button
            style={closeButtonStyle}
            onClick={handleDismiss}
            title="Dismiss notification"
            data-testid="dismiss-notification"
          >
            ✕
          </button>
        </div>

        {/* Error Message */}
        <div style={messageStyle} data-testid="error-message">
          {error.message}
        </div>

        {/* Metadata */}
        <div style={metaStyle}>
          <div>
            Code: <strong>{error.code}</strong>
          </div>
          <div>
            Time: <strong>{formatTimeAgo(error.timestamp)}</strong>
          </div>
          {error.metadata?.operation && (
            <div>
              Operation: <strong>{error.metadata.operation}</strong>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={actionsStyle}>
          <FluentButton
            appearance="outline"
            size="small"
            onClick={handleCopy}
            data-testid="copy-error-notification"
            title="Copy error details to clipboard"
          >
            Copy
          </FluentButton>

          {onViewDetails && (
            <FluentButton
              appearance="accent"
              size="small"
              onClick={handleViewDetails}
              data-testid="view-error-details"
              title="View full error details"
            >
              Details
            </FluentButton>
          )}

          <FluentButton
            appearance="neutral"
            size="small"
            onClick={handleDismiss}
            data-testid="dismiss-error-notification"
            title="Dismiss this notification"
          >
            Dismiss
          </FluentButton>
        </div>
      </div>
    </>
  );
};

export default ErrorNotification;
