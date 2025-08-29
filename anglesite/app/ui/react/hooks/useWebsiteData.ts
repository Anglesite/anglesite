import { useState, useEffect } from 'react';

interface WebsiteData {
  title?: string;
  description?: string;
  url?: string;
  language?: string;
  author?: {
    name?: string;
    email?: string;
    url?: string;
  };
}

export const useWebsiteData = () => {
  const [websiteData, setWebsiteData] = useState<WebsiteData>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWebsiteData = async () => {
    try {
      setIsLoading(true);
      // Future: Load from src/_data/website.json via Electron IPC
      // For now, just simulate loading
      await new Promise((resolve) => setTimeout(resolve, 100));
      setWebsiteData({
        title: 'My Website',
        description: 'A great website built with Anglesite',
        language: 'en',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load website data');
    } finally {
      setIsLoading(false);
    }
  };

  const saveWebsiteData = async (data: WebsiteData) => {
    try {
      // Future: Save to src/_data/website.json via Electron IPC
      setWebsiteData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save website data');
      throw err;
    }
  };

  useEffect(() => {
    loadWebsiteData();
  }, []);

  return {
    websiteData,
    setWebsiteData,
    saveWebsiteData,
    isLoading,
    error,
    reload: loadWebsiteData,
  };
};
