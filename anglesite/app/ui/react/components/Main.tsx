import React from 'react';
import { WebsiteConfigEditor } from './WebsiteConfigEditor';
import { useAppContext } from '../context/AppContext';

export const Main: React.FC = () => {
  const { state } = useAppContext();

  const renderContent = () => {
    switch (state.currentView) {
      case 'website-config':
        return <WebsiteConfigEditor />;
      case 'file-editor':
        if (state.selectedFile) {
          return (
            <div style={{ padding: '20px' }}>
              <h3>File Editor</h3>
              <p>Editing: {state.selectedFile}</p>
              <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                File editor component will be implemented in the next phase.
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
