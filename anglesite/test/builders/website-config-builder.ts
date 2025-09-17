/**
 * @file Test data builders for website configurations and related objects
 * @description Provides fluent builders to create test data consistently across test files
 */

import type { AnglesiteWebsiteConfiguration } from '../../../anglesite-11ty/types/website';

// Define EleventyCollectionItem locally since it's not exported from @11ty/eleventy
interface EleventyCollectionItem {
  url: string;
  date: Date;
  inputPath: string;
  outputPath: string;
  data: Record<string, unknown>;
  templateContent: string;
}

// Define RSLConfiguration locally since the path doesn't exist yet
interface RSLConfiguration {
  enabled: boolean;
  defaultOutputFormats?: string[];
  defaultLicense?: {
    permits: Array<{ type: string; values: string[] }>;
    prohibits?: Array<{ type: string; values: string[] }>;
    payment?: { type: string; attribution?: boolean };
    copyright?: string;
  };
  collections?: Record<
    string,
    {
      enabled: boolean;
      outputFormats?: string[];
    }
  >;
  contentDiscovery?: {
    enabled: boolean;
    maxDepth?: number;
    includeExtensions?: string[];
    generateChecksums?: boolean;
  };
}

/**
 * Builder for creating AnglesiteWebsiteConfiguration test objects
 */
class WebsiteConfigBuilder {
  private config: Partial<AnglesiteWebsiteConfiguration> = {};

  /**
   * Set the website title.
   */
  withTitle(title: string): WebsiteConfigBuilder {
    this.config.title = title;
    return this;
  }

  /**
   * Set the website URL.
   */
  withUrl(url: string): WebsiteConfigBuilder {
    this.config.url = url;
    return this;
  }

  /**
   * Set the website language.
   */
  withLanguage(language: string): WebsiteConfigBuilder {
    this.config.language = language;
    return this;
  }

  /**
   * Set the website description.
   */
  withDescription(description: string): WebsiteConfigBuilder {
    this.config.description = description;
    return this;
  }

  /**
   * Set the author information.
   */
  withAuthor(name: string, email?: string): WebsiteConfigBuilder {
    this.config.author = {
      name,
      ...(email && { email }),
    };
    return this;
  }

  /**
   * Add RSL configuration to the website.
   */
  withRSL(rslConfig?: Partial<RSLConfiguration>): WebsiteConfigBuilder {
    this.config.rsl = {
      enabled: true,
      defaultOutputFormats: ['sitewide', 'collection'],
      defaultLicense: {
        permits: [
          { type: 'usage', values: ['view', 'download'] },
          { type: 'user', values: ['individual'] },
        ],
        prohibits: [{ type: 'usage', values: ['ai-training', 'commercial'] }],
        payment: { type: 'free', attribution: true },
        copyright: 'Copyright © 2023 Test Website',
      },
      collections: {
        posts: {
          enabled: true,
          outputFormats: ['collection'],
        },
      },
      contentDiscovery: {
        enabled: true,
        maxDepth: 3,
        includeExtensions: ['.md', '.html', '.jpg', '.png'],
        generateChecksums: false,
      },
      ...rslConfig,
    };
    return this;
  }

  /**
   * Create a minimal configuration for quick tests.
   */
  minimal(): WebsiteConfigBuilder {
    return this.withTitle('Test Site').withUrl('https://test.example.com').withLanguage('en');
  }

  /**
   * Create a comprehensive configuration for integration tests.
   */
  comprehensive(): WebsiteConfigBuilder {
    return this.minimal()
      .withDescription('A comprehensive test website')
      .withAuthor('Test Author', 'test@example.com')
      .withRSL();
  }

  /**
   * Create configuration for RSL-specific tests.
   */
  withRSLEnabled(): WebsiteConfigBuilder {
    return this.minimal().withRSL();
  }

  /**
   * Create configuration with RSL disabled.
   */
  withRSLDisabled(): WebsiteConfigBuilder {
    return this.minimal().withRSL({ enabled: false });
  }

  /**
   * Build the final configuration object.
   */
  build(): AnglesiteWebsiteConfiguration {
    return {
      title: 'Test Website',
      url: 'https://example.com',
      language: 'en',
      ...this.config,
    } as AnglesiteWebsiteConfiguration;
  }
}

/**
 * Builder for creating Eleventy collection items
 */
class CollectionItemBuilder {
  private item: Partial<EleventyCollectionItem> = {};

  withUrl(url: string): CollectionItemBuilder {
    this.item.url = url;
    return this;
  }

  withDate(date: Date): CollectionItemBuilder {
    this.item.date = date;
    return this;
  }

  withInputPath(inputPath: string): CollectionItemBuilder {
    this.item.inputPath = inputPath;
    return this;
  }

  withOutputPath(outputPath: string): CollectionItemBuilder {
    this.item.outputPath = outputPath;
    return this;
  }

  withData(data: Record<string, unknown>): CollectionItemBuilder {
    this.item.data = { ...this.item.data, ...data };
    return this;
  }

  withTemplateContent(content: string): CollectionItemBuilder {
    this.item.templateContent = content;
    return this;
  }

  withTitle(title: string): CollectionItemBuilder {
    this.item.data = { ...this.item.data, title };
    return this;
  }

  withAuthor(author: string): CollectionItemBuilder {
    this.item.data = { ...this.item.data, author };
    return this;
  }

  withTags(tags: string[]): CollectionItemBuilder {
    this.item.data = { ...this.item.data, tags };
    return this;
  }

  /**
   * Create a typical blog post item.
   */
  asBlogPost(title?: string): CollectionItemBuilder {
    const postTitle = title || 'Test Blog Post';
    return this.withUrl(`/posts/${postTitle.toLowerCase().replace(/\s+/g, '-')}/`)
      .withTitle(postTitle)
      .withDate(new Date())
      .withTags(['posts'])
      .withTemplateContent(`<h1>${postTitle}</h1><p>Test content.</p>`);
  }

  /**
   * Create a typical page item.
   */
  asPage(title?: string): CollectionItemBuilder {
    const pageTitle = title || 'Test Page';
    return this.withUrl(`/${pageTitle.toLowerCase().replace(/\s+/g, '-')}/`)
      .withTitle(pageTitle)
      .withDate(new Date())
      .withTemplateContent(`<h1>${pageTitle}</h1><p>Test page content.</p>`);
  }

  build(): EleventyCollectionItem {
    return {
      url: '/test/',
      date: new Date(),
      inputPath: './src/test.md',
      outputPath: './dist/test/index.html',
      data: {},
      templateContent: '<p>Test content</p>',
      ...this.item,
    } as EleventyCollectionItem;
  }
}

/**
 * Builder for creating file system objects for tests
 */
class FileSystemBuilder {
  private files: Array<{ name: string; filePath: string; isDirectory: boolean; relativePath: string }> = [];

  addFile(name: string, relativePath?: string): FileSystemBuilder {
    this.files.push({
      name,
      filePath: `/test/path/${relativePath || name}`,
      isDirectory: false,
      relativePath: relativePath || name,
    });
    return this;
  }

  addDirectory(name: string, relativePath?: string): FileSystemBuilder {
    this.files.push({
      name,
      filePath: `/test/path/${relativePath || name}`,
      isDirectory: true,
      relativePath: relativePath || name,
    });
    return this;
  }

  /**
   * Add typical website files.
   */
  withStandardFiles(): FileSystemBuilder {
    return this.addFile('index.md')
      .addFile('404.md')
      .addFile('about.md')
      .addDirectory('_includes')
      .addDirectory('_data')
      .addFile('website.json', '_data/website.json');
  }

  /**
   * Add blog-specific files.
   */
  withBlogFiles(): FileSystemBuilder {
    return this.withStandardFiles()
      .addDirectory('posts')
      .addFile('first-post.md', 'posts/first-post.md')
      .addFile('second-post.md', 'posts/second-post.md');
  }

  build() {
    return this.files;
  }
}

/**
 * Builder for creating JSON schema objects for testing
 */
class SchemaBuilder {
  private schema: Record<string, unknown> = {};

  withTitle(title: string): SchemaBuilder {
    this.schema.title = title;
    return this;
  }

  withType(type: string): SchemaBuilder {
    this.schema.type = type;
    return this;
  }

  withProperty(name: string, property: Record<string, unknown>): SchemaBuilder {
    if (!this.schema.properties) {
      this.schema.properties = {};
    }
    (this.schema.properties as Record<string, unknown>)[name] = property;
    return this;
  }

  withRequired(fields: string[]): SchemaBuilder {
    this.schema.required = fields;
    return this;
  }

  /**
   * Create a standard website schema.
   */
  asWebsiteSchema(): SchemaBuilder {
    return this.withTitle('Website Configuration Schema')
      .withType('object')
      .withProperty('title', { type: 'string', title: 'Website Title' })
      .withProperty('language', { type: 'string', title: 'Language', default: 'en' })
      .withProperty('description', { type: 'string', title: 'Description' })
      .withRequired(['title', 'language']);
  }

  build() {
    return {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      ...this.schema,
    };
  }
}

/**
 * Convenience functions for common test data
 */
export const TestData = {
  /**
   * Create a minimal website configuration.
   */
  minimalWebsiteConfig: () => new WebsiteConfigBuilder().minimal().build(),

  /**
   * Create a comprehensive website configuration.
   */
  comprehensiveWebsiteConfig: () => new WebsiteConfigBuilder().comprehensive().build(),

  /**
   * Create a blog post collection item.
   */
  blogPost: (title?: string) => new CollectionItemBuilder().asBlogPost(title).build(),

  /**
   * Create a page collection item.
   */
  page: (title?: string) => new CollectionItemBuilder().asPage(title).build(),

  /**
   * Create standard website files structure.
   */
  standardFiles: () => new FileSystemBuilder().withStandardFiles().build(),

  /**
   * Create blog website files structure.
   */
  blogFiles: () => new FileSystemBuilder().withBlogFiles().build(),

  /**
   * Create a standard website schema.
   */
  websiteSchema: () => new SchemaBuilder().asWebsiteSchema().build(),
};

// Export builders for direct use
export { WebsiteConfigBuilder, CollectionItemBuilder, FileSystemBuilder, SchemaBuilder };
