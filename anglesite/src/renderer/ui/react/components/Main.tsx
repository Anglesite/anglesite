import React, { Suspense, lazy } from 'react';
import { useAppContext } from '../context/AppContext';
import { logger } from '../../../utils/logger';
import { ErrorBoundary } from './ErrorBoundary';
import { COMPONENT_NAMES } from '../../../../shared/constants';

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

// Lazy load the WebsiteConfigEditor component
// This component is only loaded when the website-config view is active
const WebsiteConfigEditor = lazy(() =>
  import(/* webpackChunkName: "website-config-editor" */ './WebsiteConfigEditor')
    .then((module) => {
      logger.debug('Main', 'WebsiteConfigEditor module loaded successfully');
      return module;
    })
    .catch((error) => {
      logger.error('Main', 'Failed to load WebsiteConfigEditor module', error);
      // Return a fallback component that shows the error
      return {
        default: () => (
          <div style={{ padding: '20px' }}>
            <h3>Website Configuration</h3>
            <div style={{ color: 'var(--error-color)' }}>
              Failed to load configuration editor module. Please check the console for technical details.
            </div>
          </div>
        ),
      };
    })
);

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
    logger.debug('Main', 'renderContent called with state', {
      currentView: state.currentView,
      selectedFile: state.selectedFile,
      websiteName: state.websiteName,
      loading: state.loading,
      fullState: state,
    });

    switch (state.currentView) {
      case 'website-config':
        logger.debug('Main', 'Rendering website-config view', {
          websiteName: state.websiteName,
          websitePath: state.websitePath,
          loading: state.loading,
        });

        return (
          <ErrorBoundary
            componentName={`${COMPONENT_NAMES.WEBSITE_CONFIG_EDITOR}-Wrapper`}
            onError={(error, errorInfo) => {
              logger.error('Main', 'WebsiteConfigEditor crashed in onError callback', {
                error: error.message,
                componentStack: errorInfo.componentStack,
                errorStack: error.stack,
                fullError: error,
                fullErrorInfo: errorInfo,
              });
            }}
            fallback={
              <div style={{ padding: '20px' }}>
                <h3>Website Configuration</h3>
                <div style={{ color: 'var(--error-color)' }}>
                  Failed to load configuration editor. Check console for details.
                </div>
              </div>
            }
          >
            <Suspense
              fallback={
                <div style={{ padding: '20px' }}>
                  <h3>Website Configuration</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
                    <div
                      style={{
                        width: '20px',
                        height: '20px',
                        border: '2px solid var(--accent-fill-rest)',
                        borderTopColor: 'transparent',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                      }}
                    />
                    <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                      Loading configuration editor...
                      {(() => {
                        logger.debug('Main', 'WebsiteConfigEditor Suspense fallback is rendering');
                        return null;
                      })()}
                    </p>
                  </div>
                  <style>{`
                    @keyframes spin {
                      to { transform: rotate(360deg); }
                    }
                  `}</style>
                </div>
              }
            >
              <WebsiteConfigEditor />
            </Suspense>
          </ErrorBoundary>
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
