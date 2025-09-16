import * as fs from 'fs';
import * as path from 'path';
import { generateOpenIDConfiguration } from '../../plugins/openid-configuration';
import addOpenIDConfiguration from '../../plugins/openid-configuration';
import type { EleventyConfig } from '../../types/eleventy-shim';
import type { AnglesiteWebsiteConfiguration } from '../../types/website';

// Mock fs operations
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
  },
}));

describe('openid-configuration plugin', () => {
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
    jest.clearAllMocks();
  });

  describe('generateOpenIDConfiguration', () => {
    const validWebsiteConfig: AnglesiteWebsiteConfiguration = {
      title: 'Test Site',
      url: 'https://example.com',
      openid_configuration: {
        enabled: true,
        issuer: 'https://example.com',
        authorization_endpoint: 'https://example.com/oauth2/authorize',
        token_endpoint: 'https://example.com/oauth2/token',
        userinfo_endpoint: 'https://example.com/oauth2/userinfo',
        jwks_uri: 'https://example.com/.well-known/jwks.json',
      },
    };

    it('should generate valid OpenID configuration', () => {
      const result = generateOpenIDConfiguration(validWebsiteConfig);

      expect(result).toEqual({
        issuer: 'https://example.com',
        authorization_endpoint: 'https://example.com/oauth2/authorize',
        token_endpoint: 'https://example.com/oauth2/token',
        userinfo_endpoint: 'https://example.com/oauth2/userinfo',
        jwks_uri: 'https://example.com/.well-known/jwks.json',
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

    it('should return null when not enabled', () => {
      const config = {
        ...validWebsiteConfig,
        openid_configuration: { enabled: false, issuer: 'https://example.com' },
      };

      const result = generateOpenIDConfiguration(config);
      expect(result).toBeNull();
    });

    it('should return null when openid_configuration is missing', () => {
      const config = { ...validWebsiteConfig };
      delete config.openid_configuration;

      const result = generateOpenIDConfiguration(config);
      expect(result).toBeNull();
    });

    it('should return null for invalid issuer URL', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const config = {
        ...validWebsiteConfig,
        openid_configuration: { enabled: true, issuer: 'invalid-url' },
      };

      const result = generateOpenIDConfiguration(config);

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith('[Eleventy] OpenID Configuration issuer is not a valid URL: invalid-url');

      consoleSpy.mockRestore();
    });

    it('should validate and include optional endpoints', () => {
      const configWithOptionals = {
        ...validWebsiteConfig,
        openid_configuration: {
          ...validWebsiteConfig.openid_configuration!,
          registration_endpoint: 'https://example.com/oauth2/register',
          revocation_endpoint: 'https://example.com/oauth2/revoke',
          introspection_endpoint: 'https://example.com/oauth2/introspect',
          device_authorization_endpoint: 'https://example.com/oauth2/device',
          end_session_endpoint: 'https://example.com/oauth2/logout',
        },
      };

      const result = generateOpenIDConfiguration(configWithOptionals);

      expect(result).toMatchObject({
        registration_endpoint: 'https://example.com/oauth2/register',
        revocation_endpoint: 'https://example.com/oauth2/revoke',
        introspection_endpoint: 'https://example.com/oauth2/introspect',
        device_authorization_endpoint: 'https://example.com/oauth2/device',
        end_session_endpoint: 'https://example.com/oauth2/logout',
      });
    });

    it('should warn about invalid optional endpoints', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const configWithInvalidEndpoint = {
        ...validWebsiteConfig,
        openid_configuration: {
          ...validWebsiteConfig.openid_configuration!,
          authorization_endpoint: 'invalid-url',
        },
      };

      const result = generateOpenIDConfiguration(configWithInvalidEndpoint);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Eleventy] OpenID Configuration authorization_endpoint is not a valid URL: invalid-url'
      );
      expect(result?.authorization_endpoint).toBeUndefined();

      consoleSpy.mockRestore();
    });

    it('should include custom scopes and response types', () => {
      const customConfig = {
        ...validWebsiteConfig,
        openid_configuration: {
          ...validWebsiteConfig.openid_configuration!,
          scopes_supported: ['openid', 'profile', 'email', 'phone', 'address'],
          response_types_supported: ['code', 'id_token', 'token'] as const,
          grant_types_supported: ['authorization_code', 'refresh_token'] as const,
        },
      };

      const result = generateOpenIDConfiguration(customConfig);

      expect(result).toMatchObject({
        scopes_supported: ['openid', 'profile', 'email', 'phone', 'address'],
        response_types_supported: ['code', 'id_token', 'token'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
      });
    });

    it('should include boolean flags when specified', () => {
      const configWithFlags = {
        ...validWebsiteConfig,
        openid_configuration: {
          ...validWebsiteConfig.openid_configuration!,
          backchannel_logout_supported: true,
          backchannel_logout_session_supported: false,
          frontchannel_logout_supported: true,
          frontchannel_logout_session_supported: true,
        },
      };

      const result = generateOpenIDConfiguration(configWithFlags);

      expect(result).toMatchObject({
        backchannel_logout_supported: true,
        backchannel_logout_session_supported: false,
        frontchannel_logout_supported: true,
        frontchannel_logout_session_supported: true,
      });
    });

    it('should include documentation URLs when valid', () => {
      const configWithDocs = {
        ...validWebsiteConfig,
        openid_configuration: {
          ...validWebsiteConfig.openid_configuration!,
          service_documentation: 'https://example.com/docs',
          op_policy_uri: 'https://example.com/privacy',
          op_tos_uri: 'https://example.com/terms',
        },
      };

      const result = generateOpenIDConfiguration(configWithDocs);

      expect(result).toMatchObject({
        service_documentation: 'https://example.com/docs',
        op_policy_uri: 'https://example.com/privacy',
        op_tos_uri: 'https://example.com/terms',
      });
    });

    it('should include PKCE and advanced features', () => {
      const advancedConfig = {
        ...validWebsiteConfig,
        openid_configuration: {
          ...validWebsiteConfig.openid_configuration!,
          code_challenge_methods_supported: ['S256', 'plain'] as const,
          claim_types_supported: ['normal', 'aggregated', 'distributed'] as const,
          ui_locales_supported: ['en-US', 'es-ES', 'fr-FR'],
        },
      };

      const result = generateOpenIDConfiguration(advancedConfig);

      expect(result).toMatchObject({
        code_challenge_methods_supported: ['S256', 'plain'],
        claim_types_supported: ['normal', 'aggregated', 'distributed'],
        ui_locales_supported: ['en-US', 'es-ES', 'fr-FR'],
      });
    });
  });

  describe('plugin integration', () => {
    it('should register eleventy.after event handler', () => {
      addOpenIDConfiguration(mockEleventyConfig);

      expect(mockEleventyConfig.on).toHaveBeenCalledWith('eleventy.after', expect.any(Function));
    });

    it('should handle build process with valid configuration', async () => {
      const mockResults = [
        {
          data: {
            website: {
              title: 'Test Site',
              openid_configuration: {
                enabled: true,
                issuer: 'https://example.com',
                authorization_endpoint: 'https://example.com/oauth2/authorize',
                token_endpoint: 'https://example.com/oauth2/token',
              },
            },
          },
        },
      ];

      const mockDir = { output: '_site' };
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      addOpenIDConfiguration(mockEleventyConfig);
      const eventHandler = (mockEleventyConfig.on as jest.Mock).mock.calls[0][1];

      await eventHandler({ dir: mockDir, results: mockResults });

      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('_site', '.well-known'), { recursive: true });

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join('_site', '.well-known', 'openid_configuration'),
        expect.stringContaining('"issuer": "https://example.com"')
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        `[Eleventy] Wrote ${path.join('_site', '.well-known', 'openid_configuration')}`
      );

      consoleSpy.mockRestore();
    });

    it('should skip when configuration is disabled', async () => {
      const mockResults = [
        {
          data: {
            website: {
              title: 'Test Site',
              openid_configuration: { enabled: false, issuer: 'https://example.com' },
            },
          },
        },
      ];

      addOpenIDConfiguration(mockEleventyConfig);
      const eventHandler = (mockEleventyConfig.on as jest.Mock).mock.calls[0][1];

      await eventHandler({ dir: { output: '_site' }, results: mockResults });

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should handle missing website configuration gracefully', async () => {
      const mockResults = [{ data: {} }];
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      addOpenIDConfiguration(mockEleventyConfig);
      const eventHandler = (mockEleventyConfig.on as jest.Mock).mock.calls[0][1];

      await eventHandler({ dir: { output: '_site' }, results: mockResults });

      expect(consoleSpy).toHaveBeenCalledWith('[Eleventy] OpenID Configuration plugin: No website configuration found');
      expect(fs.writeFileSync).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle filesystem fallback', async () => {
      const mockResults = [{}]; // No data property
      const mockWebsiteData = JSON.stringify({
        title: 'Test Site',
        openid_configuration: {
          enabled: true,
          issuer: 'https://example.com',
        },
      });

      (fs.promises.readFile as jest.Mock).mockResolvedValueOnce(mockWebsiteData);

      addOpenIDConfiguration(mockEleventyConfig);
      const eventHandler = (mockEleventyConfig.on as jest.Mock).mock.calls[0][1];

      await eventHandler({ dir: { output: '_site' }, results: mockResults });

      expect(fs.promises.readFile).toHaveBeenCalledWith(path.resolve('src', '_data', 'website.json'), 'utf-8');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should handle filesystem read errors gracefully', async () => {
      const mockResults = [{}]; // No data property
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      (fs.promises.readFile as jest.Mock).mockRejectedValueOnce(new Error('File not found'));

      addOpenIDConfiguration(mockEleventyConfig);
      const eventHandler = (mockEleventyConfig.on as jest.Mock).mock.calls[0][1];

      await eventHandler({ dir: { output: '_site' }, results: mockResults });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Eleventy] OpenID Configuration plugin: Could not read website.json from _data directory'
      );

      consoleSpy.mockRestore();
    });

    it('should handle write errors gracefully', async () => {
      const mockResults = [
        {
          data: {
            website: {
              openid_configuration: {
                enabled: true,
                issuer: 'https://example.com',
              },
            },
          },
        },
      ];

      const writeError = new Error('Permission denied');
      (fs.writeFileSync as jest.Mock).mockImplementationOnce(() => {
        throw writeError;
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      addOpenIDConfiguration(mockEleventyConfig);
      const eventHandler = (mockEleventyConfig.on as jest.Mock).mock.calls[0][1];

      await eventHandler({ dir: { output: '_site' }, results: mockResults });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Eleventy] Failed to write OpenID Configuration file: Permission denied'
      );

      consoleSpy.mockRestore();
    });

    it('should skip when no results provided', async () => {
      addOpenIDConfiguration(mockEleventyConfig);
      const eventHandler = (mockEleventyConfig.on as jest.Mock).mock.calls[0][1];

      await eventHandler({ dir: { output: '_site' }, results: [] });

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });
});
