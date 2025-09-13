import React from 'react';
import { FileExplorer } from './FileExplorer';
import { useAppContext } from '../context/AppContext';
import { FluentCard } from '../fluent';

export const Sidebar: React.FC = () => {
  const { state, setCurrentView } = useAppContext();

  const handleFileSelect = async (filePath: string) => {
    // Show the preview WebContentsView when selecting files
    if (state.websiteName && window.electronAPI?.invoke) {
      try {
        const success = await window.electronAPI.invoke('set-preview-mode', state.websiteName);
        console.log('🔄 Sidebar: Set preview mode result:', success);
      } catch (error) {
        console.error('🔄 Sidebar: Failed to set preview mode:', error);
      }
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
        <FileExplorer onFileSelect={handleFileSelect} onWebsiteConfigSelect={handleWebsiteConfigSelect} />
      </FluentCard>
    </aside>
  );
};
