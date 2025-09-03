import * as fs from 'fs';
import * as path from 'path';
// @ts-expect-error - xml package doesn't have TypeScript definitions
import xml from 'xml';
import type { EleventyConfig, EleventyCollectionItem, EleventyCollectionApi } from '@11ty/eleventy';
import { AnglesiteWebsiteConfiguration } from '../types/website.js';

interface EleventyData {
  website: AnglesiteWebsiteConfiguration;
}

interface PodcastConfig {
  enabled?: boolean;
  explicit?: boolean;
  type?: 'episodic' | 'serial';
  complete?: boolean;
  block?: boolean;
  owner?: {
    name?: string;
    email?: string;
  };
  categories?: string[];
  subtitle?: string;
  summary?: string;
  keywords?: string[];
}

interface FeedConfig {
  enabled?: boolean;
  types?: ('rss' | 'atom' | 'json')[];
  title?: string;
  description?: string;
  limit?: number;
  filename?: string;
  path?: string;
  podcast?: PodcastConfig;
}

interface FeedsConfiguration {
  enabled?: boolean;
  defaultTypes?: ('rss' | 'atom' | 'json')[];
  mainCollection?: string;
  collections?: Record<string, FeedConfig>;
  author?: {
    name?: string;
    email?: string;
    url?: string;
  };
  copyright?: string;
  category?: string;
  image?: string;
  ttl?: number;
}

interface ExtendedWebsiteConfig extends AnglesiteWebsiteConfiguration {
  feeds?: FeedsConfiguration;
}

interface EleventyCollectionItemWithContent extends EleventyCollectionItem {
  content?: string;
}

interface ExtendedCollectionApi extends EleventyCollectionApi {
  getFilteredByTag(tag: string): EleventyCollectionItem[];
}

interface EleventyAfterEvent {
  dir: {
    input: string;
    output: string;
  };
  results: EleventyCollectionItem[];
}

/**
 * Formats a date for RSS/Atom feeds.
 * @param date - The date to format
 * @returns The formatted date string
 */
function formatRssDate(date: Date): string {
  return date.toUTCString();
}

/**
 * Formats a date for Atom feeds.
 * @param date - The date to format
 * @returns The formatted date string in ISO format
 */
function formatAtomDate(date: Date): string {
  return date.toISOString();
}

interface FeedPageData {
  title?: string;
  author?: string;
  date?: Date;
  tags?: string | string[];
  page?: {
    date: Date;
    url: string;
  };
  // Podcast episode metadata
  audio?: {
    url: string;
    size?: number;
    duration?: number;
    type?: string;
  };
  episode?: {
    number?: number;
    season?: number;
    type?: 'full' | 'trailer' | 'bonus';
    explicit?: boolean;
    block?: boolean;
    subtitle?: string;
    summary?: string;
    keywords?: string[];
  };
}

interface FeedCollectionItem extends EleventyCollectionItem {
  content?: string;
  data: FeedPageData;
}

/**
 * Gets the publication date from a page item.
 * @param item - The collection item to extract date from
 * @returns The publication date
 */
function getPublicationDate(item: FeedCollectionItem): Date {
  const pageData = item.data;
  return pageData.page?.date || pageData.date || item.date || new Date();
}

/**
 * Gets the content from a page item, preferring content over template content.
 * @param item - The collection item to extract content from
 * @returns The item content
 */
function getItemContent(item: FeedCollectionItem): string {
  return item.content || item.templateContent || '';
}

/**
 * Gets the URL for a page item.
 * @param item - The collection item to extract URL from
 * @param baseUrl - The base URL of the site
 * @returns The full URL for the item
 */
function getItemUrl(item: EleventyCollectionItem, baseUrl: string): string {
  const url = item.url || item.data.permalink || '/';
  return new URL(url, baseUrl).toString();
}

/**
 * Generates RSS 2.0 feed content.
 * @param items - The collection items to include in the feed
 * @param config - The website configuration
 * @param collectionName - The name of the collection
 * @param feedConfig - The feed-specific configuration
 * @param collectionPath - The collection path for organizing feeds
 * @returns The RSS XML content
 */
function generateRssFeed(
  items: FeedCollectionItem[],
  config: ExtendedWebsiteConfig,
  collectionName: string,
  feedConfig: FeedConfig,
  collectionPath: string
): string {
  const feedTitle = feedConfig.title || `${config.title} - ${collectionName}`;
  const feedDescription = feedConfig.description || config.description || `${collectionName} from ${config.title}`;
  const baseUrl = config.url || 'https://example.com';
  const buildDate = new Date();

  const channelElements: Record<string, unknown>[] = [
    { title: feedTitle },
    { link: baseUrl },
    { description: feedDescription },
    { language: config.language || 'en' },
    { lastBuildDate: formatRssDate(buildDate) },
    { generator: 'Anglesite 11ty' },
    {
      'atom:link': [
        {
          _attr: {
            href: new URL(`${collectionPath}/${feedConfig.filename || collectionName}.rss.xml`, baseUrl).toString(),
            rel: 'self',
            type: 'application/rss+xml',
          },
        },
      ],
    },
  ];

  if (config.feeds?.author?.name) {
    const authorEmail = config.feeds.author.email || '';
    if (authorEmail) {
      channelElements.push({
        managingEditor: `${authorEmail} (${config.feeds.author.name})`,
      });
    }
  }

  if (config.feeds?.copyright) {
    channelElements.push({ copyright: config.feeds.copyright });
  }

  if (config.feeds?.category) {
    channelElements.push({ category: config.feeds.category });
  }

  if (config.feeds?.image) {
    channelElements.push({
      image: [{ url: config.feeds.image }, { title: feedTitle }, { link: baseUrl }],
    });
  }

  if (config.feeds?.ttl) {
    channelElements.push({ ttl: config.feeds.ttl });
  }

  // Add podcast-specific channel elements
  if (feedConfig.podcast?.enabled) {
    if (feedConfig.podcast.subtitle) {
      channelElements.push({ 'itunes:subtitle': feedConfig.podcast.subtitle });
    }
    if (feedConfig.podcast.summary) {
      channelElements.push({ 'itunes:summary': feedConfig.podcast.summary });
    }
    if (feedConfig.podcast.owner?.name) {
      const ownerElements: Record<string, unknown>[] = [{ 'itunes:name': feedConfig.podcast.owner.name }];
      if (feedConfig.podcast.owner.email) {
        ownerElements.push({ 'itunes:email': feedConfig.podcast.owner.email });
      }
      channelElements.push({ 'itunes:owner': ownerElements });
    }
    if (feedConfig.podcast.explicit !== undefined) {
      channelElements.push({ 'itunes:explicit': feedConfig.podcast.explicit ? 'true' : 'false' });
    }
    if (feedConfig.podcast.type) {
      channelElements.push({ 'itunes:type': feedConfig.podcast.type });
    }
    if (feedConfig.podcast.complete) {
      channelElements.push({ 'itunes:complete': 'Yes' });
    }
    if (feedConfig.podcast.block) {
      channelElements.push({ 'itunes:block': 'Yes' });
    }
    if (feedConfig.podcast.categories && feedConfig.podcast.categories.length > 0) {
      for (const category of feedConfig.podcast.categories) {
        channelElements.push({ 'itunes:category': [{ _attr: { text: category } }] });
      }
    }
    if (feedConfig.podcast.keywords && feedConfig.podcast.keywords.length > 0) {
      channelElements.push({ 'itunes:keywords': feedConfig.podcast.keywords.join(',') });
    }
    if (config.feeds?.image) {
      channelElements.push({ 'itunes:image': [{ _attr: { href: config.feeds.image } }] });
    }
  }

  // Add items
  for (const item of items) {
    const pageData = item.data;
    const pubDate = getPublicationDate(item);
    const itemUrl = getItemUrl(item, baseUrl);
    const content = getItemContent(item);

    const itemElements: Record<string, unknown>[] = [
      { title: pageData.title || 'Untitled' },
      { link: itemUrl },
      { description: { _cdata: content } },
      { pubDate: formatRssDate(pubDate) },
      { guid: [{ _attr: { isPermaLink: 'true' } }, itemUrl] },
    ];

    if (pageData.author || config.feeds?.author?.name) {
      const authorName = pageData.author || config.feeds?.author?.name;
      const authorEmail = config.feeds?.author?.email || '';
      if (authorEmail) {
        itemElements.push({
          author: `${authorEmail} (${authorName})`,
        });
      }
    }

    // Add podcast episode elements
    if (feedConfig.podcast?.enabled && pageData.audio) {
      // Add enclosure for audio file (required for podcast)
      itemElements.push({
        enclosure: [
          {
            _attr: {
              url: new URL(pageData.audio.url, baseUrl).toString(),
              length: pageData.audio.size || 0,
              type: pageData.audio.type || 'audio/mpeg',
            },
          },
        ],
      });

      // Add iTunes-specific episode elements
      if (pageData.audio.duration) {
        const hours = Math.floor(pageData.audio.duration / 3600);
        const minutes = Math.floor((pageData.audio.duration % 3600) / 60);
        const seconds = pageData.audio.duration % 60;
        const duration =
          hours > 0
            ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
            : `${minutes}:${seconds.toString().padStart(2, '0')}`;
        itemElements.push({ 'itunes:duration': duration });
      }

      if (pageData.episode?.number) {
        itemElements.push({ 'itunes:episode': pageData.episode.number });
      }
      if (pageData.episode?.season) {
        itemElements.push({ 'itunes:season': pageData.episode.season });
      }
      if (pageData.episode?.type) {
        itemElements.push({ 'itunes:episodeType': pageData.episode.type });
      }
      if (pageData.episode?.explicit !== undefined) {
        itemElements.push({ 'itunes:explicit': pageData.episode.explicit ? 'true' : 'false' });
      }
      if (pageData.episode?.block) {
        itemElements.push({ 'itunes:block': 'Yes' });
      }
      if (pageData.episode?.subtitle) {
        itemElements.push({ 'itunes:subtitle': pageData.episode.subtitle });
      }
      if (pageData.episode?.summary) {
        itemElements.push({ 'itunes:summary': pageData.episode.summary });
      }
      if (pageData.episode?.keywords && pageData.episode.keywords.length > 0) {
        itemElements.push({ 'itunes:keywords': pageData.episode.keywords.join(',') });
      }
    }

    channelElements.push({ item: itemElements });
  }

  // Determine namespaces based on podcast configuration
  const namespaces: Record<string, string> = {
    version: '2.0',
    'xmlns:atom': 'http://www.w3.org/2005/Atom',
  };

  // Add iTunes namespace if podcast is enabled
  if (feedConfig.podcast?.enabled) {
    namespaces['xmlns:itunes'] = 'http://www.itunes.com/dtds/podcast-1.0.dtd';
    namespaces['xmlns:content'] = 'http://purl.org/rss/1.0/modules/content/';
  }

  const rssObj = {
    rss: [
      {
        _attr: namespaces,
      },
      { channel: channelElements },
    ],
  };

  return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml(rssObj);
}

/**
 * Generates Atom 1.0 feed content.
 * @param items - The collection items to include in the feed
 * @param config - The website configuration
 * @param collectionName - The name of the collection
 * @param feedConfig - The feed-specific configuration
 * @param collectionPath - The collection path for organizing feeds
 * @returns The Atom XML content
 */
function generateAtomFeed(
  items: FeedCollectionItem[],
  config: ExtendedWebsiteConfig,
  collectionName: string,
  feedConfig: FeedConfig,
  collectionPath: string
): string {
  const feedTitle = feedConfig.title || `${config.title} - ${collectionName}`;
  const feedDescription = feedConfig.description || config.description || `${collectionName} from ${config.title}`;
  const baseUrl = config.url || 'https://example.com';
  const buildDate = new Date();

  const feedElements: Record<string, unknown>[] = [
    { title: feedTitle },
    { link: [{ _attr: { href: baseUrl } }] },
    {
      link: [
        {
          _attr: {
            href: new URL(`${collectionPath}/${feedConfig.filename || collectionName}.atom.xml`, baseUrl).toString(),
            rel: 'self',
          },
        },
      ],
    },
    { id: baseUrl },
    { updated: formatAtomDate(buildDate) },
    { subtitle: feedDescription },
    { generator: 'Anglesite 11ty' },
  ];

  if (config.feeds?.author?.name) {
    const authorElements: Record<string, unknown>[] = [{ name: config.feeds.author.name }];
    if (config.feeds.author.email) {
      authorElements.push({ email: config.feeds.author.email });
    }
    if (config.feeds.author.url) {
      authorElements.push({ uri: config.feeds.author.url });
    }
    feedElements.push({ author: authorElements });
  }

  if (config.feeds?.copyright) {
    feedElements.push({ rights: config.feeds.copyright });
  }

  if (config.feeds?.category) {
    feedElements.push({
      category: [{ _attr: { term: config.feeds.category } }],
    });
  }

  // Add entries
  for (const item of items) {
    const pageData = item.data;
    const pubDate = getPublicationDate(item);
    const itemUrl = getItemUrl(item, baseUrl);
    const content = getItemContent(item);

    const entryElements: Record<string, unknown>[] = [
      { title: pageData.title || 'Untitled' },
      { link: [{ _attr: { href: itemUrl } }] },
      { id: itemUrl },
      { updated: formatAtomDate(pubDate) },
      { content: [{ _attr: { type: 'html' } }, { _cdata: content }] },
    ];

    if (pageData.author || config.feeds?.author?.name) {
      const authorName = pageData.author || config.feeds?.author?.name;
      const authorElements: Record<string, unknown>[] = [{ name: authorName }];
      if (config.feeds?.author?.email) {
        authorElements.push({ email: config.feeds.author.email });
      }
      entryElements.push({ author: authorElements });
    }

    feedElements.push({ entry: entryElements });
  }

  const atomObj = {
    feed: [
      {
        _attr: {
          xmlns: 'http://www.w3.org/2005/Atom',
        },
      },
      ...feedElements,
    ],
  };

  return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml(atomObj);
}

/**
 * Generates JSON Feed 1.1 content.
 * @param items - The collection items to include in the feed
 * @param config - The website configuration
 * @param collectionName - The name of the collection
 * @param feedConfig - The feed-specific configuration
 * @param collectionPath - The collection path for organizing feeds
 * @returns The JSON feed content
 */
function generateJsonFeed(
  items: FeedCollectionItem[],
  config: ExtendedWebsiteConfig,
  collectionName: string,
  feedConfig: FeedConfig,
  collectionPath: string
): string {
  const feedTitle = feedConfig.title || `${config.title} - ${collectionName}`;
  const feedDescription = feedConfig.description || config.description || `${collectionName} from ${config.title}`;
  const baseUrl = config.url || 'https://example.com';

  interface JsonFeed {
    version: string;
    title: string;
    home_page_url: string;
    feed_url: string;
    description: string;
    language: string;
    authors?: Array<{ name: string; email?: string; url?: string }>;
    icon?: string;
    items: Array<{
      id: string;
      url: string;
      title: string;
      content_html: string;
      date_published: string;
      authors?: Array<{ name: string }>;
      attachments?: Array<{
        url: string;
        mime_type: string;
        size_in_bytes?: number;
        duration_in_seconds?: number;
      }>;
      _podcast?: {
        episode?: number;
        season?: number;
        type?: string;
        explicit?: boolean;
        block?: boolean;
        subtitle?: string;
        summary?: string;
      };
    }>;
  }

  const feed: JsonFeed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: feedTitle,
    home_page_url: baseUrl,
    feed_url: new URL(`${collectionPath}/${feedConfig.filename || collectionName}.json`, baseUrl).toString(),
    description: feedDescription,
    language: config.language || 'en',
    items: [],
  };

  if (config.feeds?.author?.name) {
    feed.authors = [
      {
        name: config.feeds.author.name,
        ...(config.feeds.author.email && { email: config.feeds.author.email }),
        ...(config.feeds.author.url && { url: config.feeds.author.url }),
      },
    ];
  }

  if (config.feeds?.image) {
    feed.icon = config.feeds.image;
  }

  feed.items = items.map((item) => {
    const pageData = item.data;
    const pubDate = getPublicationDate(item);
    const itemUrl = getItemUrl(item, baseUrl);
    const content = getItemContent(item);

    const feedItem: JsonFeed['items'][0] = {
      id: itemUrl,
      url: itemUrl,
      title: pageData.title || 'Untitled',
      content_html: content,
      date_published: pubDate.toISOString(),
    };

    const authorName = pageData.author || config.feeds?.author?.name;
    if (authorName) {
      feedItem.authors = [
        {
          name: authorName,
        },
      ];
    }

    // Add podcast attachments and metadata to JSON Feed
    if (feedConfig.podcast?.enabled && pageData.audio) {
      feedItem.attachments = [
        {
          url: new URL(pageData.audio.url, baseUrl).toString(),
          mime_type: pageData.audio.type || 'audio/mpeg',
          ...(pageData.audio.size && { size_in_bytes: pageData.audio.size }),
          ...(pageData.audio.duration && { duration_in_seconds: pageData.audio.duration }),
        },
      ];

      // Add podcast-specific extension (using underscore prefix for custom fields)
      if (pageData.episode) {
        feedItem._podcast = {
          ...(pageData.episode.number && { episode: pageData.episode.number }),
          ...(pageData.episode.season && { season: pageData.episode.season }),
          ...(pageData.episode.type && { type: pageData.episode.type }),
          ...(pageData.episode.explicit !== undefined && { explicit: pageData.episode.explicit }),
          ...(pageData.episode.block && { block: pageData.episode.block }),
          ...(pageData.episode.subtitle && { subtitle: pageData.episode.subtitle }),
          ...(pageData.episode.summary && { summary: pageData.episode.summary }),
        };
      }
    }

    return feedItem;
  });

  return JSON.stringify(feed, null, 2);
}

/**
 * Plugin to add RSS, Atom, and JSON feeds for Eleventy collections.
 * @param eleventyConfig - The Eleventy configuration object
 */
export default function addFeeds(eleventyConfig: EleventyConfig): void {
  // Store collections reference for later use
  let collections: ExtendedCollectionApi | null = null;
  eleventyConfig.addCollection('_feedsCollectionCapture', function (collectionApi: EleventyCollectionApi) {
    collections = collectionApi as ExtendedCollectionApi;
    return [];
  });

  eleventyConfig.on('eleventy.after', async ({ dir, results }: EleventyAfterEvent) => {
    if (!results || results.length === 0) {
      return;
    }

    // Try to get website configuration from page data first (for tests)
    // Then fallback to reading from filesystem (for real builds)
    let websiteConfig: ExtendedWebsiteConfig | undefined;

    // Check if the first result has data property (test scenario)
    const firstResult = results[0] as FeedCollectionItem;
    if (firstResult?.data && 'website' in firstResult.data) {
      websiteConfig = (firstResult.data as unknown as EleventyData).website as ExtendedWebsiteConfig;
    } else {
      // Real Eleventy build scenario - read from filesystem
      try {
        const configPath = path.join(dir.input, '_data', 'website.json');
        if (fs.existsSync(configPath)) {
          const configContent = fs.readFileSync(configPath, 'utf-8');
          websiteConfig = JSON.parse(configContent) as ExtendedWebsiteConfig;
        }
      } catch (error) {
        console.warn('Failed to read website configuration for feeds:', error);
        return;
      }
    }

    if (!websiteConfig?.feeds?.enabled) {
      return;
    }

    if (!collections) {
      return;
    }

    const outputDir = dir.output;
    const feedCollections = websiteConfig.feeds.collections || {};
    const defaultTypes = websiteConfig.feeds.defaultTypes || ['rss'];

    // Get collections directly from Eleventy's collection API
    const collectionMap: Record<string, FeedCollectionItem[]> = {};

    for (const collectionName of Object.keys(feedCollections)) {
      const collectionItems = collections.getFilteredByTag(collectionName);
      if (collectionItems && collectionItems.length > 0) {
        collectionMap[collectionName] = collectionItems.map(
          (item: EleventyCollectionItem) =>
            ({
              ...item,
              data: item.data as FeedPageData,
              content: item.templateContent || (item as EleventyCollectionItemWithContent).content || '',
            }) as FeedCollectionItem
        );
      }
    }

    // Generate feeds for configured collections
    for (const [collectionName, feedConfig] of Object.entries(feedCollections)) {
      if (feedConfig.enabled !== false && collectionMap[collectionName]) {
        const config: FeedConfig = {
          types: defaultTypes,
          limit: 20,
          ...feedConfig,
        };
        await generateCollectionFeeds(
          websiteConfig,
          collectionName,
          config,
          collectionMap[collectionName],
          outputDir,
          config.path || collectionName
        );
      }
    }

    // Generate main site feed if configured
    if (websiteConfig.feeds.mainCollection && collectionMap[websiteConfig.feeds.mainCollection]) {
      const mainConfig = feedCollections[websiteConfig.feeds.mainCollection] || {};
      if (mainConfig.enabled !== false) {
        const config: FeedConfig = {
          types: defaultTypes,
          limit: 20,
          filename: 'feed',
          title: websiteConfig.title,
          description: websiteConfig.description,
          ...mainConfig,
        };
        await generateCollectionFeeds(
          websiteConfig,
          websiteConfig.feeds.mainCollection,
          config,
          collectionMap[websiteConfig.feeds.mainCollection],
          outputDir,
          'feed'
        );
      }
    }
  });
}

/**
 * Generates feed files for a collection.
 * @param website - The website configuration
 * @param collectionName - The name of the collection
 * @param feedConfig - The feed-specific configuration
 * @param items - The collection items to include
 * @param outputDir - The output directory path
 * @param collectionPath - The collection path for organizing feeds
 */
async function generateCollectionFeeds(
  website: ExtendedWebsiteConfig,
  collectionName: string,
  feedConfig: FeedConfig,
  items: FeedCollectionItem[],
  outputDir: string,
  collectionPath: string
): Promise<void> {
  const types = feedConfig.types || ['rss'];
  const filename = feedConfig.filename || collectionName;
  const limit = feedConfig.limit || 20;

  // Sort items by date (newest first) and limit
  const sortedItems = items
    .slice()
    .sort((a, b) => {
      const aDate = getPublicationDate(a);
      const bDate = getPublicationDate(b);
      return bDate.getTime() - aDate.getTime();
    })
    .slice(0, limit);

  // Determine the output path - use collection root for collection feeds, site root for main feed
  const feedDir = collectionPath === 'feed' ? outputDir : path.join(outputDir, collectionPath);

  // Create collection directory if it doesn't exist (but not for main feed)
  if (collectionPath !== 'feed') {
    try {
      fs.mkdirSync(feedDir, { recursive: true });
    } catch {
      // Directory might already exist, ignore error
    }
  }

  for (const type of types) {
    const extension = type === 'json' ? '.json' : `.${type}.xml`;
    const outputPath = path.join(feedDir, `${filename}${extension}`);

    let content = '';
    switch (type) {
      case 'rss':
        content = generateRssFeed(sortedItems, website, collectionName, feedConfig, collectionPath);
        break;
      case 'atom':
        content = generateAtomFeed(sortedItems, website, collectionName, feedConfig, collectionPath);
        break;
      case 'json':
        content = generateJsonFeed(sortedItems, website, collectionName, feedConfig, collectionPath);
        break;
      default:
        continue;
    }

    // Write the feed file
    try {
      fs.writeFileSync(outputPath, content, 'utf-8');
    } catch (error) {
      console.error(`Failed to write ${type.toUpperCase()} feed:`, error);
    }
  }
}
