/**
 * Security hardening verification tests
 */

import { validateModuleImport, safeImport } from '../../src/main/security/import-validator';

describe('Security Hardening', () => {
  describe('Import Validation', () => {
    it('should allow whitelisted modules', () => {
      expect(() => validateModuleImport('./ui/multi-window-manager')).not.toThrow();
      expect(() => validateModuleImport('fs')).not.toThrow();
      expect(() => validateModuleImport('./utils/website-manager')).not.toThrow();
    });

    it('should prevent directory traversal', () => {
      expect(() => validateModuleImport('../../../etc/passwd')).toThrow('Directory traversal detected');
      expect(() => validateModuleImport('~/malicious')).toThrow('Directory traversal detected');
    });

    it('should prevent absolute paths', () => {
      expect(() => validateModuleImport('/etc/passwd')).toThrow('Absolute path not allowed');
      expect(() => validateModuleImport('/usr/bin/malicious')).toThrow('Absolute path not allowed');
    });

    it('should prevent non-whitelisted modules', () => {
      expect(() => validateModuleImport('dangerous-module')).toThrow('Module not whitelisted');
      expect(() => validateModuleImport('./malicious/script')).toThrow('Module not whitelisted');
    });

    it('should handle safe import wrapper', async () => {
      // This should work for whitelisted modules
      await expect(safeImport('fs')).resolves.toBeDefined();

      // This should fail for non-whitelisted modules
      await expect(safeImport('non-existent-module')).rejects.toThrow('Module not whitelisted');
    });
  });

  describe('IPC Channel Validation', () => {
    it('should detect script injection patterns', () => {
      const dangerousChannels = [
        '<script>alert("xss")</script>',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
      ];

      dangerousChannels.forEach((channel) => {
        const pattern = /<script|javascript:|data:|vbscript:/i;
        expect(pattern.test(channel)).toBe(true);
      });
    });

    it('should allow safe channel names', () => {
      const safeChannels = ['get-website-files', 'save-file-content', 'load-website-preview'];

      safeChannels.forEach((channel) => {
        const pattern = /<script|javascript:|data:|vbscript:/i;
        expect(pattern.test(channel)).toBe(false);
      });
    });
  });

  describe('IPC Input Validation', () => {
    let validateWebsiteName: (name: unknown) => string;
    let validateFilePath: (path: unknown) => string;
    let validatePageName: (name: unknown) => string;
    let validateFileContent: (content: unknown) => string;
    let validateUrl: (url: unknown) => string;
    let IPCValidationError: typeof import('../../src/main/security/ipc-validation').IPCValidationError;

    beforeAll(async () => {
      const validationModule = await import('../../src/main/security/ipc-validation');
      validateWebsiteName = validationModule.validateWebsiteName;
      validateFilePath = validationModule.validateFilePath;
      validatePageName = validationModule.validatePageName;
      validateFileContent = validationModule.validateFileContent;
      validateUrl = validationModule.validateUrl;
      IPCValidationError = validationModule.IPCValidationError;
    });

    describe('Website Name Validation', () => {
      it('should accept valid website names', () => {
        const validNames = ['my-website', 'test_site', 'site123', 'a.b-c'];
        validNames.forEach((name) => {
          expect(() => validateWebsiteName(name)).not.toThrow();
        });
      });

      it('should reject invalid website names', () => {
        const invalidNames = [
          '', // empty
          'a'.repeat(101), // too long
          'site with spaces',
          'site/with/slashes',
          'site<script>',
          '../../../etc/passwd',
          null,
          123,
          {},
        ];

        invalidNames.forEach((name) => {
          expect(() => validateWebsiteName(name)).toThrow(IPCValidationError);
        });
      });
    });

    describe('File Path Validation', () => {
      it('should accept valid relative paths', () => {
        const validPaths = ['src/index.md', 'assets/image.png', 'docs/readme.txt'];
        validPaths.forEach((path) => {
          expect(() => validateFilePath(path)).not.toThrow();
        });
      });

      it('should reject dangerous file paths', () => {
        const dangerousPaths = [
          '/etc/passwd', // absolute path
          'C:\\Windows\\System32', // absolute Windows path
          '../../../etc/passwd', // path traversal
          '~/malicious', // home directory
          'file<script>', // script injection
          'file|rm -rf /', // command injection
          '', // empty path
          null,
          123,
        ];

        dangerousPaths.forEach((path) => {
          expect(() => validateFilePath(path)).toThrow(IPCValidationError);
        });
      });
    });

    describe('Page Name Validation', () => {
      it('should accept valid page names', () => {
        const validNames = ['index', 'about-us', 'contact_form', 'page.html'];
        validNames.forEach((name) => {
          expect(() => validatePageName(name)).not.toThrow();
        });
      });

      it('should reject invalid page names', () => {
        const invalidNames = [
          'page/with/slashes',
          'page\\with\\backslashes',
          'page with spaces',
          '<script>alert(1)</script>',
          '../parent-dir',
          '',
          'p'.repeat(101), // too long
          null,
          {},
        ];

        invalidNames.forEach((name) => {
          expect(() => validatePageName(name)).toThrow(IPCValidationError);
        });
      });
    });

    describe('File Content Validation', () => {
      it('should accept valid file content', () => {
        const validContent = [
          'Hello World',
          '', // empty content is allowed
          'Multi\nline\ncontent',
          'Content with special chars: !@#$%^&*()',
        ];

        validContent.forEach((content) => {
          expect(() => validateFileContent(content)).not.toThrow();
        });
      });

      it('should reject oversized content', () => {
        const oversizedContent = 'x'.repeat(11 * 1024 * 1024); // 11MB
        expect(() => validateFileContent(oversizedContent)).toThrow(IPCValidationError);
      });

      it('should reject non-string content', () => {
        [null, undefined, 123, {}, []].forEach((content) => {
          expect(() => validateFileContent(content)).toThrow(IPCValidationError);
        });
      });
    });

    describe('URL Validation', () => {
      it('should accept valid URLs', () => {
        const validUrls = ['https://example.com', 'http://localhost:3000', 'file:///path/to/file.html'];

        validUrls.forEach((url) => {
          expect(() => validateUrl(url)).not.toThrow();
        });
      });

      it('should reject dangerous URLs', () => {
        const dangerousUrls = [
          'javascript:alert(1)',
          'data:text/html,<script>alert(1)</script>',
          'ftp://malicious.site',
          'invalid-url',
          '',
          null,
          {},
        ];

        dangerousUrls.forEach((url) => {
          expect(() => validateUrl(url)).toThrow(IPCValidationError);
        });
      });
    });

    describe('Error Handling', () => {
      it('should provide informative error messages', () => {
        try {
          validateWebsiteName('');
        } catch (error) {
          expect(error).toBeInstanceOf(IPCValidationError);
          const validationError = error as InstanceType<typeof IPCValidationError>;
          expect(validationError.message).toContain('websiteName');
          expect(validationError.message).toContain('cannot be empty');
        }
      });

      it('should include field names in errors', () => {
        try {
          validateFilePath(123);
        } catch (error) {
          expect(error).toBeInstanceOf(IPCValidationError);
          if (error instanceof IPCValidationError) {
            expect(error.field).toBe('filePath');
          }
        }
      });
    });

    describe('Performance and Limits', () => {
      it('should handle validation within reasonable time', () => {
        const start = Date.now();
        for (let i = 0; i < 1000; i++) {
          validateWebsiteName('test-website');
        }
        const duration = Date.now() - start;
        expect(duration).toBeLessThan(100); // Should complete in under 100ms
      });

      it('should enforce length limits', () => {
        const longString = 'x'.repeat(1001);
        expect(() => validateWebsiteName(longString)).toThrow(IPCValidationError);
      });
    });
  });
});
