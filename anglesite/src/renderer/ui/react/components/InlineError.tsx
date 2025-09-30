/**
 * @file Inline error display component for user-friendly errors
 *
 * Displays friendly error messages inline with optional retry button
 * and collapsible technical details.
 */

import React, { useState } from 'react';
import { FriendlyError } from '../../../utils/error-translator';
import { ErrorSeverity } from '../../../types/errors';

interface InlineErrorProps {
  error: FriendlyError | null;
  onRetry?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
}

/**
 * Inline error display component
 * Shows user-friendly error messages with optional actions
 */
export const InlineError: React.FC<InlineErrorProps> = ({ error, onRetry, onDismiss, compact = false }) => {
  const [showDetails, setShowDetails] = useState(false);

  if (!error) return null;

  // Determine color scheme based on severity
  const getSeverityStyles = () => {
    switch (error.severity) {
      case ErrorSeverity.CRITICAL:
        return {
          background: '#f8d7da',
          color: '#721c24',
          border: '#f5c6cb',
        };
      case ErrorSeverity.HIGH:
        return {
          background: '#fff3cd',
          color: '#856404',
          border: '#ffeaa7',
        };
      case ErrorSeverity.MEDIUM:
        return {
          background: '#f8d7da',
          color: '#721c24',
          border: '#f5c6cb',
        };
      case ErrorSeverity.LOW:
        return {
          background: '#d1ecf1',
          color: '#0c5460',
          border: '#bee5eb',
        };
      default:
        return {
          background: '#f8d7da',
          color: '#721c24',
          border: '#f5c6cb',
        };
    }
  };

  const styles = getSeverityStyles();

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        padding: compact ? '8px 12px' : '12px 16px',
        marginBottom: '16px',
        borderRadius: '4px',
        backgroundColor: styles.background,
        color: styles.color,
        border: `1px solid ${styles.border}`,
        fontSize: '14px',
      }}
    >
      {/* Title and message */}
      {!compact && <div style={{ fontWeight: 600, marginBottom: '4px' }}>{error.title}</div>}
      <div style={{ marginBottom: error.suggestion ? '8px' : '0' }}>{error.message}</div>

      {/* Suggestion */}
      {error.suggestion && (
        <div
          style={{
            marginTop: '8px',
            paddingTop: '8px',
            borderTop: `1px solid ${styles.border}`,
            fontSize: '13px',
            opacity: 0.9,
          }}
        >
          💡 {error.suggestion}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        {error.isRetryable && onRetry && (
          <button
            onClick={onRetry}
            style={{
              padding: '4px 12px',
              borderRadius: '3px',
              border: `1px solid ${styles.color}`,
              background: 'transparent',
              color: styles.color,
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            Retry
          </button>
        )}

        {error.isDismissible && onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              padding: '4px 12px',
              borderRadius: '3px',
              border: 'none',
              background: 'transparent',
              color: styles.color,
              cursor: 'pointer',
              fontSize: '13px',
              opacity: 0.7,
            }}
          >
            Dismiss
          </button>
        )}

        {error.showDetails && (
          <button
            onClick={() => setShowDetails(!showDetails)}
            style={{
              padding: '4px 12px',
              borderRadius: '3px',
              border: 'none',
              background: 'transparent',
              color: styles.color,
              cursor: 'pointer',
              fontSize: '13px',
              opacity: 0.7,
              marginLeft: 'auto',
            }}
          >
            {showDetails ? 'Hide Details' : 'Show Details'}
          </button>
        )}
      </div>

      {/* Technical details (collapsible) */}
      {showDetails && error.showDetails && (
        <div
          style={{
            marginTop: '12px',
            padding: '8px',
            borderRadius: '3px',
            background: 'rgba(0, 0, 0, 0.05)',
            fontSize: '12px',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>Technical Details:</div>
          {error.technicalMessage}
          {error.errorCode && <div style={{ marginTop: '8px', opacity: 0.7 }}>Error Code: {error.errorCode}</div>}
        </div>
      )}
    </div>
  );
};
