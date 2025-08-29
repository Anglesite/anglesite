import React from 'react';
import { FileExplorer } from './FileExplorer';
import { useAppContext } from '../context/AppContext';

export const Sidebar: React.FC = () => {
  const { setCurrentView } = useAppContext();

  const handleFileSelect = (filePath: string) => {
    setCurrentView('file-editor');
    // File content loading will be handled by the FileExplorer
  };

  const handleWebsiteConfigSelect = () => {
    setCurrentView('website-config');
  };

  return (
    <aside className="sidebar">
      <FileExplorer onFileSelect={handleFileSelect} onWebsiteConfigSelect={handleWebsiteConfigSelect} />
    </aside>
  );
};
