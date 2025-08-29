/**
 * @file Tests for Certificate Authority and SSL certificate management
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, execFileSync } from 'child_process';
import {
  generateCertificate,
  isCAInstalledInSystem,
  installCAInSystem,
  getCAPath,
  loadCertificates,
} from '../../app/certificates';

// Mock dependencies
jest.mock('mkcert');
jest.mock('fs');
jest.mock('path');
jest.mock('os');
jest.mock('child_process');

const mockFs = fs as jest.Mocked<typeof fs>;
// Mock fs.promises methods
mockFs.promises = {
  stat: jest.fn(),
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const mockPath = path as jest.Mocked<typeof path>;
const mockOs = os as jest.Mocked<typeof os>;
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>;

// Mock mkcert
jest.mock('mkcert', () => ({
  createCA: jest.fn(),
  createCert: jest.fn(),
}));

// Import after mocking
import { createCA, createCert } from 'mkcert';
const mockCreateCA = createCA as jest.MockedFunction<typeof createCA>;
const mockCreateCert = createCert as jest.MockedFunction<typeof createCert>;

describe('Certificates', () => {
  let consoleSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Default path mocking
    mockPath.join.mockImplementation((...args) => args.join('/'));
    mockOs.homedir.mockReturnValue('/Users/testuser');
    mockOs.tmpdir.mockReturnValue('/tmp');

    // Default fs.promises.stat mock (file exists by default)
    (mockFs.promises.stat as jest.Mock).mockResolvedValue({ isFile: () => true });

    // Default process platform
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    });

    // Default environment
    process.env.APPDATA = 'C:\\Users\\testuser\\AppData\\Roaming';
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();

    // Reset platform
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    });
  });

  describe('generateCertificate', () => {
    const mockCA = {
      cert: '-----BEGIN CERTIFICATE-----\nMOCK_CA_CERT\n-----END CERTIFICATE-----',
      key: '-----BEGIN PRIVATE KEY-----\nMOCK_CA_KEY\n-----END PRIVATE KEY-----',
    };

    const mockCert = {
      cert: '-----BEGIN CERTIFICATE-----\nMOCK_CERT\n-----END CERTIFICATE-----',
      key: '-----BEGIN PRIVATE KEY-----\nMOCK_KEY\n-----END PRIVATE KEY-----',
    };

    beforeEach(() => {
      mockCreateCA.mockResolvedValue(mockCA);
      mockCreateCert.mockResolvedValue(mockCert);
    });

    it('should generate certificate when CA does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation();
      mockFs.writeFileSync.mockImplementation();
      // Mock fs.promises.stat to reject (file doesn't exist)
      (mockFs.promises.stat as jest.Mock).mockRejectedValue(new Error('File not found'));

      const result = await generateCertificate(['test.test']);

      expect(mockCreateCA).toHaveBeenCalledWith({
        organization: 'Anglesite Development',
        countryCode: 'US',
        state: 'Development',
        locality: 'Local',
        validity: 825,
      });
      expect(mockFs.mkdirSync).toHaveBeenCalled();
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(2); // CA cert and key
      expect(mockCreateCert).toHaveBeenCalledWith({
        ca: { key: mockCA.key, cert: mockCA.cert },
        domains: ['test.test', 'localhost', '127.0.0.1', '::1'],
        validity: 365,
      });
      expect(result).toEqual(mockCert);
    });

    it('should use existing CA when it exists', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValueOnce(mockCA.cert).mockReturnValueOnce(mockCA.key);

      const result = await generateCertificate(['existing.test']);

      expect(mockFs.readFileSync).toHaveBeenCalledTimes(2);
      expect(mockCreateCA).not.toHaveBeenCalled();
      expect(mockCreateCert).toHaveBeenCalledWith({
        ca: { key: mockCA.key, cert: mockCA.cert },
        domains: ['existing.test', 'localhost', '127.0.0.1', '::1'],
        validity: 365,
      });
      expect(result).toEqual(mockCert);
    });

    it('should use cache for duplicate domain requests', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValueOnce(mockCA.cert).mockReturnValueOnce(mockCA.key);

      const domains = ['cached.test'];

      // First call
      const result1 = await generateCertificate(domains);

      // Second call with same domains
      const result2 = await generateCertificate(domains);

      expect(mockCreateCert).toHaveBeenCalledTimes(1); // Only called once due to caching
      expect(result1).toEqual(result2);
      expect(result1).toEqual(mockCert);
    });

    it('should sort domains for consistent cache keys', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValueOnce(mockCA.cert).mockReturnValueOnce(mockCA.key);

      // First call with domains in one order
      await generateCertificate(['b.test', 'a.test']);

      // Second call with same domains in different order
      await generateCertificate(['a.test', 'b.test']);

      expect(mockCreateCert).toHaveBeenCalledTimes(1); // Should use cache
    });

    it('should include localhost variants automatically', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValueOnce(mockCA.cert).mockReturnValueOnce(mockCA.key);

      await generateCertificate(['custom.test']);

      expect(mockCreateCert).toHaveBeenCalledWith({
        ca: { key: mockCA.key, cert: mockCA.cert },
        domains: ['custom.test', 'localhost', '127.0.0.1', '::1'],
        validity: 365,
      });
    });

    it('should handle certificate generation errors', async () => {
      const error = new Error('Certificate generation failed');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValueOnce(mockCA.cert).mockReturnValueOnce(mockCA.key);
      mockCreateCert.mockRejectedValue(error);

      await expect(generateCertificate(['error.test'])).rejects.toThrow(
        'Certificate generation failed: Certificate generation failed'
      );
    });

    it('should handle non-Error objects in catch block', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValueOnce(mockCA.cert).mockReturnValueOnce(mockCA.key);
      mockCreateCert.mockRejectedValue('String error');

      await expect(generateCertificate(['error.test'])).rejects.toThrow('Certificate generation failed: String error');
    });

    it('should work on Windows platform', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation();
      mockFs.writeFileSync.mockImplementation();

      await generateCertificate(['windows.test']);

      expect(mockPath.join).toHaveBeenCalledWith('C:\\Users\\testuser\\AppData\\Roaming', 'Anglesite');
    });

    it('should work on Windows platform with undefined APPDATA', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const originalAppData = process.env.APPDATA;
      delete process.env.APPDATA;

      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation();
      mockFs.writeFileSync.mockImplementation();

      await generateCertificate(['windows-no-appdata.test']);

      expect(mockPath.join).toHaveBeenCalledWith('', 'Anglesite');

      // Restore APPDATA
      process.env.APPDATA = originalAppData;
    });

    it('should work on Linux platform', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation();
      mockFs.writeFileSync.mockImplementation();

      await generateCertificate(['linux.test']);

      expect(mockPath.join).toHaveBeenCalledWith('/Users/testuser', '.config', 'anglesite');
    });
  });

  describe('isCAInstalledInSystem', () => {
    it('should return true when CA is installed and trusted', async () => {
      // Mock path exists and execFileSync succeeds for verify-cert
      mockFs.existsSync.mockReturnValue(true);
      mockOs.homedir.mockReturnValue('/Users/test');
      mockPath.join.mockReturnValue('/Users/test/Library/Application Support/Anglesite/ca/ca.crt');
      mockExecFileSync.mockReturnValue(Buffer.from('Certificate verified'));

      const result = await isCAInstalledInSystem();

      expect(result).toBe(true);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'security',
        ['verify-cert', '-c', '/Users/test/Library/Application Support/Anglesite/ca/ca.crt'],
        { stdio: 'pipe' }
      );
    });

    it('should return false when CA is not found or not trusted', async () => {
      // Mock path doesn't exist, fallback fails too
      mockFs.existsSync.mockReturnValue(false);
      (mockFs.promises.stat as jest.Mock).mockRejectedValue(new Error('File not found'));
      mockExecFileSync.mockImplementation(() => {
        throw new Error('Certificate not found');
      });

      const result = await isCAInstalledInSystem();

      expect(result).toBe(false);
    });

    it('should return false when execFileSync throws any error', async () => {
      // Mock path exists but execFileSync fails
      mockFs.existsSync.mockReturnValue(true);
      mockOs.homedir.mockReturnValue('/Users/test');
      mockPath.join.mockReturnValue('/Users/test/Library/Application Support/Anglesite/ca/ca.crt');
      mockExecFileSync.mockImplementation(() => {
        throw new Error('Security command failed');
      });

      const result = await isCAInstalledInSystem();

      expect(result).toBe(false);
    });
  });

  describe('installCAInSystem', () => {
    const mockCA = {
      cert: '-----BEGIN CERTIFICATE-----\nMOCK_CA_CERT\n-----END CERTIFICATE-----',
      key: '-----BEGIN PRIVATE KEY-----\nMOCK_CA_KEY\n-----END PRIVATE KEY-----',
    };

    beforeEach(() => {
      mockCreateCA.mockResolvedValue(mockCA);
    });

    it('should install CA successfully when it does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation();
      mockFs.writeFileSync.mockImplementation();
      mockFs.unlinkSync.mockImplementation();
      mockExecFileSync.mockReturnValue(Buffer.from('Success'));

      const result = await installCAInSystem();

      expect(result).toBe(true);
      expect(mockFs.writeFileSync).toHaveBeenCalledWith('/tmp/anglesite-ca.crt', mockCA.cert);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'security',
        ['add-trusted-cert', '-d', '-r', 'trustRoot', '/tmp/anglesite-ca.crt'],
        {
          stdio: 'pipe',
        }
      );
      expect(mockFs.unlinkSync).toHaveBeenCalledWith('/tmp/anglesite-ca.crt');
    });

    it('should install CA successfully when it already exists', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValueOnce(mockCA.cert).mockReturnValueOnce(mockCA.key);
      mockFs.writeFileSync.mockImplementation();
      mockFs.unlinkSync.mockImplementation();
      mockExecSync.mockReturnValue(Buffer.from('Success'));

      const result = await installCAInSystem();

      expect(result).toBe(true);
      expect(mockCreateCA).not.toHaveBeenCalled(); // Should use existing CA
    });

    it('should return false and log error when installation fails', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValueOnce(mockCA.cert).mockReturnValueOnce(mockCA.key);
      mockFs.writeFileSync.mockImplementation();
      mockExecFileSync.mockImplementation(() => {
        throw new Error('Installation failed');
      });

      const result = await installCAInSystem();

      expect(result).toBe(false);
    });

    it('should return false when CA creation fails', async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockCreateCA.mockRejectedValue(new Error('CA creation failed'));

      const result = await installCAInSystem();

      expect(result).toBe(false);
    });
  });

  describe('getCAPath', () => {
    it('should return correct path for macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const result = getCAPath();

      expect(mockPath.join).toHaveBeenCalledWith('/Users/testuser', 'Library', 'Application Support', 'Anglesite');
      expect(mockPath.join).toHaveBeenLastCalledWith(
        '/Users/testuser/Library/Application Support/Anglesite',
        'ca',
        'ca.crt'
      );
    });

    it('should return correct path for Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const result = getCAPath();

      expect(mockPath.join).toHaveBeenCalledWith('C:\\Users\\testuser\\AppData\\Roaming', 'Anglesite');
    });

    it('should return correct path for Linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const result = getCAPath();

      expect(mockPath.join).toHaveBeenCalledWith('/Users/testuser', '.config', 'anglesite');
    });

    it('should handle missing APPDATA on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const originalAppData = process.env.APPDATA;
      delete process.env.APPDATA;

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const result = getCAPath();

      expect(mockPath.join).toHaveBeenCalledWith('', 'Anglesite');

      // Restore APPDATA
      process.env.APPDATA = originalAppData;
    });
  });

  describe('loadCertificates', () => {
    const mockCert = {
      cert: '-----BEGIN CERTIFICATE-----\nMOCK_CERT\n-----END CERTIFICATE-----',
      key: '-----BEGIN PRIVATE KEY-----\nMOCK_KEY\n-----END PRIVATE KEY-----',
    };

    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('mock cert content');
      mockCreateCert.mockResolvedValue(mockCert);
    });

    it('should load certificates with default domains', async () => {
      const result = await loadCertificates();

      expect(mockCreateCert).toHaveBeenCalledWith({
        ca: expect.any(Object),
        domains: ['anglesite.test', 'localhost', '127.0.0.1', '::1'],
        validity: 365,
      });
      expect(result).toEqual(mockCert);
    });

    it('should load certificates with custom domains', async () => {
      const customDomains = ['custom1.test', 'custom2.test'];

      const result = await loadCertificates(customDomains);

      expect(mockCreateCert).toHaveBeenCalledWith({
        ca: expect.any(Object),
        domains: ['custom1.test', 'custom2.test', 'localhost', '127.0.0.1', '::1'],
        validity: 365,
      });
      expect(result).toEqual(mockCert);
    });

    it('should load certificates with empty array', async () => {
      const result = await loadCertificates([]);

      expect(mockCreateCert).toHaveBeenCalledWith({
        ca: expect.any(Object),
        domains: ['localhost', '127.0.0.1', '::1'],
        validity: 365,
      });
      expect(result).toEqual(mockCert);
    });
  });

  describe('Platform-specific behavior', () => {
    it('should handle all supported platforms for CA path determination', () => {
      // Test macOS
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      getCAPath();
      expect(mockPath.join).toHaveBeenCalledWith('/Users/testuser', 'Library', 'Application Support', 'Anglesite');

      mockPath.join.mockClear();

      // Test Windows
      Object.defineProperty(process, 'platform', { value: 'win32' });
      process.env.APPDATA = 'C:\\Users\\testuser\\AppData\\Roaming';
      getCAPath();
      expect(mockPath.join).toHaveBeenCalledWith('C:\\Users\\testuser\\AppData\\Roaming', 'Anglesite');

      mockPath.join.mockClear();

      // Test Linux/Other
      Object.defineProperty(process, 'platform', { value: 'linux' });
      getCAPath();
      expect(mockPath.join).toHaveBeenCalledWith('/Users/testuser', '.config', 'anglesite');
    });
  });

  describe('Certificate Cache Behavior', () => {
    const mockCA = {
      cert: '-----BEGIN CERTIFICATE-----\nMOCK_CA_CERT\n-----END CERTIFICATE-----',
      key: '-----BEGIN PRIVATE KEY-----\nMOCK_CA_KEY\n-----END PRIVATE KEY-----',
    };

    const mockCert = {
      cert: '-----BEGIN CERTIFICATE-----\nMOCK_CERT\n-----END CERTIFICATE-----',
      key: '-----BEGIN PRIVATE KEY-----\nMOCK_KEY\n-----END PRIVATE KEY-----',
    };

    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValueOnce(mockCA.cert).mockReturnValueOnce(mockCA.key);
      mockCreateCert.mockResolvedValue(mockCert);
    });

    it('should cache certificates by sorted domain list', async () => {
      // Generate certificate for domains in one order
      await generateCertificate(['b.test', 'a.test', 'c.test']);

      // Request same domains in different order - should use cache
      await generateCertificate(['a.test', 'c.test', 'b.test']);

      // Should only call createCert once due to caching
      expect(mockCreateCert).toHaveBeenCalledTimes(1);
    });

    it('should generate new certificates for different domain sets', async () => {
      // First set of domains
      await generateCertificate(['a.test']);

      // Different set of domains - should not use cache
      await generateCertificate(['b.test']);

      expect(mockCreateCert).toHaveBeenCalledTimes(2);
    });
  });
});
