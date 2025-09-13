import React, { Suspense, lazy, Component } from 'react';
import { useAppContext } from '../context/AppContext';
import { FluentButton } from '../fluent/FluentButton';
import { logger } from '../../../utils/logger';

// ViewModeToggle component
const ViewModeToggle: React.FC = () => {
  const { state } = useAppContext();
  const [viewMode, setViewMode] = React.useState<'edit' | 'preview'>('edit');

  const handleToggleMode = async () => {
    if (!state.websiteName || !window.electronAPI?.invoke) return;

    try {
      const newMode = viewMode === 'edit' ? 'preview' : 'edit';
      const channel = newMode === 'edit' ? 'set-edit-mode' : 'set-preview-mode';

      await window.electronAPI.invoke(channel, state.websiteName);
      setViewMode(newMode);
    } catch (error) {
      logger.error('Main', 'Failed to toggle view mode', error);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>View:</span>
      <button
        onClick={handleToggleMode}
        style={{
          background: viewMode === 'edit' ? 'var(--accent-fill-rest)' : 'var(--bg-primary)',
          color: viewMode === 'edit' ? 'white' : 'var(--text-primary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '4px',
          padding: '4px 8px',
          fontSize: '11px',
          cursor: 'pointer',
          minWidth: '60px',
        }}
      >
        {viewMode === 'edit' ? '✏️ Edit' : '👁️ Preview'}
      </button>
    </div>
  );
};

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
    logger.error('Main', 'LazyComponentErrorBoundary caught error', {
      message: error.message,
      stack: error.stack,
      errorInfo,
      note: 'This usually indicates an issue with WebsiteConfigEditor rendering'
    });
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

  // Track state changes in development
  React.useEffect(() => {
    logger.debug('Main', 'Component state changed', {
      currentView: state.currentView,
      selectedFile: state.selectedFile,
      websiteName: state.websiteName,
      loading: state.loading,
    });
  }, [state]);

  const renderContent = () => {
    logger.debug('Main', 'renderContent called', {
      currentView: state.currentView,
      selectedFile: state.selectedFile,
      fullState: state
    });

    switch (state.currentView) {
      case 'website-config':
        logger.debug('Main', 'Rendering website-config view', {
          websiteName: state.websiteName,
          websitePath: state.websitePath,
          loading: state.loading,
        });

        // TEMPORARY FIX: Use direct import for all environments until React.lazy issue is resolved
        // This bypasses the lazy loading issue that occurs in both Jest and Electron environments

        try {
          const { WebsiteConfigEditor: DirectWebsiteConfigEditor } = require('./WebsiteConfigEditor');
          logger.debug('Main', 'Direct import successful, rendering WebsiteConfigEditor');

          return (
            <LazyComponentErrorBoundary
              fallback={
                <div style={{ padding: '20px' }}>
                  <h3>Website Configuration</h3>
                  <div style={{ color: 'var(--error-color)', marginBottom: '12px' }}>
                    Failed to load configuration editor. Check console for details.
                  </div>
                  <FluentButton onClick={() => window.location.reload()} appearance="accent">
                    Refresh Page
                  </FluentButton>
                </div>
              }
            >
              <DirectWebsiteConfigEditor />
            </LazyComponentErrorBoundary>
          );
        } catch (importError) {
          logger.error('Main', 'Direct import failed', importError);
          return (
            <div style={{ padding: '20px' }}>
              <h3>Website Configuration</h3>
              <div style={{ color: 'var(--error-color)', marginBottom: '12px' }}>
                Failed to load WebsiteConfigEditor:{' '}
                {importError instanceof Error ? importError.message : String(importError)}
              </div>
              <FluentButton onClick={() => window.location.reload()} appearance="accent">
                Refresh Page
              </FluentButton>
            </div>
          );
        }

      // COMMENTED OUT: Unreachable lazy loading code that was causing issues
      // This code will never execute because the try/catch above always returns
      // Keeping it commented for reference until we implement a proper lazy loading solution
      /*
        console.log('🖥️  Main: Production environment, using lazy import for WebsiteConfigEditor...');
        const WebsiteConfigEditor = lazy(async () => {
          console.log('🖥️  Main: Dynamic import starting...');
          try {
            const module = await import(webpackChunkName: "website-config-editor" './WebsiteConfigEditor');
            console.log('🖥️  Main: Dynamic import successful, module:', !!module);
            console.log('🖥️  Main: Module exports:', Object.keys(module));
            return module;
          } catch (error) {
            console.error('🚨 Main: Dynamic import failed:', error);
            throw error;
          }
        });

        return (
          <LazyComponentErrorBoundary
            fallback={
              <div style={{ padding: '20px' }}>
                <h3>Website Configuration</h3>
                <div style={{ color: 'var(--error-color)', marginBottom: '12px' }}>
                  Failed to load configuration editor. Check console for details.
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
                  <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Debug: currentView={state.currentView}, websiteName={state.websiteName || 'undefined'}
                  </div>
                </div>
              }
            >
              <WebsiteConfigEditor />
            </Suspense>
          </LazyComponentErrorBoundary>
        );
        */
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
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>🌐 Website Configuration</span>
              <ViewModeToggle />
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
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>📄 {state.selectedFile.split('/').pop()}</span>
              <ViewModeToggle />
            </div>
          )}
        </div>
        {renderContent()}
      </div>
    </main>
  );
};
