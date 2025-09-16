import * as fs from 'fs';
import addFeeds from '../../plugins/feeds';
import type { EleventyConfig, EleventyCollectionApi, EleventyCollectionItem } from '@11ty/eleventy';

// Mock the fs module
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock the xml module
jest.mock('xml', () => ({
  __esModule: true,
  default: jest.fn((obj: unknown) => JSON.stringify(obj)),
}));

// Mock path module
jest.mock('path', () => ({
  ...jest.requireActual('path'),
  join: jest.fn((...paths: string[]) => paths.join('/')),
}));

interface MockEleventyConfig extends Partial<EleventyConfig> {
  on: jest.Mock;
  addCollection: jest.Mock;
  collections?: Record<string, EleventyCollectionItem[]>;
}

interface MockEleventyAfterEvent {
  dir: {
    input: string;
    output: string;
  };
  results: EleventyCollectionItem[];
}

describe('Feeds Plugin', () => {
  let mockEleventyConfig: MockEleventyConfig;
  let mockCollectionApi: Partial<EleventyCollectionApi>;
  let onEventHandler: (event: MockEleventyAfterEvent) => Promise<void>;
  let collectionHandler: (api: EleventyCollectionApi) => unknown[];

  const mockWebsiteConfig = {
    title: 'Test Site',
    description: 'A test site',
    url: 'https://example.com',
    language: 'en',
    feeds: {
      enabled: true,
      defaultTypes: ['rss', 'atom', 'json'] as const,
      mainCollection: 'posts',
      collections: {
        posts: {
          enabled: true,
          title: 'Blog Posts',
          description: 'Latest blog posts',
          limit: 10,
          // Note: filename for collection feeds, main site feed uses 'feed'
        },
        podcast: {
          enabled: true,
          title: 'Test Podcast',
          description: 'A test podcast',
          limit: 20,
          podcast: {
            enabled: true,
            explicit: false,
            type: 'episodic' as const,
            owner: {
              name: 'John Doe',
              email: 'john@example.com',
            },
            categories: ['Technology'],
            subtitle: 'A test podcast about tech',
            summary: 'This is a test podcast',
            keywords: ['tech', 'test'],
          },
        },
      },
      author: {
        name: 'Test Author',
        email: 'author@example.com',
        url: 'https://example.com/author',
      },
      copyright: '2023 Test Site',
      category: 'Technology',
      image: 'https://example.com/image.png',
      ttl: 60,
    },
  };

  const mockCollectionItems: EleventyCollectionItem[] = [
    {
      url: '/post1/',
      date: new Date('2023-01-01'),
      data: {
        title: 'First Post',
        author: 'Jane Doe',
        date: new Date('2023-01-01'),
        page: {
          url: '/post1/',
          date: new Date('2023-01-01'),
        },
      },
      templateContent: '<p>First post content</p>',
    } as EleventyCollectionItem,
    {
      url: '/post2/',
      date: new Date('2023-01-02'),
      data: {
        title: 'Second Post',
        date: new Date('2023-01-02'),
        page: {
          url: '/post2/',
          date: new Date('2023-01-02'),
        },
      },
      templateContent: '<p>Second post content</p>',
    } as EleventyCollectionItem,
  ];

  const mockPodcastItems: EleventyCollectionItem[] = [
    {
      url: '/episode1/',
      date: new Date('2023-01-01'),
      data: {
        title: 'Episode 1',
        date: new Date('2023-01-01'),
        page: {
          url: '/episode1/',
          date: new Date('2023-01-01'),
        },
        audio: {
          url: '/audio/episode1.mp3',
          size: 12345678,
          duration: 3600,
          type: 'audio/mpeg',
        },
        episode: {
          number: 1,
          season: 1,
          type: 'full' as const,
          explicit: false,
          subtitle: 'First episode',
          summary: 'This is the first episode',
          keywords: ['first', 'episode'],
        },
      },
      templateContent: '<p>Episode 1 content</p>',
    } as EleventyCollectionItem,
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    mockEleventyConfig = {
      on: jest.fn(),
      addCollection: jest.fn(),
    };

    mockCollectionApi = {
      getFilteredByTag: jest.fn((tag: string) => {
        if (tag === 'posts') return mockCollectionItems;
        if (tag === 'podcast') return mockPodcastItems;
        return [];
      }),
    };

    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue('');
    mockFs.writeFileSync.mockImplementation();
    mockFs.mkdirSync.mockImplementation();

    // Initialize the plugin
    addFeeds(mockEleventyConfig as EleventyConfig);

    // Extract the event handlers
    onEventHandler = mockEleventyConfig.on.mock.calls.find((call) => call[0] === 'eleventy.after')?.[1];
    collectionHandler = mockEleventyConfig.addCollection.mock.calls.find(
      (call) => call[0] === '_feedsCollectionCapture'
    )?.[1];
  });

  describe('Plugin Registration', () => {
    it('should register event handlers', () => {
      expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
      expect(mockEleventyConfig.addCollection).toHaveBeenCalledWith('_feedsCollectionCapture', expect.any(Function));
    });

    it('should return empty array for collection capture', () => {
      const result = collectionHandler(mockCollectionApi as EleventyCollectionApi);
      expect(result).toEqual([]);
    });
  });

  describe('Feed Generation - No Results', () => {
    it('should return early when no results', async () => {
      await onEventHandler({
        dir: { input: '/input', output: '/output' },
        results: [],
      });

      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('Feed Generation - With Test Data', () => {
    it('should generate feeds using test data from results', async () => {
      // Mock results with test data
      const mockResults = [
        {
          ...mockCollectionItems[0],
          data: {
            ...mockCollectionItems[0].data,
            website: mockWebsiteConfig,
          },
        },
      ] as EleventyCollectionItem[];

      // Set up collection handler first
      collectionHandler(mockCollectionApi as EleventyCollectionApi);

      await onEventHandler({
        dir: { input: '/input', output: '/output' },
        results: mockResults as EleventyCollectionItem[],
      });

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('Feed Generation - With File System Config', () => {
    it('should read website config from filesystem when not in test data', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockWebsiteConfig));

      // Set up collection handler first
      collectionHandler(mockCollectionApi as EleventyCollectionApi);

      await onEventHandler({
        dir: { input: '/input', output: '/output' },
        results: mockCollectionItems,
      });

      expect(mockFs.existsSync).toHaveBeenCalledWith('/input/_data/website.json');
      expect(mockFs.readFileSync).toHaveBeenCalledWith('/input/_data/website.json', 'utf-8');
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should handle filesystem errors gracefully', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('File read error');
      });

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      // Set up collection handler first
      collectionHandler(mockCollectionApi as EleventyCollectionApi);

      await onEventHandler({
        dir: { input: '/input', output: '/output' },
        results: mockCollectionItems,
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith('Failed to read website configuration for feeds:', expect.any(Error));
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Feed Generation - Feeds Disabled', () => {
    it('should return early when feeds are disabled', async () => {
      const disabledConfig = {
        ...mockWebsiteConfig,
        feeds: {
          ...mockWebsiteConfig.feeds,
          enabled: false,
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(disabledConfig));

      // Set up collection handler first
      collectionHandler(mockCollectionApi as EleventyCollectionApi);

      await onEventHandler({
        dir: { input: '/input', output: '/output' },
        results: mockCollectionItems,
      });

      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('Feed Generation - Collection Feeds', () => {
    it('should generate feeds for configured collections', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockWebsiteConfig));

      // Set up collection handler first
      collectionHandler(mockCollectionApi as EleventyCollectionApi);

      await onEventHandler({
        dir: { input: '/input', output: '/output' },
        results: mockCollectionItems,
      });

      // Should create directory for collection feeds
      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/output/posts', { recursive: true });
      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/output/podcast', { recursive: true });

      // Should write feeds for posts collection
      expect(mockFs.writeFileSync).toHaveBeenCalledWith('/output/posts/posts.rss.xml', expect.any(String), 'utf-8');
      expect(mockFs.writeFileSync).toHaveBeenCalledWith('/output/posts/posts.atom.xml', expect.any(String), 'utf-8');
      expect(mockFs.writeFileSync).toHaveBeenCalledWith('/output/posts/posts.json', expect.any(String), 'utf-8');

      // Should write feeds for podcast collection
      expect(mockFs.writeFileSync).toHaveBeenCalledWith('/output/podcast/podcast.rss.xml', expect.any(String), 'utf-8');
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/output/podcast/podcast.atom.xml',
        expect.any(String),
        'utf-8'
      );
      expect(mockFs.writeFileSync).toHaveBeenCalledWith('/output/podcast/podcast.json', expect.any(String), 'utf-8');
    });

    it('should skip disabled collections', async () => {
      const configWithDisabledCollection = {
        ...mockWebsiteConfig,
        feeds: {
          ...mockWebsiteConfig.feeds,
          collections: {
            ...mockWebsiteConfig.feeds.collections,
            posts: {
              ...mockWebsiteConfig.feeds.collections.posts,
              enabled: false,
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(configWithDisabledCollection));

      // Set up collection handler first
      collectionHandler(mockCollectionApi as EleventyCollectionApi);

      await onEventHandler({
        dir: { input: '/input', output: '/output' },
        results: mockCollectionItems,
      });

      // Should not create posts feeds
      expect(mockFs.writeFileSync).not.toHaveBeenCalledWith('/output/posts/posts.rss.xml', expect.any(String), 'utf-8');

      // Should still create podcast feeds
      expect(mockFs.writeFileSync).toHaveBeenCalledWith('/output/podcast/podcast.rss.xml', expect.any(String), 'utf-8');
    });
  });

  describe('Feed Generation - Main Site Feed', () => {
    it('should generate main site feed', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockWebsiteConfig));

      // Set up collection handler first
      collectionHandler(mockCollectionApi as EleventyCollectionApi);

      await onEventHandler({
        dir: { input: '/input', output: '/output' },
        results: mockCollectionItems,
      });

      // Should write main site feeds (no directory creation for main feed)
      expect(mockFs.writeFileSync).toHaveBeenCalledWith('/output/feed.rss.xml', expect.any(String), 'utf-8');
      expect(mockFs.writeFileSync).toHaveBeenCalledWith('/output/feed.atom.xml', expect.any(String), 'utf-8');
      expect(mockFs.writeFileSync).toHaveBeenCalledWith('/output/feed.json', expect.any(String), 'utf-8');
    });

    it('should skip main feed when collection is disabled', async () => {
      const configWithDisabledMain = {
        ...mockWebsiteConfig,
        feeds: {
          ...mockWebsiteConfig.feeds,
          collections: {
            ...mockWebsiteConfig.feeds.collections,
            posts: {
              ...mockWebsiteConfig.feeds.collections.posts,
              enabled: false,
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(configWithDisabledMain));

      // Set up collection handler first
      collectionHandler(mockCollectionApi as EleventyCollectionApi);

      await onEventHandler({
        dir: { input: '/input', output: '/output' },
        results: mockCollectionItems,
      });

      // Should not create main feed
      expect(mockFs.writeFileSync).not.toHaveBeenCalledWith('/output/feed.rss.xml', expect.any(String), 'utf-8');
    });
  });

  describe('Feed Generation - Error Handling', () => {
    it('should handle write errors gracefully', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockWebsiteConfig));
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('Write error');
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Set up collection handler first
      collectionHandler(mockCollectionApi as EleventyCollectionApi);

      await onEventHandler({
        dir: { input: '/input', output: '/output' },
        results: mockCollectionItems,
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to write RSS feed:', expect.any(Error));

      consoleErrorSpy.mockRestore();
    });

    it('should handle directory creation errors gracefully', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockWebsiteConfig));
      mockFs.mkdirSync.mockImplementation(() => {
        throw new Error('Directory creation error');
      });

      // Set up collection handler first
      collectionHandler(mockCollectionApi as EleventyCollectionApi);

      // Should not throw error
      await expect(
        onEventHandler({
          dir: { input: '/input', output: '/output' },
          results: mockCollectionItems,
        })
      ).resolves.not.toThrow();
    });
  });

  describe('Feed Generation - Content Processing', () => {
    it('should handle items with missing content', async () => {
      const itemsWithoutContent = [
        {
          ...mockCollectionItems[0],
          templateContent: undefined,
        },
      ] as EleventyCollectionItem[];

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockWebsiteConfig));

      // Set up collection API to return items without content
      const mockApiWithoutContent = {
        getFilteredByTag: jest.fn(() => itemsWithoutContent),
      };
      collectionHandler(mockApiWithoutContent as EleventyCollectionApi);

      await onEventHandler({
        dir: { input: '/input', output: '/output' },
        results: mockCollectionItems,
      });

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should handle items with missing titles', async () => {
      const itemsWithoutTitles = [
        {
          ...mockCollectionItems[0],
          data: {
            ...mockCollectionItems[0].data,
            title: undefined,
          },
        },
      ] as EleventyCollectionItem[];

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockWebsiteConfig));

      // Set up collection API to return items without titles
      const mockApiWithoutTitles = {
        getFilteredByTag: jest.fn(() => itemsWithoutTitles),
      };
      collectionHandler(mockApiWithoutTitles as EleventyCollectionApi);

      await onEventHandler({
        dir: { input: '/input', output: '/output' },
        results: mockCollectionItems,
      });

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('Feed Generation - Podcast Features', () => {
    it('should include podcast-specific elements in RSS', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockWebsiteConfig));

      // Set up collection handler first
      collectionHandler(mockCollectionApi as EleventyCollectionApi);

      await onEventHandler({
        dir: { input: '/input', output: '/output' },
        results: mockPodcastItems,
      });

      // Verify that podcast feeds were generated
      expect(mockFs.writeFileSync).toHaveBeenCalledWith('/output/podcast/podcast.rss.xml', expect.any(String), 'utf-8');

      // The actual RSS content is mocked, but we can verify the function was called
      const rssCall = mockFs.writeFileSync.mock.calls.find((call) => call[0] === '/output/podcast/podcast.rss.xml');
      expect(rssCall).toBeDefined();
    });
  });

  describe('Feed Configuration Edge Cases', () => {
    it('should handle missing collections gracefully', async () => {
      const emptyCollectionApi = {
        getFilteredByTag: jest.fn(() => []),
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockWebsiteConfig));

      collectionHandler(emptyCollectionApi as EleventyCollectionApi);

      await onEventHandler({
        dir: { input: '/input', output: '/output' },
        results: mockCollectionItems,
      });

      // Should not write any feeds since collections are empty
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should handle null collections API gracefully', async () => {
      // Don't call collectionHandler to simulate null collections
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockWebsiteConfig));

      await onEventHandler({
        dir: { input: '/input', output: '/output' },
        results: mockCollectionItems,
      });

      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should use default values for missing config properties', async () => {
      const minimalConfig = {
        title: 'Minimal Site',
        feeds: {
          enabled: true,
          collections: {
            posts: {
              enabled: true,
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(minimalConfig));

      // Set up collection handler first
      collectionHandler(mockCollectionApi as EleventyCollectionApi);

      await onEventHandler({
        dir: { input: '/input', output: '/output' },
        results: mockCollectionItems,
      });

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });
});
