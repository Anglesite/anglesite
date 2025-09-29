/**
 * @file Error List Item component
 * @description Individual error item with expandable details and selection
 */
import React from 'react';
import { FluentButton } from '../../../ui/react/fluent/FluentButton';
import type { ComponentError } from '../../types/diagnostics';

export interface ErrorListItemProps {
  /** Error data to display */
  error: ComponentError;
  /** Whether this error is selected */
  isSelected?: boolean;
  /** Whether this error is expanded to show details */
  isExpanded?: boolean;
  /** Callback when error is selected */
  onSelect?: (errorId: string) => void;
  /** Callback when expand/collapse is toggled */
  onToggleExpand?: (errorId: string) => void;
  /** Whether to show in compact mode */
  compact?: boolean;
  /** Additional CSS class name */
  className?: string;
}

const ErrorListItem: React.FC<ErrorListItemProps> = ({
  error,
  isSelected = false,
  isExpanded = false,
  onSelect,
  onToggleExpand,
  compact = false,
  className = '',
}) => {
  const handleSelect = () => {
    if (onSelect) {
      onSelect(error.id);
    }
  };

  const handleToggleExpand = () => {
    if (onToggleExpand) {
      onToggleExpand(error.id);
    }
  };

  const handleCopyError = async () => {
    try {
      const errorText = `Error: ${error.message}\nCode: ${error.code}\nSeverity: ${error.severity}\nCategory: ${error.category}\nTimestamp: ${error.timestamp.toISOString()}\n${error.metadata.stack ? `\nStack:\n${error.metadata.stack}` : ''}`;

      if (window.electronAPI?.clipboard?.writeText) {
        window.electronAPI.clipboard.writeText(errorText);
      } else {
        // Fallback for web clipboard API
        await navigator.clipboard.writeText(errorText);
      }
    } catch (err) {
      console.error('Failed to copy error to clipboard:', err);
    }
  };

  const containerStyle: React.CSSProperties = {
    padding: compact ? '12px 16px' : '16px 20px',
    cursor: 'pointer',
    backgroundColor: isSelected ? 'var(--colorNeutralBackground1Selected)' : 'transparent',
    borderLeft: isSelected ? '3px solid var(--colorBrandBackground)' : '3px solid transparent',
    transition: 'all 0.2s ease',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    marginBottom: isExpanded ? '12px' : '0',
  };

  const severityIndicatorStyle: React.CSSProperties = {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    marginTop: '6px',
    flexShrink: 0,
    backgroundColor: getSeverityColor(error.severity.toString()),
  };

  const mainContentStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
  };

  const messageStyle: React.CSSProperties = {
    margin: '0 0 4px 0',
    fontSize: compact ? '13px' : '14px',
    fontWeight: 500,
    color: 'var(--colorNeutralForeground1)',
    wordBreak: 'break-word',
    lineHeight: '1.4',
  };

  const metaStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '11px',
    color: 'var(--colorNeutralForeground3)',
    flexWrap: 'wrap',
  };

  const actionsStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    flexShrink: 0,
  };

  const detailsStyle: React.CSSProperties = {
    marginTop: '12px',
    padding: '12px',
    backgroundColor: 'var(--colorNeutralBackground2)',
    borderRadius: '4px',
    border: '1px solid var(--colorNeutralStroke2)',
    fontSize: '12px',
  };

  const codeBlockStyle: React.CSSProperties = {
    fontFamily: 'var(--fontFamilyMonospace, Consolas, "Courier New", monospace)',
    fontSize: '11px',
    backgroundColor: 'var(--colorNeutralBackground3)',
    border: '1px solid var(--colorNeutralStroke3)',
    borderRadius: '3px',
    padding: '8px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    maxHeight: '200px',
    overflow: 'auto',
    margin: '8px 0 0 0',
  };

  function getSeverityColor(severity: string): string {
    switch (severity.toLowerCase()) {
      case 'critical':
        return 'var(--colorPaletteRedBackground3)';
      case 'high':
      case 'error':
        return 'var(--colorPaletteRedBackground2)';
      case 'medium':
      case 'warning':
        return 'var(--colorPaletteYellowBackground2)';
      case 'low':
      case 'info':
        return 'var(--colorPaletteBluBackground2)';
      default:
        return 'var(--colorNeutralBackground4)';
    }
  }

  function getSeverityLabel(severity: string): string {
    switch (severity.toString()) {
      case 'CRITICAL':
        return 'Critical';
      case 'HIGH':
        return 'High';
      case 'MEDIUM':
        return 'Medium';
      case 'LOW':
        return 'Low';
      default:
        return severity.toString();
    }
  }

  function getCategoryLabel(category: string): string {
    return category
      .toString()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  function formatTimestamp(timestamp: Date): string {
    return timestamp.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  return (
    <div
      className={className}
      style={containerStyle}
      onClick={handleSelect}
      data-testid={`error-item-${error.id}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleSelect();
        }
      }}
    >
      <div style={headerStyle}>
        <div style={severityIndicatorStyle} />

        <div style={mainContentStyle}>
          <h4 style={messageStyle}>{error.message}</h4>

          <div style={metaStyle}>
            <span data-testid="error-severity">{getSeverityLabel(error.severity.toString())}</span>
            <span>•</span>
            <span data-testid="error-category">{getCategoryLabel(error.category.toString())}</span>
            <span>•</span>
            <span data-testid="error-code">{error.code}</span>
            <span>•</span>
            <span data-testid="error-timestamp">{formatTimestamp(error.timestamp)}</span>
            {error.metadata.operation && (
              <>
                <span>•</span>
                <span data-testid="error-operation">{error.metadata.operation}</span>
              </>
            )}
          </div>
        </div>

        <div style={actionsStyle}>
          <FluentButton
            appearance="neutral"
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              handleCopyError();
            }}
            title="Copy error details to clipboard"
            data-testid="copy-error-button"
          >
            📋
          </FluentButton>

          <FluentButton
            appearance="neutral"
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              handleToggleExpand();
            }}
            title={isExpanded ? 'Hide details' : 'Show details'}
            data-testid="toggle-expand-button"
          >
            {isExpanded ? '▼' : '▶'}
          </FluentButton>
        </div>
      </div>

      {isExpanded && (
        <div style={detailsStyle} data-testid="error-details">
          <div style={{ display: 'grid', gap: '8px' }}>
            <div>
              <strong>Error ID:</strong>
              <div style={codeBlockStyle}>{error.id}</div>
            </div>

            <div>
              <strong>Full Message:</strong>
              <div style={codeBlockStyle}>{error.message}</div>
            </div>

            {error.metadata.context && Object.keys(error.metadata.context).length > 0 && (
              <div>
                <strong>Context:</strong>
                <div style={codeBlockStyle}>{JSON.stringify(error.metadata.context, null, 2)}</div>
              </div>
            )}

            {error.metadata.stack && (
              <div>
                <strong>Stack Trace:</strong>
                <div style={codeBlockStyle}>{error.metadata.stack}</div>
              </div>
            )}

            <div
              style={{
                marginTop: '8px',
                padding: '8px',
                backgroundColor: 'var(--colorNeutralBackground1)',
                borderRadius: '3px',
                fontSize: '11px',
                color: 'var(--colorNeutralForeground2)',
              }}
            >
              <div>
                <strong>Occurred:</strong> {error.timestamp.toISOString()}
              </div>
              <div>
                <strong>Category:</strong> {getCategoryLabel(error.category.toString())}
              </div>
              <div>
                <strong>Severity:</strong> {getSeverityLabel(error.severity.toString())}
              </div>
              <div>
                <strong>Code:</strong> {error.code}
              </div>
              {error.metadata.operation && (
                <div>
                  <strong>Operation:</strong> {error.metadata.operation}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ErrorListItem;
