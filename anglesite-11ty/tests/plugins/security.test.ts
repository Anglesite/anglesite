import * as fs from 'fs';
import * as path from 'path';
import { generateSecurityTxt } from '../../plugins/security';
import addSecurityTxt from '../../plugins/security';
import type { EleventyConfig } from '../../types/eleventy-shim';
import type { AnglesiteWebsiteConfiguration } from '../../types/website';

// Mock fs.writeFileSync and mkdirSync to prevent actual file operations during tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

describe('security plugin', () => {
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

  describe('generateSecurityTxt', () => {
    it('should return empty string when no website data', () => {
      expect(generateSecurityTxt(null as unknown as AnglesiteWebsiteConfiguration)).toBe('');
    });

    it('should return empty string when website is undefined', () => {
      expect(generateSecurityTxt(undefined as unknown as AnglesiteWebsiteConfiguration)).toBe('');
    });

    it('should return empty string when no security config', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
      };

      const result = generateSecurityTxt(data);
      expect(result).toBe('');
    });

    it('should generate basic security.txt with single contact', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        security: {
          contact: 'mailto:security@example.com',
        },
      };

      const result = generateSecurityTxt(data);
      expect(result).toBe('Contact: mailto:security@example.com\n');
    });

    it('should generate security.txt with multiple contacts', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        security: {
          contact: ['mailto:security@example.com', 'https://example.com/security/contact'],
        },
      };

      const result = generateSecurityTxt(data);
      expect(result).toBe('Contact: mailto:security@example.com\nContact: https://example.com/security/contact\n');
    });

    it('should generate security.txt with expires field (string)', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        security: {
          contact: 'mailto:security@example.com',
          expires: '2025-12-31T23:59:59.000Z',
        },
      };

      const result = generateSecurityTxt(data);
      expect(result).toBe('Contact: mailto:security@example.com\nExpires: 2025-12-31T23:59:59.000Z\n');
    });

    it('should generate security.txt with expires field (numeric)', () => {
      const mockDate = new Date('2024-01-01T00:00:00.000Z');
      jest.spyOn(Date, 'now').mockReturnValue(mockDate.getTime());

      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        security: {
          contact: 'mailto:security@example.com',
          expires: 31536000, // 1 year in seconds
        },
      };

      const result = generateSecurityTxt(data);
      expect(result).toBe('Contact: mailto:security@example.com\nExpires: 2024-12-31T00:00:00.000Z\n');

      (Date.now as jest.Mock).mockRestore();
    });

    it('should generate security.txt with single encryption key', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        security: {
          contact: 'mailto:security@example.com',
          encryption: 'https://example.com/.well-known/pgp-key.txt',
        },
      };

      const result = generateSecurityTxt(data);
      expect(result).toBe(
        'Contact: mailto:security@example.com\nEncryption: https://example.com/.well-known/pgp-key.txt\n'
      );
    });

    it('should generate security.txt with multiple encryption keys', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        security: {
          contact: 'mailto:security@example.com',
          encryption: ['https://example.com/.well-known/pgp-key.txt', 'https://example.com/security/pgp-backup.txt'],
        },
      };

      const result = generateSecurityTxt(data);
      expect(result).toBe(
        'Contact: mailto:security@example.com\n' +
          'Encryption: https://example.com/.well-known/pgp-key.txt\n' +
          'Encryption: https://example.com/security/pgp-backup.txt\n'
      );
    });

    it('should generate security.txt with acknowledgments', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        security: {
          contact: 'mailto:security@example.com',
          acknowledgments: 'https://example.com/security/acknowledgments',
        },
      };

      const result = generateSecurityTxt(data);
      expect(result).toBe(
        'Contact: mailto:security@example.com\n' + 'Acknowledgments: https://example.com/security/acknowledgments\n'
      );
    });

    it('should generate security.txt with single preferred language', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        security: {
          contact: 'mailto:security@example.com',
          preferred_languages: 'en',
        },
      };

      const result = generateSecurityTxt(data);
      expect(result).toBe('Contact: mailto:security@example.com\n' + 'Preferred-Languages: en\n');
    });

    it('should generate security.txt with multiple preferred languages', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        security: {
          contact: 'mailto:security@example.com',
          preferred_languages: ['en', 'es', 'fr'],
        },
      };

      const result = generateSecurityTxt(data);
      expect(result).toBe('Contact: mailto:security@example.com\n' + 'Preferred-Languages: en, es, fr\n');
    });

    it('should generate security.txt with canonical URL', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        security: {
          contact: 'mailto:security@example.com',
          canonical: 'https://example.com/.well-known/security.txt',
        },
      };

      const result = generateSecurityTxt(data);
      expect(result).toBe(
        'Contact: mailto:security@example.com\n' + 'Canonical: https://example.com/.well-known/security.txt\n'
      );
    });

    it('should generate security.txt with policy URL', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        security: {
          contact: 'mailto:security@example.com',
          policy: 'https://example.com/security/policy',
        },
      };

      const result = generateSecurityTxt(data);
      expect(result).toBe('Contact: mailto:security@example.com\n' + 'Policy: https://example.com/security/policy\n');
    });

    it('should generate security.txt with hiring URL', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        security: {
          contact: 'mailto:security@example.com',
          hiring: 'https://example.com/security/jobs',
        },
      };

      const result = generateSecurityTxt(data);
      expect(result).toBe('Contact: mailto:security@example.com\n' + 'Hiring: https://example.com/security/jobs\n');
    });

    it('should generate complete security.txt with all fields', () => {
      const mockDate = new Date('2024-01-01T00:00:00.000Z');
      jest.spyOn(Date, 'now').mockReturnValue(mockDate.getTime());

      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        security: {
          contact: ['mailto:security@example.com', 'https://example.com/security/contact'],
          expires: 31536000, // 1 year in seconds
          encryption: ['https://example.com/.well-known/pgp-key.txt', 'https://example.com/security/pgp-backup.txt'],
          acknowledgments: 'https://example.com/security/acknowledgments',
          preferred_languages: ['en', 'es'],
          canonical: 'https://example.com/.well-known/security.txt',
          policy: 'https://example.com/security/policy',
          hiring: 'https://example.com/security/jobs',
        },
      };

      const result = generateSecurityTxt(data);
      expect(result).toBe(
        'Contact: mailto:security@example.com\n' +
          'Contact: https://example.com/security/contact\n' +
          'Expires: 2024-12-31T00:00:00.000Z\n' +
          'Encryption: https://example.com/.well-known/pgp-key.txt\n' +
          'Encryption: https://example.com/security/pgp-backup.txt\n' +
          'Acknowledgments: https://example.com/security/acknowledgments\n' +
          'Preferred-Languages: en, es\n' +
          'Canonical: https://example.com/.well-known/security.txt\n' +
          'Policy: https://example.com/security/policy\n' +
          'Hiring: https://example.com/security/jobs\n'
      );

      (Date.now as jest.Mock).mockRestore();
    });

    it('should handle empty arrays gracefully', () => {
      const data: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        security: {
          contact: 'mailto:security@example.com',
          encryption: [],
          preferred_languages: [],
        },
      };

      const result = generateSecurityTxt(data);
      expect(result).toBe('Contact: mailto:security@example.com\n');
    });
  });

  describe('addSecurityTxt plugin', () => {
    it('should register an eleventy.after event listener', () => {
      addSecurityTxt(mockEleventyConfig);
      expect(mockEleventyConfig.on).toHaveBeenCalledTimes(1);
      expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
    });

    it('should write .well-known/security.txt using data from the cascade', async () => {
      const mockDate = new Date('2024-01-01T00:00:00.000Z');
      jest.spyOn(Date, 'now').mockReturnValue(mockDate.getTime());

      addSecurityTxt(mockEleventyConfig);

      // Get the callback that was registered
      const callback = mockEleventyConfig.on.mock.calls[0][1];

      // Simulate eleventy.after event with data from the cascade
      await callback({
        dir: { output: '_site' },
        results: [
          {
            inputPath: 'index.html',
            data: {
              website: {
                title: 'Test Site',
                language: 'en',
                security: {
                  contact: 'mailto:security@example.com',
                  expires: 31536000, // 1 year in seconds
                },
              },
            },
          },
        ],
      });

      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('_site', '.well-known'), { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join('_site', '.well-known', 'security.txt'),
        'Contact: mailto:security@example.com\nExpires: 2024-12-31T00:00:00.000Z\n'
      );

      (Date.now as jest.Mock).mockRestore();
    });

    it('should not create file when no security config', async () => {
      addSecurityTxt(mockEleventyConfig);

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

      addSecurityTxt(mockEleventyConfig);
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
                security: {
                  contact: 'mailto:security@example.com',
                },
              },
            },
          },
        ],
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Eleventy] Failed to write .well-known/security.txt: Permission denied')
      );

      consoleSpy.mockRestore();
    });

    it('should handle empty results gracefully', async () => {
      addSecurityTxt(mockEleventyConfig);

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

      addSecurityTxt(mockEleventyConfig);
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
        '[Eleventy] Security plugin: Could not read website.json from _data directory'
      );
      expect(fs.writeFileSync).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
      fsReadFileSpy.mockRestore();
    });

    it('should create .well-known directory if it does not exist', async () => {
      addSecurityTxt(mockEleventyConfig);

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
                security: {
                  contact: 'mailto:security@example.com',
                },
              },
            },
          },
        ],
      });

      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('_site', '.well-known'), { recursive: true });
    });
  });

  describe('URL conversion functionality', () => {
    it('should convert relative paths to full URLs', () => {
      const website: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        url: 'https://example.com',
        language: 'en',
        security: {
          contact: ['mailto:security@example.com', '/security/contact'],
          expires: 31536000,
          encryption: '/.well-known/pgp-key.txt',
          acknowledgments: '/security/acknowledgments',
          canonical: '/.well-known/security.txt',
          policy: '/security/policy',
          hiring: '/security/jobs',
        },
      };

      const result = generateSecurityTxt(website);

      expect(result).toContain('Contact: mailto:security@example.com');
      expect(result).toContain('Contact: https://example.com/security/contact');
      expect(result).toContain('Encryption: https://example.com/.well-known/pgp-key.txt');
      expect(result).toContain('Acknowledgments: https://example.com/security/acknowledgments');
      expect(result).toContain('Canonical: https://example.com/.well-known/security.txt');
      expect(result).toContain('Policy: https://example.com/security/policy');
      expect(result).toContain('Hiring: https://example.com/security/jobs');
    });

    it('should preserve full URLs as-is', () => {
      const website: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        url: 'https://example.com',
        language: 'en',
        security: {
          contact: ['mailto:security@example.com', 'https://different.com/contact'],
          encryption: 'https://keys.example.com/pgp-key.txt',
          acknowledgments: 'https://security.example.com/thanks',
        },
      };

      const result = generateSecurityTxt(website);

      expect(result).toContain('Contact: mailto:security@example.com');
      expect(result).toContain('Contact: https://different.com/contact');
      expect(result).toContain('Encryption: https://keys.example.com/pgp-key.txt');
      expect(result).toContain('Acknowledgments: https://security.example.com/thanks');
    });

    it('should handle missing base URL gracefully', () => {
      const website: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        security: {
          contact: ['mailto:security@example.com', '/security/contact'],
          encryption: '/.well-known/pgp-key.txt',
        },
      };

      const result = generateSecurityTxt(website);

      expect(result).toContain('Contact: mailto:security@example.com');
      expect(result).toContain('Contact: /security/contact'); // Should remain as relative path
      expect(result).toContain('Encryption: /.well-known/pgp-key.txt'); // Should remain as relative path
    });

    it('should handle base URL with trailing slash', () => {
      const website: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        url: 'https://example.com/',
        language: 'en',
        security: {
          contact: '/security/contact',
          encryption: '/.well-known/pgp-key.txt',
        },
      };

      const result = generateSecurityTxt(website);

      expect(result).toContain('Contact: https://example.com/security/contact');
      expect(result).toContain('Encryption: https://example.com/.well-known/pgp-key.txt');
    });

    it('should handle array of encryption URLs with mixed types', () => {
      const website: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        url: 'https://example.com',
        language: 'en',
        security: {
          contact: 'mailto:security@example.com',
          encryption: ['/.well-known/pgp-key.txt', 'https://keys.example.com/alternate-key.txt', '/keys/backup.txt'],
        },
      };

      const result = generateSecurityTxt(website);

      expect(result).toContain('Encryption: https://example.com/.well-known/pgp-key.txt');
      expect(result).toContain('Encryption: https://keys.example.com/alternate-key.txt');
      expect(result).toContain('Encryption: https://example.com/keys/backup.txt');
    });

    it('should preserve tel: and other special schemes', () => {
      const website: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        url: 'https://example.com',
        language: 'en',
        security: {
          contact: ['mailto:security@example.com', 'tel:+1-555-0123'],
        },
      };

      const result = generateSecurityTxt(website);

      expect(result).toContain('Contact: mailto:security@example.com');
      expect(result).toContain('Contact: tel:+1-555-0123');
    });
  });
});
