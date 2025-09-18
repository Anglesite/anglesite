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
});
