/**
 * @file Loading Spinner component for Diagnostics UI
 * @description Reusable loading indicator with Fluent design styling
 */
import React from 'react';

export interface LoadingSpinnerProps {
  /** Size of the spinner */
  size?: 'small' | 'medium' | 'large';
  /** Loading message to display */
  message?: string;
  /** Whether to show the spinner inline or centered */
  inline?: boolean;
  /** Additional CSS class */
  className?: string;
  /** Test ID for testing */
  testId?: string;
}

const sizeMap = {
  small: '16px',
  medium: '24px',
  large: '32px',
};

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'medium',
  message = 'Loading...',
  inline = false,
  className = '',
  testId = 'loading-spinner',
}) => {
  const spinnerSize = sizeMap[size];

  const spinnerStyles: React.CSSProperties = {
    width: spinnerSize,
    height: spinnerSize,
    border: '2px solid var(--colorNeutralStroke2, #e1e1e1)',
    borderTop: '2px solid var(--colorBrandBackground, #0078d4)',
    borderRadius: '50%',
    animation: 'diagnostics-spin 1s linear infinite',
    flexShrink: 0,
  };

  const containerStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    color: 'var(--colorNeutralForeground2)',
    fontSize: '14px',
    fontFamily: 'var(--fontFamilyBase)',
    ...(inline
      ? {}
      : {
          justifyContent: 'center',
          minHeight: '100px',
          width: '100%',
        }),
  };

  return (
    <>
      {/* CSS animation styles */}
      <style>
        {`
          @keyframes diagnostics-spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>

      <div
        data-testid={testId}
        className={`diagnostics-loading-spinner ${className}`}
        style={containerStyles}
        role="status"
        aria-live="polite"
        aria-label={message}
      >
        <div style={spinnerStyles} aria-hidden="true" />
        {message && <span data-testid={`${testId}-message`}>{message}</span>}
      </div>
    </>
  );
};

// Specialized loading components for common use cases
export const TableLoadingSpinner: React.FC<{ message?: string }> = ({ message = 'Loading errors...' }) => (
  <LoadingSpinner size="medium" message={message} testId="table-loading-spinner" />
);

export const DashboardLoadingSpinner: React.FC<{ message?: string }> = ({ message = 'Loading statistics...' }) => (
  <LoadingSpinner size="large" message={message} testId="dashboard-loading-spinner" />
);

export const InlineLoadingSpinner: React.FC<{ message?: string }> = ({ message = 'Loading...' }) => (
  <LoadingSpinner size="small" message={message} inline={true} testId="inline-loading-spinner" />
);

export default LoadingSpinner;
