// ABOUTME: Test suite for the main anglesite-11ty plugin
// ABOUTME: Covers WebC plugin conflict prevention and configuration options

import anglesiteEleventy from '../anglesite-11ty/dist/index.js';
import type { EleventyConfig } from './types/eleventy-shim.js';

// Mock the WebC plugin
jest.mock('@11ty/eleventy-plugin-webc', () => ({
  default: jest.fn(),
  __esModule: true,
}));

describe.skip('Anglesite 11ty Plugin', () => {
  let mockEleventyConfig: jest.Mocked<EleventyConfig>;
  let mockWebCPlugin: jest.MockedFunction<() => void>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create comprehensive mock Eleventy config with all methods used by plugins
    mockEleventyConfig = {
      setDataFileBaseName: jest.fn(),
      addPlugin: jest.fn(),
      addGlobalData: jest.fn(),
      addShortcode: jest.fn(),
      addFilter: jest.fn(),
      addTransform: jest.fn(),
      addCollection: jest.fn(),
      on: jest.fn(),
      setBrowserSyncConfig: jest.fn(),
      setDataDeepMerge: jest.fn(),
      setLiquidOptions: jest.fn(),
      setNunjucksEnvironmentOptions: jest.fn(),
      addWatchTarget: jest.fn(),
      setWatchJavaScriptDependencies: jest.fn(),
      setServerOptions: jest.fn(),
      addPassthroughCopy: jest.fn(),
      addLayoutAlias: jest.fn(),
      addTemplateFormats: jest.fn(),
      setFreezeReservedData: jest.fn(),
      ignores: new Set(),
    } as unknown as jest.Mocked<EleventyConfig>;

    // Get the mocked WebC plugin
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mockWebCPlugin = require('@11ty/eleventy-plugin-webc').default;
  });

  describe('Basic Plugin Registration', () => {
    it('should register all core plugins by default', () => {
      anglesiteEleventy(mockEleventyConfig);

      // Should set data file base name
      expect(mockEleventyConfig.setDataFileBaseName).toHaveBeenCalledWith('index');

      // Should register WebC plugin by default
      expect(mockEleventyConfig.addPlugin).toHaveBeenCalledWith(
        mockWebCPlugin,
        expect.objectContaining({
          components: '_includes/**/*.webc',
        })
      );

      // Should register WebC plugin (other plugins use different methods like addShortcode)
      expect(mockEleventyConfig.addPlugin).toHaveBeenCalledTimes(1); // Only WebC plugin

      // Verify other plugins are registered (they use different methods)
      expect(mockEleventyConfig.addShortcode).toHaveBeenCalled(); // shortcodes plugin
      expect(mockEleventyConfig.on).toHaveBeenCalled(); // various plugins use event handlers
    });

    it('should use default WebC component pattern when no options provided', () => {
      anglesiteEleventy(mockEleventyConfig);

      expect(mockEleventyConfig.addPlugin).toHaveBeenCalledWith(
        mockWebCPlugin,
        expect.objectContaining({
          components: '_includes/**/*.webc',
        })
      );
    });
  });

  describe('WebC Plugin Conflict Prevention', () => {
    it('should skip WebC plugin when skipWebC is true', () => {
      anglesiteEleventy(mockEleventyConfig, { skipWebC: true });

      // Should still set data file base name
      expect(mockEleventyConfig.setDataFileBaseName).toHaveBeenCalledWith('index');

      // Should NOT register WebC plugin
      expect(mockEleventyConfig.addPlugin).not.toHaveBeenCalledWith(mockWebCPlugin, expect.any(Object));

      // Should NOT register WebC plugin when skipWebC is true
      expect(mockEleventyConfig.addPlugin).toHaveBeenCalledTimes(0);
    });

    it('should register WebC plugin when skipWebC is false', () => {
      anglesiteEleventy(mockEleventyConfig, { skipWebC: false });

      expect(mockEleventyConfig.addPlugin).toHaveBeenCalledWith(
        mockWebCPlugin,
        expect.objectContaining({
          components: '_includes/**/*.webc',
        })
      );
    });

    it('should register WebC plugin when skipWebC is undefined', () => {
      anglesiteEleventy(mockEleventyConfig, {});

      expect(mockEleventyConfig.addPlugin).toHaveBeenCalledWith(
        mockWebCPlugin,
        expect.objectContaining({
          components: '_includes/**/*.webc',
        })
      );
    });
  });

  describe('WebC Configuration Options', () => {
    it('should use custom webComponents path when provided', () => {
      const customPath = 'custom/path/**/*.webc';
      anglesiteEleventy(mockEleventyConfig, {
        webComponents: customPath,
      });

      expect(mockEleventyConfig.addPlugin).toHaveBeenCalledWith(
        mockWebCPlugin,
        expect.objectContaining({
          components: customPath,
        })
      );
    });

    it('should merge webcOptions with WebC plugin configuration', () => {
      const webcOptions = {
        bundlePluginOptions: {
          transforms: ['esbuild'],
        },
      };

      anglesiteEleventy(mockEleventyConfig, {
        webComponents: 'src/**/*.webc',
        webcOptions,
      });

      expect(mockEleventyConfig.addPlugin).toHaveBeenCalledWith(
        mockWebCPlugin,
        expect.objectContaining({
          components: 'src/**/*.webc',
          ...webcOptions,
        })
      );
    });

    it('should handle both custom path and options with skipWebC false', () => {
      const customPath = 'components/**/*.webc';
      const webcOptions = { mode: 'production' };

      anglesiteEleventy(mockEleventyConfig, {
        skipWebC: false,
        webComponents: customPath,
        webcOptions,
      });

      expect(mockEleventyConfig.addPlugin).toHaveBeenCalledWith(
        mockWebCPlugin,
        expect.objectContaining({
          components: customPath,
          mode: 'production',
        })
      );
    });
  });

  describe('Edge Cases and Error Conditions', () => {
    it('should handle null options gracefully', () => {
      expect(() => {
        anglesiteEleventy(mockEleventyConfig, null as unknown as Parameters<typeof anglesiteEleventy>[1]);
      }).not.toThrow();

      // Should use defaults
      expect(mockEleventyConfig.addPlugin).toHaveBeenCalledWith(
        mockWebCPlugin,
        expect.objectContaining({
          components: '_includes/**/*.webc',
        })
      );
    });

    it('should handle empty webcOptions object', () => {
      anglesiteEleventy(mockEleventyConfig, {
        webComponents: 'test/**/*.webc',
        webcOptions: {},
      });

      expect(mockEleventyConfig.addPlugin).toHaveBeenCalledWith(
        mockWebCPlugin,
        expect.objectContaining({
          components: 'test/**/*.webc',
        })
      );
    });

    it('should not register WebC when skipWebC is explicitly true with other options', () => {
      anglesiteEleventy(mockEleventyConfig, {
        skipWebC: true,
        webComponents: 'should/be/ignored/**/*.webc',
        webcOptions: { mode: 'test' },
      });

      // Should NOT register WebC plugin at all
      expect(mockEleventyConfig.addPlugin).not.toHaveBeenCalledWith(mockWebCPlugin, expect.any(Object));
    });
  });

  describe('Plugin Registration Order', () => {
    it('should register WebC plugin before other plugins', () => {
      anglesiteEleventy(mockEleventyConfig);

      const addPluginCalls = mockEleventyConfig.addPlugin.mock.calls;

      // First call should be WebC plugin
      expect(addPluginCalls[0][0]).toBe(mockWebCPlugin);

      // Subsequent calls should be other plugins (function-based)
      for (let i = 1; i < addPluginCalls.length; i++) {
        expect(typeof addPluginCalls[i][0]).toBe('function');
      }
    });
  });

  describe('Integration with Skip Option', () => {
    it('should maintain consistent behavior across multiple calls with skipWebC', () => {
      const options = { skipWebC: true };

      // First call
      anglesiteEleventy(mockEleventyConfig, options);
      const firstCallCount = mockEleventyConfig.addPlugin.mock.calls.length;

      // Reset mock
      jest.clearAllMocks();

      // Second call with same options
      anglesiteEleventy(mockEleventyConfig, options);
      const secondCallCount = mockEleventyConfig.addPlugin.mock.calls.length;

      // Should have same number of plugin registrations
      expect(firstCallCount).toBe(secondCallCount);

      // Neither should have registered WebC
      expect(mockEleventyConfig.addPlugin).not.toHaveBeenCalledWith(mockWebCPlugin, expect.any(Object));
    });
  });
});
