import React, { createContext, useContext, useState, useEffect } from 'react';
import { logger } from '../../../utils/logger';

interface AppState {
  currentView: 'file-editor' | 'file-explorer' | 'website-config';
  selectedFile: string | null;
  websiteName: string;
  websitePath: string | null;
  loading: boolean;
}

interface WebsiteData {
  name: string;
  path: string;
}

export interface AppContextType {
  state: AppState;
  setCurrentView: (view: AppState['currentView']) => void;
  setSelectedFile: (file: string | null) => void;
  setWebsiteName: (name: string) => void;
  setWebsitePath: (path: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState>({
    currentView: 'file-editor',
    selectedFile: null,
    websiteName: '', // Will be loaded dynamically
    websitePath: null,
    loading: true,
  });

  const setCurrentView = (view: AppState['currentView']) => {
    logger.debug('AppContext', 'setCurrentView called', { view, previousState: state });
    setState((prev) => {
      const newState = { ...prev, currentView: view };
      logger.debug('AppContext', 'State updated', { newState });
      return newState;
    });
  };

  const setSelectedFile = (file: string | null) => {
    setState((prev) => ({ ...prev, selectedFile: file }));
  };

  const setWebsiteName = (name: string) => {
    setState((prev) => ({ ...prev, websiteName: name }));
  };

  const setWebsitePath = (path: string | null) => {
    setState((prev) => ({ ...prev, websitePath: path }));
  };

  const setLoading = (loading: boolean) => {
    setState((prev) => ({ ...prev, loading }));
  };

  // Load current website name on mount
  useEffect(() => {
    const loadCurrentWebsiteName = async () => {
      try {
        if (window.electronAPI?.invoke) {
          const websiteName = (await window.electronAPI.invoke('get-current-website-name')) as string | null;
          if (websiteName) {
            logger.info('AppContext', 'Loaded current website name', { websiteName });
            setWebsiteName(websiteName);
          }
        }
      } catch (error) {
        logger.error('AppContext', 'Error loading current website name', error);
      } finally {
        setLoading(false);
      }
    };

    loadCurrentWebsiteName();
  }, []);

  // Listen for website loading events
  useEffect(() => {
    const handleLoadWebsite = (...args: unknown[]) => {
      const websiteData = args[0] as WebsiteData;
      setWebsiteName(websiteData.name);
      setWebsitePath(websiteData.path);
      setLoading(false);
    };

    if (window.electronAPI) {
      window.electronAPI.on('load-website', handleLoadWebsite);

      // Cleanup
      return () => {
        if (window.electronAPI?.off) {
          window.electronAPI.off('load-website', handleLoadWebsite);
        }
      };
    } else {
      // For development without Electron, set some defaults
      setTimeout(() => {
        setWebsiteName('Mock Website');
        setWebsitePath('/mock');
        setLoading(false);
      }, 500);
    }
  }, []);

  return (
    <AppContext.Provider
      value={{
        state,
        setCurrentView,
        setSelectedFile,
        setWebsiteName,
        setWebsitePath,
        setLoading,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};
