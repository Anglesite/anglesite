import React, { Suspense, lazy, Component } from 'react';
import { useAppContext } from '../context/AppContext';
import { FluentButton } from '../fluent/FluentButton';

// Error Boundary for lazy-loaded components
class LazyComponentErrorBoundary extends Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Lazy component loading error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

export const Main: React.FC = () => {
  const { state } = useAppContext();

  // Debug state changes
  React.useEffect(() => {
    console.log('Main component state changed:', {
      currentView: state.currentView,
      selectedFile: state.selectedFile,
      websiteName: state.websiteName,
      loading: state.loading,
    });
  }, [state]);

  const renderContent = () => {
    console.log('Main renderContent called with currentView:', state.currentView, 'selectedFile:', state.selectedFile);

    switch (state.currentView) {
      case 'website-config':
        // Create lazy import only when needed to ensure async chunk creation
        const WebsiteConfigEditor = lazy(
          () => import(/* webpackChunkName: "website-config-editor" */ './WebsiteConfigEditor')
        );

        return (
          <LazyComponentErrorBoundary
            fallback={
              <div style={{ padding: '20px' }}>
                <h3>Website Configuration</h3>
                <div style={{ color: 'var(--error-color)', marginBottom: '12px' }}>
                  Failed to load configuration editor. Please refresh the page to try again.
                </div>
                <FluentButton onClick={() => window.location.reload()} appearance="accent">
                  Refresh Page
                </FluentButton>
              </div>
            }
          >
            <Suspense
              fallback={
                <div style={{ padding: '20px' }}>
                  <h3>Website Configuration</h3>
                  <p style={{ color: 'var(--text-secondary)' }}>Loading configuration editor...</p>
                </div>
              }
            >
              <WebsiteConfigEditor />
            </Suspense>
          </LazyComponentErrorBoundary>
        );
      case 'file-editor':
        if (state.selectedFile) {
          return (
            <div style={{ padding: '20px' }}>
              <h3>File Editor</h3>
              <p>Editing: {state.selectedFile}</p>
              <div
                style={{
                  background: 'var(--bg-secondary)',
                  padding: '16px',
                  borderRadius: '8px',
                  marginTop: '16px',
                  border: '1px solid var(--border-primary)',
                }}
              >
                <h4 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>Selected File Path Debug:</h4>
                <code
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    wordBreak: 'break-all',
                  }}
                >
                  {state.selectedFile}
                </code>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: '16px' }}>
                File content loading will be implemented in the next phase.
              </p>
            </div>
          );
        }
        return (
          <div className="editor-content">
            <p>Select a file to edit or configure website settings</p>
          </div>
        );
      default:
        return (
          <div className="editor-content">
            <p>Select a file to edit or configure website settings</p>
          </div>
        );
    }
  };

  return (
    <main className="main-content">
      <div className="editor-area">
        <div className="editor-tabs">
          {state.currentView === 'website-config' && (
            <div
              style={{
                padding: '8px 16px',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                background: 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border-primary)',
              }}
            >
              🌐 Website Configuration
            </div>
          )}
          {state.currentView === 'file-editor' && state.selectedFile && (
            <div
              style={{
                padding: '8px 16px',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                background: 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border-primary)',
              }}
            >
              📄 {state.selectedFile.split('/').pop()}
            </div>
          )}
        </div>
        {renderContent()}
      </div>
    </main>
  );
};
