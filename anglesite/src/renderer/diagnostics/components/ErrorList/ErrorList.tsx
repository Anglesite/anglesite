/**
 * @file Error List component
 * @description Displays a list of errors with selection and expansion capabilities
 */
import React, { useState, useCallback } from 'react';
import { FluentCard } from '../../../ui/react/fluent/FluentCard';
import { FluentDivider } from '../../../ui/react/fluent/FluentDivider';
import ErrorListItem from './ErrorListItem';
import LoadingSpinner from '../Layout/LoadingSpinner';
import type { ComponentError } from '../../types/diagnostics';

export interface ErrorListProps {
  /** Array of errors to display */
  errors: ComponentError[];
  /** Whether the error list is currently loading */
  loading?: boolean;
  /** Error message if loading failed */
  error?: string | null;
  /** Callback when an error is selected */
  onErrorSelect?: (errorId: string) => void;
  /** Callback when multiple errors are selected */
  onErrorsSelect?: (errorIds: string[]) => void;
  /** Array of currently selected error IDs */
  selectedErrors?: string[];
  /** Whether to show in compact mode */
  compact?: boolean;
  /** Additional CSS class name */
  className?: string;
}

const ErrorList: React.FC<ErrorListProps> = ({
  errors,
  loading = false,
  error = null,
  onErrorSelect,
  onErrorsSelect,
  selectedErrors = [],
  compact = false,
  className = '',
}) => {
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());

  const handleToggleExpand = useCallback((errorId: string) => {
    setExpandedErrors((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(errorId)) {
        newSet.delete(errorId);
      } else {
        newSet.add(errorId);
      }
      return newSet;
    });
  }, []);

  const handleSelectError = useCallback(
    (errorId: string) => {
      if (onErrorSelect) {
        onErrorSelect(errorId);
      }
    },
    [onErrorSelect]
  );

  const handleSelectAll = useCallback(() => {
    if (onErrorsSelect) {
      const allErrorIds = errors.map((error) => error.id);
      if (selectedErrors.length === errors.length) {
        // All selected, deselect all
        onErrorsSelect([]);
      } else {
        // Select all
        onErrorsSelect(allErrorIds);
      }
    }
  }, [onErrorsSelect, errors, selectedErrors]);

  const containerStyle: React.CSSProperties = {
    ...(compact
      ? {}
      : {
          margin: '16px',
          padding: 0,
        }),
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  const headerStyle: React.CSSProperties = {
    padding: '16px 20px 12px',
    backgroundColor: 'var(--colorNeutralBackground2)',
    borderBottom: '1px solid var(--colorNeutralStroke2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  };

  const titleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: compact ? '14px' : '16px',
    fontWeight: 600,
    color: 'var(--colorNeutralForeground1)',
  };

  const countStyle: React.CSSProperties = {
    fontSize: '12px',
    color: 'var(--colorNeutralForeground2)',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  };

  const listStyle: React.CSSProperties = {
    flex: 1,
    overflow: 'auto',
    padding: '0',
  };

  const emptyStateStyle: React.CSSProperties = {
    padding: '48px 24px',
    textAlign: 'center',
    color: 'var(--colorNeutralForeground2)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
  };

  const getSeverityColor = (severity: string): string => {
    switch (severity.toLowerCase()) {
      case 'critical':
        return 'var(--colorPaletteRedForeground1)';
      case 'high':
      case 'error':
        return 'var(--colorPaletteRedForeground2)';
      case 'medium':
      case 'warning':
        return 'var(--colorPaletteYellowForeground1)';
      case 'low':
      case 'info':
        return 'var(--colorPaletteBlueForeground1)';
      default:
        return 'var(--colorNeutralForeground2)';
    }
  };

  const getSeverityCount = (severity: string): number => {
    return errors.filter((error) => error.severity.toString().toLowerCase() === severity.toLowerCase()).length;
  };

  if (loading) {
    return (
      <div style={containerStyle} data-testid="error-list-loading" className={className}>
        {!compact && (
          <div style={headerStyle}>
            <h3 style={titleStyle}>Error List</h3>
          </div>
        )}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <LoadingSpinner
            size={compact ? 'medium' : 'large'}
            message="Loading errors..."
            testId="error-list-loading-spinner"
          />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle} data-testid="error-list-error" className={className}>
        {!compact && (
          <div style={headerStyle}>
            <h3 style={titleStyle}>Error List</h3>
          </div>
        )}
        <div style={emptyStateStyle}>
          <div style={{ fontSize: '48px', marginBottom: '8px' }} role="img" aria-label="Error">
            ⚠️
          </div>
          <h4 style={{ margin: '0 0 8px 0', color: 'var(--colorPaletteRedForeground1)' }}>Failed to Load Errors</h4>
          <p style={{ margin: 0, fontSize: '14px' }}>{error}</p>
        </div>
      </div>
    );
  }

  const content = (
    <div data-testid="error-list" className={className} style={containerStyle}>
      {/* Header */}
      {!compact && (
        <div style={headerStyle}>
          <h3 style={titleStyle}>Error List</h3>
          <div style={countStyle}>
            <span>
              {errors.length} {errors.length === 1 ? 'error' : 'errors'}
            </span>
            {errors.length > 0 && (
              <>
                <FluentDivider style={{ height: '12px', margin: '0' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <div
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: getSeverityColor('critical'),
                      }}
                    />
                    {getSeverityCount('critical')}
                  </span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <div
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: getSeverityColor('error'),
                      }}
                    />
                    {getSeverityCount('error')}
                  </span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <div
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: getSeverityColor('warning'),
                      }}
                    />
                    {getSeverityCount('warning')}
                  </span>
                </div>
              </>
            )}
            {onErrorsSelect && errors.length > 1 && (
              <>
                <FluentDivider style={{ height: '12px', margin: '0' }} />
                <button
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--colorBrandForeground1)',
                    fontSize: '12px',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                  onClick={handleSelectAll}
                  data-testid="select-all-button"
                >
                  {selectedErrors.length === errors.length ? 'Deselect All' : 'Select All'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Error List Content */}
      <div style={listStyle}>
        {errors.length === 0 ? (
          <div style={emptyStateStyle}>
            <div style={{ fontSize: '48px', marginBottom: '8px' }} role="img" aria-label="No errors">
              ✅
            </div>
            <h4 style={{ margin: '0 0 8px 0', color: 'var(--colorPaletteGreenForeground1)' }}>No Errors Found</h4>
            <p style={{ margin: 0, fontSize: '14px' }}>Great! No errors have been recorded recently.</p>
          </div>
        ) : (
          <div data-testid="error-list-items">
            {errors.map((error, index) => (
              <React.Fragment key={error.id}>
                <ErrorListItem
                  error={error}
                  isSelected={selectedErrors.includes(error.id)}
                  isExpanded={expandedErrors.has(error.id)}
                  onSelect={handleSelectError}
                  onToggleExpand={handleToggleExpand}
                  compact={compact}
                />
                {index < errors.length - 1 && <FluentDivider style={{ margin: '0' }} />}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (compact) {
    return content;
  }

  return (
    <FluentCard appearance="outline" style={containerStyle} className={className}>
      {content}
    </FluentCard>
  );
};

export default ErrorList;
