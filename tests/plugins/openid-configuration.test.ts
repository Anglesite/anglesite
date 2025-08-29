import * as fs from 'fs';
import * as path from 'path';
import { generateOpenIDConfiguration } from '../../plugins/openid-configuration.js';
import addOpenIDConfiguration from '../../plugins/openid-configuration.js';
import type { EleventyConfig } from '../types/eleventy-shim.js';
import type { AnglesiteWebsiteConfiguration } from '../../types/website.js';

// Mock fs operations to prevent actual file operations during tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('OpenID Configuration Plugin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('generateOpenIDConfiguration', () => {
    it('returns null when openid_configuration is not enabled', () => {
      const config: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
      };

      const result = generateOpenIDConfiguration(config);
      expect(result).toBeNull();
    });

    it('returns null when openid_configuration is explicitly disabled', () => {
      const config: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        openid_configuration: {
          enabled: false,
          issuer: 'https://example.com',
        },
      };

      const result = generateOpenIDConfiguration(config);
      expect(result).toBeNull();
    });

    it('returns null and warns when issuer is missing', () => {
      const config: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        openid_configuration: {
          enabled: true,
        },
      };

      const result = generateOpenIDConfiguration(config);
      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[@dwk/anglesite-11ty] OpenID Configuration issuer is not a valid URL:')
      );
    });

    it('returns null and warns when issuer is invalid URL', () => {
      const config: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        openid_configuration: {
          enabled: true,
          issuer: 'invalid-url',
        },
      };

      const result = generateOpenIDConfiguration(config);
      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] OpenID Configuration issuer is not a valid URL: invalid-url'
      );
    });

    it('returns null and warns when issuer uses non-http(s) protocol', () => {
      const config: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        openid_configuration: {
          enabled: true,
          issuer: 'ftp://example.com',
        },
      };

      const result = generateOpenIDConfiguration(config);
      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] OpenID Configuration issuer is not a valid URL: ftp://example.com'
      );
    });

    it('generates basic configuration with only issuer', () => {
      const config: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        openid_configuration: {
          enabled: true,
          issuer: 'https://example.com',
        },
      };

      const result = generateOpenIDConfiguration(config);
      expect(result).toEqual({
        issuer: 'https://example.com',
        scopes_supported: ['openid', 'profile', 'email'],
        response_types_supported: ['code', 'id_token', 'code id_token'],
        response_modes_supported: ['query', 'fragment'],
        grant_types_supported: ['authorization_code', 'implicit'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
        claims_supported: ['sub', 'iss', 'auth_time', 'name', 'email'],
      });
    });

    it('includes valid optional endpoints', () => {
      const config: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        openid_configuration: {
          enabled: true,
          issuer: 'https://example.com',
          authorization_endpoint: 'https://example.com/auth',
          token_endpoint: 'https://example.com/token',
          userinfo_endpoint: 'https://example.com/userinfo',
          jwks_uri: 'https://example.com/jwks',
          registration_endpoint: 'https://example.com/register',
        },
      };

      const result = generateOpenIDConfiguration(config);
      expect(result).toMatchObject({
        issuer: 'https://example.com',
        authorization_endpoint: 'https://example.com/auth',
        token_endpoint: 'https://example.com/token',
        userinfo_endpoint: 'https://example.com/userinfo',
        jwks_uri: 'https://example.com/jwks',
        registration_endpoint: 'https://example.com/register',
      });
    });

    it('warns and excludes invalid optional endpoints', () => {
      const config: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        openid_configuration: {
          enabled: true,
          issuer: 'https://example.com',
          authorization_endpoint: 'invalid-url',
          token_endpoint: 'ftp://example.com/token',
          userinfo_endpoint: 'https://example.com/userinfo',
        },
      };

      const result = generateOpenIDConfiguration(config);
      expect(result).toMatchObject({
        issuer: 'https://example.com',
        userinfo_endpoint: 'https://example.com/userinfo',
      });
      expect(result).not.toHaveProperty('authorization_endpoint');
      expect(result).not.toHaveProperty('token_endpoint');

      expect(console.warn).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] OpenID Configuration authorization_endpoint is not a valid URL: invalid-url'
      );
      expect(console.warn).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] OpenID Configuration token_endpoint is not a valid URL: ftp://example.com/token'
      );
    });

    it('includes custom array values when provided', () => {
      const config: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        openid_configuration: {
          enabled: true,
          issuer: 'https://example.com',
          scopes_supported: ['openid', 'profile'],
          response_types_supported: ['code'],
          claims_supported: ['sub', 'name'],
        },
      };

      const result = generateOpenIDConfiguration(config);
      expect(result).toMatchObject({
        scopes_supported: ['openid', 'profile'],
        response_types_supported: ['code'],
        claims_supported: ['sub', 'name'],
      });
    });

    it('includes optional features when provided', () => {
      const config: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        openid_configuration: {
          enabled: true,
          issuer: 'https://example.com',
          code_challenge_methods_supported: ['S256'],
          revocation_endpoint: 'https://example.com/revoke',
          introspection_endpoint: 'https://example.com/introspect',
          device_authorization_endpoint: 'https://example.com/device',
          end_session_endpoint: 'https://example.com/logout',
        },
      };

      const result = generateOpenIDConfiguration(config);
      expect(result).toMatchObject({
        code_challenge_methods_supported: ['S256'],
        revocation_endpoint: 'https://example.com/revoke',
        introspection_endpoint: 'https://example.com/introspect',
        device_authorization_endpoint: 'https://example.com/device',
        end_session_endpoint: 'https://example.com/logout',
      });
    });

    it('includes boolean logout flags when explicitly set', () => {
      const config: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        openid_configuration: {
          enabled: true,
          issuer: 'https://example.com',
          backchannel_logout_supported: true,
          backchannel_logout_session_supported: false,
          frontchannel_logout_supported: true,
          frontchannel_logout_session_supported: false,
        },
      };

      const result = generateOpenIDConfiguration(config);
      expect(result).toMatchObject({
        backchannel_logout_supported: true,
        backchannel_logout_session_supported: false,
        frontchannel_logout_supported: true,
        frontchannel_logout_session_supported: false,
      });
    });

    it('includes optional arrays when provided', () => {
      const config: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        openid_configuration: {
          enabled: true,
          issuer: 'https://example.com',
          claim_types_supported: ['normal'],
          ui_locales_supported: ['en', 'es'],
        },
      };

      const result = generateOpenIDConfiguration(config);
      expect(result).toMatchObject({
        claim_types_supported: ['normal'],
        ui_locales_supported: ['en', 'es'],
      });
    });

    it('includes documentation URLs when valid', () => {
      const config: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        openid_configuration: {
          enabled: true,
          issuer: 'https://example.com',
          service_documentation: 'https://example.com/docs',
          op_policy_uri: 'https://example.com/policy',
          op_tos_uri: 'https://example.com/terms',
        },
      };

      const result = generateOpenIDConfiguration(config);
      expect(result).toMatchObject({
        service_documentation: 'https://example.com/docs',
        op_policy_uri: 'https://example.com/policy',
        op_tos_uri: 'https://example.com/terms',
      });
    });

    it('excludes documentation URLs when invalid', () => {
      const config: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        openid_configuration: {
          enabled: true,
          issuer: 'https://example.com',
          service_documentation: 'invalid-url',
          op_policy_uri: 'ftp://example.com/policy',
        },
      };

      const result = generateOpenIDConfiguration(config);
      expect(result).not.toHaveProperty('service_documentation');
      expect(result).not.toHaveProperty('op_policy_uri');
    });
  });

  describe('addOpenIDConfiguration plugin', () => {
    let mockEleventyConfig: jest.Mocked<EleventyConfig>;
    let eventCallback: (data: { dir: { output: string }; results: unknown[] | null }) => Promise<void>;

    beforeEach(() => {
      mockEleventyConfig = {
        on: jest.fn(),
      } as unknown as jest.Mocked<EleventyConfig>;

      addOpenIDConfiguration(mockEleventyConfig);
      eventCallback = mockEleventyConfig.on.mock.calls[0][1];
    });

    it('registers eleventy.after event handler', () => {
      expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
    });

    it('returns early if no results', async () => {
      await eventCallback({ dir: { output: '_site' }, results: [] });
      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });

    it('returns early if results is null', async () => {
      await eventCallback({ dir: { output: '_site' }, results: null });
      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });

    it('uses website config from first result data when available', async () => {
      const websiteConfig: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        openid_configuration: {
          enabled: true,
          issuer: 'https://example.com',
        },
      };

      await eventCallback({
        dir: { output: '_site' },
        results: [{ data: { website: websiteConfig } }],
      });

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(path.join('_site', '.well-known'), { recursive: true });
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join('_site', '.well-known', 'openid_configuration'),
        expect.stringContaining('"issuer": "https://example.com"')
      );
      expect(console.log).toHaveBeenCalledWith(
        `[@dwk/anglesite-11ty] Wrote ${path.join('_site', '.well-known', 'openid_configuration')}`
      );
    });

    it('reads from filesystem when no data property exists', async () => {
      const websiteConfig: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        openid_configuration: {
          enabled: true,
          issuer: 'https://example.com',
        },
      };

      mockFs.promises.readFile.mockResolvedValue(JSON.stringify(websiteConfig));

      await eventCallback({
        dir: { output: '_site' },
        results: [{}],
      });

      expect(mockFs.promises.readFile).toHaveBeenCalledWith(path.resolve('src', '_data', 'website.json'), 'utf-8');
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(path.join('_site', '.well-known'), { recursive: true });
    });

    it('warns and returns when filesystem read fails', async () => {
      mockFs.promises.readFile.mockRejectedValue(new Error('File not found'));

      await eventCallback({
        dir: { output: '_site' },
        results: [{}],
      });

      expect(console.warn).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] OpenID Configuration plugin: Could not read website.json from _data directory'
      );
      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });

    it('warns and returns when no website config found', async () => {
      await eventCallback({
        dir: { output: '_site' },
        results: [{ data: {} }],
      });

      expect(console.warn).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] OpenID Configuration plugin: No website configuration found'
      );
      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });

    it('returns early when openid_configuration is not enabled', async () => {
      const websiteConfig: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
      };

      await eventCallback({
        dir: { output: '_site' },
        results: [{ data: { website: websiteConfig } }],
      });

      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });

    it('handles file system errors gracefully', async () => {
      const websiteConfig: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        openid_configuration: {
          enabled: true,
          issuer: 'https://example.com',
        },
      };

      mockFs.mkdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await eventCallback({
        dir: { output: '_site' },
        results: [{ data: { website: websiteConfig } }],
      });

      expect(console.error).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] Failed to write OpenID Configuration file: Permission denied'
      );
    });

    it('handles non-Error exceptions', async () => {
      const websiteConfig: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        openid_configuration: {
          enabled: true,
          issuer: 'https://example.com',
        },
      };

      mockFs.mkdirSync.mockImplementation(() => {
        throw 'String error';
      });

      await eventCallback({
        dir: { output: '_site' },
        results: [{ data: { website: websiteConfig } }],
      });

      expect(console.error).toHaveBeenCalledWith(
        '[@dwk/anglesite-11ty] Failed to write OpenID Configuration file: String error'
      );
    });

    it('does not write file when generateOpenIDConfiguration returns null', async () => {
      const websiteConfig: AnglesiteWebsiteConfiguration = {
        title: 'Test Site',
        language: 'en',
        url: 'https://example.com',
        openid_configuration: {
          enabled: true,
          issuer: 'invalid-url',
        },
      };

      await eventCallback({
        dir: { output: '_site' },
        results: [{ data: { website: websiteConfig } }],
      });

      expect(mockFs.mkdirSync).toHaveBeenCalled();
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });
  });
});
