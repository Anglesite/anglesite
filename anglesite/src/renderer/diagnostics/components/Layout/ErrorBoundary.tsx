/**
 * @file Error Boundary component for Diagnostics UI
 * @description Catches and handles React component errors gracefully
 */
import React from 'react';
import { FluentButton } from '../../../ui/react/fluent/FluentButton';
import { FluentCard } from '../../../ui/react/fluent/FluentCard';
import type { ErrorBoundaryState, ErrorBoundaryProps } from '../../types/diagnostics';

interface ErrorFallbackProps {
  error: Error;
  retry: () => void;
}

const DefaultErrorFallback: React.FC<ErrorFallbackProps> = ({ error, retry }) => (
  <FluentCard
    appearance="outline"
    style={{
      margin: '24px',
      padding: '24px',
      textAlign: 'center',
      maxWidth: '600px',
      marginLeft: 'auto',
      marginRight: 'auto',
    }}
  >
    <div style={{ marginBottom: '16px' }}>
      <h2 style={{ color: 'var(--colorPaletteRedForeground1)', marginBottom: '8px' }}>Something went wrong</h2>
      <p style={{ color: 'var(--colorNeutralForeground2)', marginBottom: '16px' }}>
        The diagnostics interface encountered an unexpected error.
      </p>
    </div>

    <details style={{ marginBottom: '20px', textAlign: 'left' }}>
      <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>Error Details</summary>
      <pre
        style={{
          backgroundColor: 'var(--colorNeutralBackground2)',
          padding: '12px',
          borderRadius: '4px',
          fontSize: '12px',
          overflow: 'auto',
          maxHeight: '200px',
        }}
      >
        {error.stack || error.message}
      </pre>
    </details>

    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
      <FluentButton appearance="accent" onClick={retry} data-testid="error-retry-button">
        Try Again
      </FluentButton>
      <FluentButton appearance="neutral" onClick={() => window.location.reload()} data-testid="error-reload-button">
        Reload Window
      </FluentButton>
    </div>
  </FluentCard>
);

export class DiagnosticsErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack: string }) {
    this.setState({
      errorInfo,
    });

    // Log error to main process for diagnostics
    if (window.electronAPI?.send) {
      window.electronAPI.send('renderer-error', {
        component: 'DiagnosticsErrorBoundary',
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
        errorInfo,
      });
    }

    // Call optional error handler
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    console.error('DiagnosticsErrorBoundary caught an error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      const FallbackComponent = this.props.fallback || DefaultErrorFallback;

      return (
        <div data-testid="error-boundary-fallback">
          <FallbackComponent error={this.state.error} retry={this.handleRetry} />
        </div>
      );
    }

    return this.props.children;
  }
}

// Functional wrapper for easier usage
export const withErrorBoundary = <P extends object>(
  Component: React.ComponentType<P>,
  fallback?: React.ComponentType<ErrorFallbackProps>
) => {
  const WrappedComponent = React.forwardRef<any, P>((props, ref) => (
    <DiagnosticsErrorBoundary fallback={fallback}>
      <Component {...(props as P)} ref={ref} />
    </DiagnosticsErrorBoundary>
  ));

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;

  return WrappedComponent;
};

export default DiagnosticsErrorBoundary;
