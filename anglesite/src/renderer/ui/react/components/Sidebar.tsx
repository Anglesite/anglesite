import React, { Suspense, lazy, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { FluentCard } from '../fluent';
import { useIPCInvoke } from '../hooks/useIPCInvoke';

// Lazy load FileExplorer since it's heavy with tree components
const FileExplorer = lazy(() => import('./FileExplorer').then((module) => ({ default: module.FileExplorer })));

export const Sidebar: React.FC = () => {
  const { state, setCurrentView } = useAppContext();
  const [shouldSetPreviewMode, setShouldSetPreviewMode] = React.useState(false);

  // Use hook for set-preview-mode IPC call with conditional execution
  const previewModeResult = useIPCInvoke<boolean>('set-preview-mode', [state.websiteName], {
    enabled: shouldSetPreviewMode && !!state.websiteName,
    retry: true, // Idempotent operation, safe to retry
  });

  // Reset trigger after execution
  useEffect(() => {
    if (shouldSetPreviewMode && !previewModeResult.loading) {
      setShouldSetPreviewMode(false);
      if (previewModeResult.data) {
        console.log('🔄 Sidebar: Set preview mode result:', previewModeResult.data);
      }
      if (previewModeResult.error) {
        console.error('🔄 Sidebar: Failed to set preview mode:', previewModeResult.error);
      }
    }
  }, [shouldSetPreviewMode, previewModeResult.loading, previewModeResult.data, previewModeResult.error]);

  const handleFileSelect = async (filePath: string) => {
    console.log('🔄 Sidebar: File selected:', filePath);

    // Trigger the preview mode IPC call
    if (state.websiteName && window.electronAPI?.invoke) {
      setShouldSetPreviewMode(true);
    }

    setCurrentView('file-editor');
    // File content loading will be handled by the FileExplorer
  };

  const handleWebsiteConfigSelect = () => {
    console.log('🔄 Sidebar: handleWebsiteConfigSelect called - setting view to website-config');
    setCurrentView('website-config');
    console.log('🔄 Sidebar: setCurrentView(website-config) call completed');
  };

  return (
    <aside
      style={{
        width: '250px',
        minWidth: '200px',
        maxWidth: '400px',
        height: '100%',
        background: 'var(--bg-secondary, #f9f9f9)',
        borderRight: '1px solid var(--border-primary, #e1e1e1)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <FluentCard
        appearance="subtle"
        style={{
          height: '100%',
          borderRadius: 0,
          border: 'none',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
        }}
      >
        <Suspense
          fallback={
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <div
                style={{
                  width: '16px',
                  height: '16px',
                  border: '2px solid var(--accent-fill-rest)',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  margin: '0 auto 8px',
                }}
              />
              Loading files...
              <style>{`
                @keyframes spin {
                  to { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          }
        >
          <FileExplorer onFileSelect={handleFileSelect} onWebsiteConfigSelect={handleWebsiteConfigSelect} />
        </Suspense>
      </FluentCard>
    </aside>
  );
};
