import { AnglesiteWebsiteConfiguration } from './website.js';

/**
 * Data available in Eleventy's data cascade
 */
export interface EleventyData {
  website: AnglesiteWebsiteConfiguration;
}

/**
 * Page data structure from Eleventy with sitemap-specific properties
 */
export interface PageData extends EleventyData {
  page: {
    url: string;
    date: Date;
    inputPath: string;
    outputPath: string;
  };
  sitemap?:
    | false
    | {
        exclude?: boolean;
        changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
        priority?: number;
        lastmod?: Date | string;
      };
  priority?: number;
  eleventyExcludeFromCollections?: boolean;
}
