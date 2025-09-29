import React, { Component, ErrorInfo, ReactNode } from 'react';
import { ComponentErrorCollector } from './component-error-collector';

interface Props {
  children: ReactNode;
  componentName: string;
  componentProps?: Record<string, unknown>;
  captureProps?: boolean;
  anonymize?: boolean;
  onError?: (error: Error, errorInfo: ErrorInfo & { componentHierarchy?: string[] }) => void;
  fallback?: React.ComponentType<{ error: Error; errorInfo: ErrorInfo; componentName: string }>;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

const DefaultErrorFallback: React.FC<{
  error: Error;
  errorInfo: ErrorInfo;
  componentName: string;
}> = ({ error, componentName }) => (
  <div
    style={{
      padding: '20px',
      margin: '20px',
      border: '2px solid #ff0000',
      borderRadius: '8px',
      backgroundColor: '#fff5f5',
    }}
  >
    <h2 style={{ color: '#ff0000', marginTop: 0 }}>Something went wrong</h2>
    <p style={{ color: '#666' }}>
      An error occurred in component: <strong>{componentName}</strong>
    </p>
    <details style={{ marginTop: '10px' }}>
      <summary style={{ cursor: 'pointer', color: '#333' }}>Error details</summary>
      <pre
        style={{
          marginTop: '10px',
          padding: '10px',
          backgroundColor: '#f5f5f5',
          borderRadius: '4px',
          fontSize: '12px',
          overflow: 'auto',
        }}
      >
        {error.toString()}
      </pre>
    </details>
  </div>
);

export class TelemetryErrorBoundary extends Component<Props, State> {
  private static hierarchyStack: string[] = [];
  private collector: ComponentErrorCollector;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
    this.collector = ComponentErrorCollector.getInstance();
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { componentName, componentProps, captureProps, anonymize, onError } = this.props;

    // Build component hierarchy
    const componentHierarchy = [...TelemetryErrorBoundary.hierarchyStack, componentName];

    // Prepare context
    const context = {
      componentName,
      componentHierarchy,
      props: captureProps && componentProps ? componentProps : undefined,
      state: this.state,
    };

    // Configure anonymization
    if (anonymize !== undefined) {
      this.collector.configure({ anonymize });
    }

    // Capture error
    const captured = this.collector.captureError(error, context);

    if (captured) {
      console.log(`[Telemetry] Error captured in ${componentName}`);
    }

    // Call custom error handler
    if (onError) {
      onError(error, {
        ...errorInfo,
        componentHierarchy,
      });
    }

    // Update state with error info
    this.setState({ errorInfo });
  }

  componentDidMount(): void {
    // Add to hierarchy stack
    TelemetryErrorBoundary.hierarchyStack.push(this.props.componentName);
  }

  componentWillUnmount(): void {
    // Remove from hierarchy stack
    const index = TelemetryErrorBoundary.hierarchyStack.lastIndexOf(this.props.componentName);
    if (index >= 0) {
      TelemetryErrorBoundary.hierarchyStack.splice(index, 1);
    }
  }

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      const FallbackComponent = this.props.fallback || DefaultErrorFallback;

      return (
        <FallbackComponent
          error={this.state.error}
          errorInfo={this.state.errorInfo || { componentStack: '' }}
          componentName={this.props.componentName}
        />
      );
    }

    return this.props.children;
  }
}

// Higher-order component for easier integration
export function withTelemetryErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  componentName: string,
  options?: {
    captureProps?: boolean;
    anonymize?: boolean;
    fallback?: React.ComponentType<{ error: Error; errorInfo: ErrorInfo; componentName: string }>;
  }
): React.ComponentType<P> {
  return (props: P) => (
    <TelemetryErrorBoundary
      componentName={componentName}
      componentProps={props as Record<string, unknown>}
      captureProps={options?.captureProps}
      anonymize={options?.anonymize}
      fallback={options?.fallback}
    >
      <Component {...props} />
    </TelemetryErrorBoundary>
  );
}

// Hook for capturing errors in functional components
export function useTelemetryError(componentName: string): (error: Error) => void {
  const collector = ComponentErrorCollector.getInstance();

  return React.useCallback(
    (error: Error) => {
      collector.captureError(error, { componentName });
    },
    [componentName, collector]
  );
}

// Context provider for website-level telemetry context
interface TelemetryContextValue {
  websiteId?: string;
  setWebsiteId: (id: string) => void;
}

const TelemetryContext = React.createContext<TelemetryContextValue | undefined>(undefined);

export const TelemetryProvider: React.FC<{
  children: ReactNode;
  websiteId?: string;
}> = ({ children, websiteId: initialWebsiteId }) => {
  const [websiteId, setWebsiteId] = React.useState(initialWebsiteId);
  const collector = ComponentErrorCollector.getInstance();

  React.useEffect(() => {
    if (websiteId) {
      collector.setWebsiteContext(websiteId);
    }
  }, [websiteId, collector]);

  return <TelemetryContext.Provider value={{ websiteId, setWebsiteId }}>{children}</TelemetryContext.Provider>;
};

export function useTelemetryContext(): TelemetryContextValue {
  const context = React.useContext(TelemetryContext);
  if (!context) {
    throw new Error('useTelemetryContext must be used within TelemetryProvider');
  }
  return context;
}

// User action tracking hook
export function useTelemetryAction(): (action: string, target: string) => void {
  const collector = ComponentErrorCollector.getInstance();

  return React.useCallback(
    (action: string, target: string) => {
      collector.setUserAction(action, target);
    },
    [collector]
  );
}
