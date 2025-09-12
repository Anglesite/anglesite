/**
 * Tests for RSL Generation Module
 */

import {
  generateIndividualRSL,
  generateCollectionRSL,
  generateSiteRSL,
  validateRSLXML,
} from '../../../plugins/rsl/rsl-generator.js';
import type { RSLContentAsset, RSLLicenseConfiguration } from '../../../plugins/rsl/types.js';

describe('RSL Generation Module', () => {
  const testAsset: RSLContentAsset = {
    url: 'https://example.com/image.png',
    size: 1024,
    type: 'image/png',
    lastmod: new Date('2023-12-01T12:00:00Z'),
    checksum: 'abc123def456',
    checksumAlgorithm: 'sha256',
  };

  const testLicense: RSLLicenseConfiguration = {
    permits: [
      { type: 'usage', values: ['view', 'download'] },
      { type: 'user', values: ['individual'] },
    ],
    prohibits: [{ type: 'usage', values: ['commercial', 'ai-training'] }],
    payment: {
      type: 'free',
      attribution: true,
    },
    copyright: 'Copyright © 2023 Example Corp',
    standard: 'https://creativecommons.org/licenses/by-nc/4.0/',
  };

  describe('Individual RSL Generation', () => {
    it('should generate valid RSL XML for a single asset', () => {
      const xml = generateIndividualRSL(testAsset, testLicense, {
        prettyPrint: false,
        includeSchemaLocation: true,
      });

      expect(xml).toContain('<?xml version="1.0"?>');
      expect(xml).toContain('xmlns="https://rslstandard.org/rsl"');
      expect(xml).toContain('url="https://example.com/image.png"');
      expect(xml).toContain('<size>1024</size>');
      expect(xml).toContain('<type>image/png</type>');
      expect(xml).toContain('algorithm="sha256"');
      expect(xml).toContain('abc123def456');
      expect(xml).toContain('Copyright © 2023 Example Corp');
    });

    it('should include schema location when requested', () => {
      const xml = generateIndividualRSL(testAsset, testLicense, {
        includeSchemaLocation: true,
      });

      expect(xml).toContain('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
      expect(xml).toContain(
        'xsi:schemaLocation="https://rslstandard.org/rsl https://rslstandard.org/rsl/schema/rsl-1.0.xsd"'
      );
    });

    it('should generate minimal RSL for asset without optional fields', () => {
      const minimalAsset: RSLContentAsset = {
        url: 'https://example.com/simple.txt',
      };

      const minimalLicense: RSLLicenseConfiguration = {
        copyright: 'All rights reserved',
      };

      const xml = generateIndividualRSL(minimalAsset, minimalLicense);

      expect(xml).toContain('url="https://example.com/simple.txt"');
      expect(xml).toContain('All rights reserved');
      expect(xml).not.toContain('<size>');
      expect(xml).not.toContain('<checksum>');
    });

    it('should handle complex permission structures', () => {
      const complexLicense: RSLLicenseConfiguration = {
        permits: [
          { type: 'usage', values: ['view', 'download', 'modify'] },
          { type: 'user', values: ['individual', 'educational'] },
          { type: 'geo', values: ['worldwide'] },
        ],
        prohibits: [
          { type: 'usage', values: ['commercial', 'ai-training', 'crawl'] },
          { type: 'user', values: ['commercial'] },
        ],
        payment: {
          type: 'subscription',
          amount: 9.99,
          currency: 'USD',
          url: 'https://example.com/subscribe',
        },
      };

      const xml = generateIndividualRSL(testAsset, complexLicense);

      expect(xml).toContain('type="usage"');
      expect(xml).toContain('view,download,modify');
      expect(xml).toContain('individual,educational');
      expect(xml).toContain('worldwide');
      expect(xml).toContain('commercial,ai-training,crawl');
      expect(xml).toContain('type="subscription"');
      expect(xml).toContain('currency="USD"');
      expect(xml).toContain('9.99');
    });

    it('should escape XML special characters', () => {
      const assetWithSpecialChars: RSLContentAsset = {
        url: 'https://example.com/file with spaces & symbols.txt',
      };

      const licenseWithSpecialChars: RSLLicenseConfiguration = {
        copyright: 'Copyright © 2023 "Company & Co." <legal@example.com>',
      };

      const xml = generateIndividualRSL(assetWithSpecialChars, licenseWithSpecialChars);

      expect(xml).toContain('&amp;');
      expect(xml).toContain('&lt;');
      expect(xml).toContain('&gt;');
      // Note: xmlbuilder2 may not escape quotes in attributes the same way
    });

    it('should include metadata when provided', () => {
      const xml = generateIndividualRSL(testAsset, testLicense, {
        metadata: {
          generator: 'Anglesite 11ty v1.0',
          generatedAt: new Date('2023-12-01T12:00:00Z'),
        },
      });

      expect(xml).toContain('Anglesite 11ty v1.0');
      expect(xml).toContain('2023-12-01T12:00:00.000Z');
    });
  });

  describe('Collection RSL Generation', () => {
    const testAssets: RSLContentAsset[] = [
      {
        url: 'https://example.com/doc1.pdf',
        size: 2048,
        type: 'application/pdf',
        lastmod: new Date('2023-12-01T10:00:00Z'),
      },
      {
        url: 'https://example.com/image1.jpg',
        size: 512,
        type: 'image/jpeg',
        lastmod: new Date('2023-12-01T11:00:00Z'),
      },
    ];

    it('should generate RSL XML for multiple assets', () => {
      const xml = generateCollectionRSL(testAssets, testLicense, {
        name: 'Blog Posts',
        description: 'Collection of blog articles and media',
        url: 'https://example.com/blog/',
      });

      expect(xml).toContain('xmlns="https://rslstandard.org/rsl"');
      expect(xml).toContain('<name>Blog Posts</name>');
      expect(xml).toContain('<description>Collection of blog articles and media</description>');
      expect(xml).toContain('url="https://example.com/blog/"');
      expect(xml).toContain('url="https://example.com/doc1.pdf"');
      expect(xml).toContain('url="https://example.com/image1.jpg"');
    });

    it('should handle empty asset collections', () => {
      const xml = generateCollectionRSL([], testLicense, {
        name: 'Empty Collection',
      });

      expect(xml).toContain('<name>Empty Collection</name>');
      expect(xml).not.toContain('<content');
    });

    it('should work without collection metadata', () => {
      const xml = generateCollectionRSL(testAssets, testLicense);

      expect(xml).toContain('url="https://example.com/doc1.pdf"');
      expect(xml).toContain('url="https://example.com/image1.jpg"');
      expect(xml).not.toContain('<collection>');
    });
  });

  describe('Site-wide RSL Generation', () => {
    const siteAssets: RSLContentAsset[] = [
      {
        url: 'https://example.com/index.html',
        size: 1024,
        type: 'text/html',
      },
      {
        url: 'https://example.com/about.html',
        size: 768,
        type: 'text/html',
      },
      {
        url: 'https://example.com/assets/logo.svg',
        size: 256,
        type: 'image/svg+xml',
      },
    ];

    it('should generate site-wide RSL XML', () => {
      const xml = generateSiteRSL(siteAssets, testLicense, {
        title: 'Example Website',
        description: 'A sample website with various content',
        url: 'https://example.com',
        author: 'John Doe',
        language: 'en',
      });

      expect(xml).toContain('<title>Example Website</title>');
      expect(xml).toContain('<description>A sample website with various content</description>');
      expect(xml).toContain('url="https://example.com"');
      expect(xml).toContain('<author>John Doe</author>');
      expect(xml).toContain('language="en"');
      expect(xml).toContain('url="https://example.com/index.html"');
      expect(xml).toContain('url="https://example.com/about.html"');
      expect(xml).toContain('url="https://example.com/assets/logo.svg"');
    });

    it('should handle sites without metadata', () => {
      const xml = generateSiteRSL(siteAssets, testLicense);

      expect(xml).toContain('url="https://example.com/index.html"');
      expect(xml).not.toContain('<site>');
    });

    it('should include partial site metadata', () => {
      const xml = generateSiteRSL(siteAssets, testLicense, {
        title: 'Minimal Site',
        url: 'https://minimal.example.com',
      });

      expect(xml).toContain('<title>Minimal Site</title>');
      expect(xml).toContain('url="https://minimal.example.com"');
      expect(xml).not.toContain('<description>');
      expect(xml).not.toContain('<author>');
    });
  });

  describe('Legal and Schema Elements', () => {
    it('should include legal disclaimers', () => {
      const licenseWithLegal: RSLLicenseConfiguration = {
        ...testLicense,
        legal: {
          warranty: 'No warranty provided',
          liability: 'Limited liability as per terms',
          law: 'Governed by California law',
        },
      };

      const xml = generateIndividualRSL(testAsset, licenseWithLegal);

      expect(xml).toContain('<warranty>No warranty provided</warranty>');
      expect(xml).toContain('<liability>Limited liability as per terms</liability>');
      expect(xml).toContain('<law>Governed by California law</law>');
    });

    it('should include schema.org metadata', () => {
      const licenseWithSchema: RSLLicenseConfiguration = {
        ...testLicense,
        schema: {
          type: 'CreativeWork',
          properties: {
            author: 'John Doe',
            datePublished: '2023-12-01',
          },
        },
      };

      const xml = generateIndividualRSL(testAsset, licenseWithSchema);

      expect(xml).toContain('type="CreativeWork"');
      expect(xml).toContain('<author>John Doe</author>');
      expect(xml).toContain('<datePublished>2023-12-01</datePublished>');
    });

    it('should handle custom and terms URLs', () => {
      const licenseWithUrls: RSLLicenseConfiguration = {
        ...testLicense,
        custom: 'https://example.com/custom-license',
        terms: 'https://example.com/terms-of-use',
      };

      const xml = generateIndividualRSL(testAsset, licenseWithUrls);

      expect(xml).toContain('url="https://example.com/custom-license"');
      expect(xml).toContain('url="https://example.com/terms-of-use"');
    });
  });

  describe('XML Validation', () => {
    it('should validate well-formed RSL XML', () => {
      const xml = generateIndividualRSL(testAsset, testLicense);
      const result = validateRSLXML(xml);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing RSL namespace', () => {
      const invalidXml = '<?xml version="1.0"?><rsl><content url="test"/></rsl>';
      const result = validateRSLXML(invalidXml);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('xmlns="https://rslstandard.org/rsl"'));
    });

    it('should detect missing content URL attributes', () => {
      const invalidXml = `<?xml version="1.0"?>
        <rsl xmlns="https://rslstandard.org/rsl">
          <content><size>100</size></content>
        </rsl>`;
      const result = validateRSLXML(invalidXml);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining("missing required 'url' attribute"));
    });

    it('should warn about missing content or license elements', () => {
      const minimalXml = '<?xml version="1.0"?><rsl xmlns="https://rslstandard.org/rsl"></rsl>';
      const result = validateRSLXML(minimalXml);

      expect(result.valid).toBe(true); // Structurally valid
      expect(result.warnings).toContainEqual(expect.stringContaining('No content elements found'));
      expect(result.warnings).toContainEqual(expect.stringContaining('No license element found'));
    });

    it('should warn about multiple license elements', () => {
      const multiLicenseXml = `<?xml version="1.0"?>
        <rsl xmlns="https://rslstandard.org/rsl">
          <content url="https://example.com/test"/>
          <license><copyright>License 1</copyright></license>
          <license><copyright>License 2</copyright></license>
        </rsl>`;
      const result = validateRSLXML(multiLicenseXml);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(expect.stringContaining('Multiple license elements found'));
    });

    it('should handle malformed XML', () => {
      const malformedXml = '<?xml version="1.0"?><rsl><unclosed>';
      const result = validateRSLXML(malformedXml);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle assets with no optional properties', () => {
      const minimalAsset: RSLContentAsset = {
        url: 'https://example.com/minimal',
      };

      const xml = generateIndividualRSL(minimalAsset, {});

      expect(xml).toContain('url="https://example.com/minimal"');
      expect(xml).not.toContain('<size>');
      expect(xml).not.toContain('<type>');
      expect(xml).not.toContain('<checksum>');
    });

    it('should handle empty permission arrays', () => {
      const licenseWithEmptyPermissions: RSLLicenseConfiguration = {
        permits: [],
        prohibits: [],
        copyright: 'Test copyright',
      };

      const xml = generateIndividualRSL(testAsset, licenseWithEmptyPermissions);

      expect(xml).toContain('Test copyright');
      expect(xml).not.toContain('<permits>');
      expect(xml).not.toContain('<prohibits>');
    });

    it('should handle payment without amount', () => {
      const licenseWithPaymentNoAmount: RSLLicenseConfiguration = {
        payment: {
          type: 'free',
          attribution: false,
        },
      };

      const xml = generateIndividualRSL(testAsset, licenseWithPaymentNoAmount);

      expect(xml).toContain('type="free"');
      expect(xml).toContain('attribution="false"');
      expect(xml).not.toContain('<amount>');
    });

    it('should handle Unicode characters correctly', () => {
      const unicodeAsset: RSLContentAsset = {
        url: 'https://example.com/文档.pdf',
      };

      const unicodeLicense: RSLLicenseConfiguration = {
        copyright: 'Copyright © 2023 北京公司',
      };

      const xml = generateIndividualRSL(unicodeAsset, unicodeLicense);

      expect(xml).toContain('<?xml version="1.0"?>');
      expect(xml).toContain('北京公司');
      expect(xml).toContain('文档.pdf');
    });

    it('should handle very large asset collections efficiently', () => {
      const largeAssetCollection: RSLContentAsset[] = Array.from({ length: 1000 }, (_, i) => ({
        url: `https://example.com/asset-${i}.txt`,
        size: i * 100,
        type: 'text/plain',
      }));

      const startTime = Date.now();
      const xml = generateCollectionRSL(largeAssetCollection, testLicense);
      const endTime = Date.now();

      expect(xml).toContain('asset-0.txt');
      expect(xml).toContain('asset-999.txt');
      expect(endTime - startTime).toBeLessThan(5000); // Should complete in under 5 seconds
    });
  });
});
