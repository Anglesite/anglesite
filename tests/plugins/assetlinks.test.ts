import * as fs from 'fs';
import * as path from 'path';
import { generateAssetLinks } from '../../plugins/assetlinks';
import addAssetLinks from '../../plugins/assetlinks';
import type { EleventyConfig } from '../types/eleventy-shim';
import type { AnglesiteWebsiteConfiguration } from '../types/website';

// Mock fs.writeFileSync and mkdirSync to prevent actual file operations during tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

describe('assetlinks plugin', () => {
  const mockEleventyConfig = {
    dir: {
      input: 'src',
      output: '_site',
      includes: '_includes',
      layouts: '_includes',
      data: '_data',
    },
    on: jest.fn(),
    addPlugin: jest.fn(),
    addBundle: jest.fn(),
    setFreezeReservedData: jest.fn(),
    addPassthroughCopy: jest.fn(),
    addLayoutAlias: jest.fn(),
    setDataFileBaseName: jest.fn(),
    addJavaScriptFunction: jest.fn(),
    addShortcode: jest.fn(),
    addFilter: jest.fn(),
    addTransform: jest.fn(),
    addTemplateFormats: jest.fn(),
    addExtension: jest.fn(),
    setUseGitIgnore: jest.fn(),
    setUseEditorIgnore: jest.fn(),
    addCollection: jest.fn(),
    addTemplate: jest.fn(),
  } as unknown as EleventyConfig;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('generateAssetLinks', () => {
    it('should return empty string when not enabled', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        assetlinks: {
          enabled: false,
        },
      };

      expect(generateAssetLinks(data)).toBe('');
    });

    it('should return empty string when no website data', () => {
      expect(generateAssetLinks(null as unknown as AnglesiteWebsiteConfiguration)).toBe('');
    });

    it('should return empty string when no assetlinks config', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
      };

      expect(generateAssetLinks(data)).toBe('');
    });

    it('should generate basic Android app link configuration', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        assetlinks: {
          enabled: true,
          statements: [
            {
              relation: ['delegate_permission/common.handle_all_urls'],
              target: {
                namespace: 'android_app',
                package_name: 'com.example.myapp',
                sha256_cert_fingerprints: [
                  '14:6D:E9:83:C5:73:06:50:10:85:8C:00:A4:B3:A9:B1:C6:D1:54:D4:7F:C1:60:0B:78:B5:43:2C:3A:1B:47:51',
                ],
              },
            },
          ],
        },
      };

      const result = generateAssetLinks(data);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual([
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: 'com.example.myapp',
            sha256_cert_fingerprints: [
              '14:6D:E9:83:C5:73:06:50:10:85:8C:00:A4:B3:A9:B1:C6:D1:54:D4:7F:C1:60:0B:78:B5:43:2C:3A:1B:47:51',
            ],
          },
        },
      ]);
    });

    it('should generate multiple statements for different apps', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        assetlinks: {
          enabled: true,
          statements: [
            {
              relation: ['delegate_permission/common.handle_all_urls'],
              target: {
                namespace: 'android_app',
                package_name: 'com.example.app1',
                sha256_cert_fingerprints: [
                  '14:6D:E9:83:C5:73:06:50:10:85:8C:00:A4:B3:A9:B1:C6:D1:54:D4:7F:C1:60:0B:78:B5:43:2C:3A:1B:47:51',
                ],
              },
            },
            {
              relation: ['delegate_permission/common.get_login_creds'],
              target: {
                namespace: 'android_app',
                package_name: 'com.example.app2',
                sha256_cert_fingerprints: [
                  'A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90',
                ],
              },
            },
          ],
        },
      };

      const result = generateAssetLinks(data);
      const parsed = JSON.parse(result);

      expect(parsed).toHaveLength(2);
      expect(parsed[0].target.package_name).toBe('com.example.app1');
      expect(parsed[1].target.package_name).toBe('com.example.app2');
    });

    it('should generate web target configuration', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        assetlinks: {
          enabled: true,
          statements: [
            {
              relation: ['delegate_permission/common.share_location'],
              target: {
                namespace: 'web',
                site: 'https://example.com',
              },
            },
          ],
        },
      };

      const result = generateAssetLinks(data);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual([
        {
          relation: ['delegate_permission/common.share_location'],
          target: {
            namespace: 'web',
            site: 'https://example.com',
          },
        },
      ]);
    });

    it('should support multiple relations in a single statement', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        assetlinks: {
          enabled: true,
          statements: [
            {
              relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
              target: {
                namespace: 'android_app',
                package_name: 'com.example.multiapp',
                sha256_cert_fingerprints: [
                  '14:6D:E9:83:C5:73:06:50:10:85:8C:00:A4:B3:A9:B1:C6:D1:54:D4:7F:C1:60:0B:78:B5:43:2C:3A:1B:47:51',
                ],
              },
            },
          ],
        },
      };

      const result = generateAssetLinks(data);
      const parsed = JSON.parse(result);

      expect(parsed[0].relation).toEqual([
        'delegate_permission/common.handle_all_urls',
        'delegate_permission/common.get_login_creds',
      ]);
    });

    it('should validate and reject invalid package names', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        assetlinks: {
          enabled: true,
          statements: [
            {
              relation: ['delegate_permission/common.handle_all_urls'],
              target: {
                namespace: 'android_app',
                package_name: '123invalid-package-name',
                sha256_cert_fingerprints: [
                  '14:6D:E9:83:C5:73:06:50:10:85:8C:00:A4:B3:A9:B1:C6:D1:54:D4:7F:C1:60:0B:78:B5:43:2C:3A:1B:47:51',
                ],
              },
            },
          ],
        },
      };

      const result = generateAssetLinks(data);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid package name: 123invalid-package-name'));
      expect(result).toBe('');

      consoleSpy.mockRestore();
    });

    it('should validate and reject invalid certificate fingerprints', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        assetlinks: {
          enabled: true,
          statements: [
            {
              relation: ['delegate_permission/common.handle_all_urls'],
              target: {
                namespace: 'android_app',
                package_name: 'com.example.myapp',
                sha256_cert_fingerprints: ['invalid-fingerprint', 'also-invalid'],
              },
            },
          ],
        },
      };

      const result = generateAssetLinks(data);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid certificate fingerprint: invalid-fingerprint')
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid certificate fingerprint: also-invalid'));
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No valid certificate fingerprints for package: com.example.myapp')
      );
      expect(result).toBe('');

      consoleSpy.mockRestore();
    });

    it('should filter out invalid fingerprints but keep valid ones', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        assetlinks: {
          enabled: true,
          statements: [
            {
              relation: ['delegate_permission/common.handle_all_urls'],
              target: {
                namespace: 'android_app',
                package_name: 'com.example.myapp',
                sha256_cert_fingerprints: [
                  'invalid-fingerprint',
                  '14:6D:E9:83:C5:73:06:50:10:85:8C:00:A4:B3:A9:B1:C6:D1:54:D4:7F:C1:60:0B:78:B5:43:2C:3A:1B:47:51',
                ],
              },
            },
          ],
        },
      };

      const result = generateAssetLinks(data);
      const parsed = JSON.parse(result);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid certificate fingerprint: invalid-fingerprint')
      );
      expect(parsed[0].target.sha256_cert_fingerprints).toEqual([
        '14:6D:E9:83:C5:73:06:50:10:85:8C:00:A4:B3:A9:B1:C6:D1:54:D4:7F:C1:60:0B:78:B5:43:2C:3A:1B:47:51',
      ]);

      consoleSpy.mockRestore();
    });

    it('should validate and reject invalid web site URLs', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        assetlinks: {
          enabled: true,
          statements: [
            {
              relation: ['delegate_permission/common.share_location'],
              target: {
                namespace: 'web',
                site: 'http://insecure-site.com', // HTTP not allowed
              },
            },
          ],
        },
      };

      const result = generateAssetLinks(data);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid site URL (must use HTTPS): http://insecure-site.com')
      );
      expect(result).toBe('');

      consoleSpy.mockRestore();
    });

    it('should validate and reject invalid relations', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        assetlinks: {
          enabled: true,
          statements: [
            {
              relation: ['invalid_relation'],
              target: {
                namespace: 'android_app',
                package_name: 'com.example.myapp',
                sha256_cert_fingerprints: [
                  '14:6D:E9:83:C5:73:06:50:10:85:8C:00:A4:B3:A9:B1:C6:D1:54:D4:7F:C1:60:0B:78:B5:43:2C:3A:1B:47:51',
                ],
              },
            },
          ],
        },
      };

      const result = generateAssetLinks(data);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid relations: invalid_relation'));
      expect(result).toBe('');

      consoleSpy.mockRestore();
    });

    it('should return empty string when no valid statements', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        assetlinks: {
          enabled: true,
          // No statements or all invalid
        },
      };

      const result = generateAssetLinks(data);
      expect(result).toBe('');
    });
  });

  describe('addAssetLinks plugin', () => {
    it('should register an eleventy.after event listener', () => {
      addAssetLinks(mockEleventyConfig);
      expect(mockEleventyConfig.on).toHaveBeenCalledTimes(1);
      expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
    });

    it('should write .well-known/assetlinks.json file', async () => {
      addAssetLinks(mockEleventyConfig);

      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                assetlinks: {
                  enabled: true,
                  statements: [
                    {
                      relation: ['delegate_permission/common.handle_all_urls'],
                      target: {
                        namespace: 'android_app',
                        package_name: 'com.example.myapp',
                        sha256_cert_fingerprints: [
                          '14:6D:E9:83:C5:73:06:50:10:85:8C:00:A4:B3:A9:B1:C6:D1:54:D4:7F:C1:60:0B:78:B5:43:2C:3A:1B:47:51',
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      });

      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('_site', '.well-known'), { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join('_site', '.well-known', 'assetlinks.json'),
        expect.stringContaining('com.example.myapp')
      );
    });

    it('should not create file when not enabled', async () => {
      addAssetLinks(mockEleventyConfig);

      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                assetlinks: {
                  enabled: false,
                },
              },
            },
          },
        ],
      });

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should not create file when no assetlinks config', async () => {
      addAssetLinks(mockEleventyConfig);

      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
              },
            },
          },
        ],
      });

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should handle file system errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      (fs.writeFileSync as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Permission denied');
      });

      addAssetLinks(mockEleventyConfig);
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                assetlinks: {
                  enabled: true,
                  statements: [
                    {
                      relation: ['delegate_permission/common.handle_all_urls'],
                      target: {
                        namespace: 'android_app',
                        package_name: 'com.example.myapp',
                        sha256_cert_fingerprints: [
                          '14:6D:E9:83:C5:73:06:50:10:85:8C:00:A4:B3:A9:B1:C6:D1:54:D4:7F:C1:60:0B:78:B5:43:2C:3A:1B:47:51',
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Eleventy] Failed to write .well-known/assetlinks.json: Permission denied')
      );

      consoleSpy.mockRestore();
    });

    it('should handle empty results gracefully', async () => {
      addAssetLinks(mockEleventyConfig);

      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [],
      });

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should handle missing website configuration gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const fsReadFileSpy = jest.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(new Error('File not found'));

      addAssetLinks(mockEleventyConfig);
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            // No data property - will try to read from filesystem
          },
        ],
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Eleventy] Asset Links plugin: Could not read website.json from _data directory'
      );
      expect(fs.writeFileSync).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
      fsReadFileSpy.mockRestore();
    });

    it('should create .well-known directory if it does not exist', async () => {
      addAssetLinks(mockEleventyConfig);

      const callback = mockEleventyConfig.on.mock.calls[0][1];

      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                assetlinks: {
                  enabled: true,
                  statements: [
                    {
                      relation: ['delegate_permission/common.handle_all_urls'],
                      target: {
                        namespace: 'android_app',
                        package_name: 'com.example.myapp',
                        sha256_cert_fingerprints: [
                          '14:6D:E9:83:C5:73:06:50:10:85:8C:00:A4:B3:A9:B1:C6:D1:54:D4:7F:C1:60:0B:78:B5:43:2C:3A:1B:47:51',
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      });

      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('_site', '.well-known'), { recursive: true });
    });
  });
});
