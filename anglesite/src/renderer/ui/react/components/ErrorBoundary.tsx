/**
 * @file Comprehensive error boundary component
 * @description Provides error handling and recovery for React components
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '../../../utils/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  componentName?: string;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorCount: number;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { componentName = 'Unknown', onError } = this.props;

    logger.error(`ErrorBoundary[${componentName}]`, 'Component crashed', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });

    this.setState((prevState) => ({
      errorInfo,
      errorCount: prevState.errorCount + 1,
    }));

    // Call custom error handler if provided
    if (onError) {
      onError(error, errorInfo);
    }

    // Send error to main process for telemetry (if implemented)
    if (window.electronAPI?.send) {
      window.electronAPI.send('renderer-error', {
        component: componentName,
        error: {
          message: error.message,
          stack: error.stack,
        },
        errorInfo: {
          componentStack: errorInfo.componentStack,
        },
      });
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    const { hasError, error, errorCount } = this.state;
    const { fallback, children, componentName = 'Component' } = this.props;

    if (hasError && error) {
      // Custom fallback if provided
      if (fallback) {
        return <>{fallback}</>;
      }

      // Default error UI
      return (
        <div
          style={{
            padding: '20px',
            margin: '20px',
            borderRadius: '8px',
            background: 'var(--error-bg, #fee)',
            border: '1px solid var(--error-border, #fcc)',
            color: 'var(--error-text, #c00)',
          }}
        >
          <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: 600 }}>
            Something went wrong
          </h3>

          <p style={{ margin: '0 0 10px 0', fontSize: '14px' }}>
            {componentName} encountered an error and couldn't recover.
          </p>

          {/* Show error details in development */}
          {process.env.NODE_ENV !== 'production' && (
            <details style={{ marginTop: '10px' }}>
              <summary style={{ cursor: 'pointer', fontSize: '12px' }}>
                Error details (development only)
              </summary>
              <pre
                style={{
                  marginTop: '10px',
                  padding: '10px',
                  background: 'var(--bg-secondary, #f5f5f5)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  overflow: 'auto',
                  maxHeight: '200px',
                }}
              >
                {error.toString()}
                {error.stack && '\n\nStack trace:\n' + error.stack}
              </pre>
            </details>
          )}

          <div style={{ marginTop: '15px', display: 'flex', gap: '10px' }}>
            <button
              onClick={this.handleReset}
              style={{
                padding: '6px 12px',
                background: 'var(--button-bg, #007bff)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Try Again
            </button>

            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '6px 12px',
                background: 'transparent',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '4px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Reload Page
            </button>
          </div>

          {errorCount > 2 && (
            <p style={{ marginTop: '10px', fontSize: '12px', fontStyle: 'italic' }}>
              This component has crashed {errorCount} times. Consider reloading the application.
            </p>
          )}
        </div>
      );
    }

    return children;
  }
}

/**
 * HOC to wrap components with error boundary
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  componentName?: string
): React.ComponentType<P> {
  return (props: P) => (
    <ErrorBoundary componentName={componentName || Component.displayName || Component.name}>
      <Component {...props} />
    </ErrorBoundary>
  );
}