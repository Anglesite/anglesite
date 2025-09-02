import React, { createContext, useContext, useState, useEffect } from 'react';

interface AppState {
  currentView: 'file-editor' | 'website-config';
  selectedFile: string | null;
  websiteName: string;
  websitePath: string | null;
  loading: boolean;
}

interface AppContextType {
  state: AppState;
  setCurrentView: (view: AppState['currentView']) => void;
  setSelectedFile: (file: string | null) => void;
  setWebsiteName: (name: string) => void;
  setWebsitePath: (path: string | null) => void;
  setLoading: (loading: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState>({
    currentView: 'file-editor',
    selectedFile: null,
    websiteName: 'My Website',
    websitePath: null,
    loading: true,
  });

  const setCurrentView = (view: AppState['currentView']) => {
    setState((prev) => ({ ...prev, currentView: view }));
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

  // Listen for website loading events
  useEffect(() => {
    const handleLoadWebsite = (websiteData: any) => {
      setWebsiteName(websiteData.name);
      setWebsitePath(websiteData.path);
      setLoading(false);
    };

    if (window.electronAPI) {
      window.electronAPI.on('load-website', handleLoadWebsite);

      // Cleanup
      return () => {
        window.electronAPI?.off('load-website', handleLoadWebsite);
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
