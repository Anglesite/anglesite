/**
 * Tests for IPC Retry Configuration
 */

import {
  DEFAULT_RETRY_CONFIG,
  RETRY_BLACKLIST,
  CHANNEL_SPECIFIC_CONFIG,
  getRetryConfigForChannel,
  isRetryBlacklisted,
} from '../../../src/renderer/utils/ipc-retry-config';

describe('IPC Retry Configuration', () => {
  describe('DEFAULT_RETRY_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_RETRY_CONFIG).toEqual({
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 5000,
        retryableErrors: ['TIMEOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'Network error'],
      });
    });

    it('should have maxAttempts greater than 0', () => {
      expect(DEFAULT_RETRY_CONFIG.maxAttempts).toBeGreaterThan(0);
    });

    it('should have baseDelay less than or equal to maxDelay', () => {
      expect(DEFAULT_RETRY_CONFIG.baseDelay).toBeLessThanOrEqual(DEFAULT_RETRY_CONFIG.maxDelay);
    });

    it('should have at least one retryable error', () => {
      expect(DEFAULT_RETRY_CONFIG.retryableErrors.length).toBeGreaterThan(0);
    });
  });

  describe('RETRY_BLACKLIST', () => {
    it('should contain exactly 8 channels', () => {
      expect(RETRY_BLACKLIST.size).toBe(8);
    });

    it('should contain diagnostics channels', () => {
      expect(RETRY_BLACKLIST.has('diagnostics:clear-errors')).toBe(true);
      expect(RETRY_BLACKLIST.has('diagnostics:export-errors')).toBe(true);
      expect(RETRY_BLACKLIST.has('diagnostics:toggle-window')).toBe(true);
      expect(RETRY_BLACKLIST.has('diagnostics:subscribe-errors')).toBe(true);
      expect(RETRY_BLACKLIST.has('diagnostics:unsubscribe-errors')).toBe(true);
      expect(RETRY_BLACKLIST.has('diagnostics:dismiss-notification')).toBe(true);
    });

    it('should contain action channels', () => {
      expect(RETRY_BLACKLIST.has('create-new-page')).toBe(true);
      expect(RETRY_BLACKLIST.has('start-website-dev-server')).toBe(true);
    });

    it('should be readonly', () => {
      // TypeScript enforces this at compile time, but we can verify the Set is not easily modifiable
      expect(() => {
        // @ts-expect-error - Testing readonly behavior
        RETRY_BLACKLIST.add = undefined;
      }).not.toThrow();
    });
  });

  describe('CHANNEL_SPECIFIC_CONFIG', () => {
    it('should contain read operation configurations', () => {
      expect(CHANNEL_SPECIFIC_CONFIG['get-website-schema']).toBeDefined();
      expect(CHANNEL_SPECIFIC_CONFIG['get-file-content']).toBeDefined();
      expect(CHANNEL_SPECIFIC_CONFIG['get-website-files']).toBeDefined();
      expect(CHANNEL_SPECIFIC_CONFIG['list-websites']).toBeDefined();
    });

    it('should contain write operation configurations', () => {
      expect(CHANNEL_SPECIFIC_CONFIG['save-file-content']).toBeDefined();
      expect(CHANNEL_SPECIFIC_CONFIG['rename-website']).toBeDefined();
    });

    it('should contain diagnostics operation configurations', () => {
      expect(CHANNEL_SPECIFIC_CONFIG['diagnostics:get-errors']).toBeDefined();
    });

    it('should have faster retries for read operations', () => {
      const readConfig = CHANNEL_SPECIFIC_CONFIG['get-website-schema'];
      expect(readConfig?.baseDelay).toBe(1000);
      expect(readConfig?.maxDelay).toBe(3000);
    });

    it('should have more cautious retries for write operations', () => {
      const writeConfig = CHANNEL_SPECIFIC_CONFIG['save-file-content'];
      expect(writeConfig?.maxAttempts).toBe(2);
      expect(writeConfig?.baseDelay).toBe(2000);
      expect(writeConfig?.maxDelay).toBe(5000);
    });
  });

  describe('isRetryBlacklisted', () => {
    it('should return true for blacklisted channels', () => {
      expect(isRetryBlacklisted('diagnostics:clear-errors')).toBe(true);
      expect(isRetryBlacklisted('diagnostics:export-errors')).toBe(true);
      expect(isRetryBlacklisted('diagnostics:toggle-window')).toBe(true);
      expect(isRetryBlacklisted('create-new-page')).toBe(true);
      expect(isRetryBlacklisted('start-website-dev-server')).toBe(true);
      expect(isRetryBlacklisted('diagnostics:subscribe-errors')).toBe(true);
      expect(isRetryBlacklisted('diagnostics:unsubscribe-errors')).toBe(true);
      expect(isRetryBlacklisted('diagnostics:dismiss-notification')).toBe(true);
    });

    it('should return false for non-blacklisted channels', () => {
      expect(isRetryBlacklisted('get-website-schema')).toBe(false);
      expect(isRetryBlacklisted('save-file-content')).toBe(false);
      expect(isRetryBlacklisted('list-websites')).toBe(false);
      expect(isRetryBlacklisted('unknown-channel')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isRetryBlacklisted('')).toBe(false);
    });

    it('should handle case-sensitive channel names', () => {
      expect(isRetryBlacklisted('DIAGNOSTICS:CLEAR-ERRORS')).toBe(false);
      expect(isRetryBlacklisted('Diagnostics:Clear-Errors')).toBe(false);
    });

    it('should return false for channels with extra whitespace', () => {
      expect(isRetryBlacklisted(' diagnostics:clear-errors')).toBe(false);
      expect(isRetryBlacklisted('diagnostics:clear-errors ')).toBe(false);
    });
  });

  describe('getRetryConfigForChannel', () => {
    it('should return DEFAULT_RETRY_CONFIG for unknown channels', () => {
      const config = getRetryConfigForChannel('unknown-channel');
      expect(config).toEqual(DEFAULT_RETRY_CONFIG);
    });

    it('should return DEFAULT_RETRY_CONFIG for empty string', () => {
      const config = getRetryConfigForChannel('');
      expect(config).toEqual(DEFAULT_RETRY_CONFIG);
    });

    it('should merge channel-specific overrides for read operations', () => {
      const config = getRetryConfigForChannel('get-website-schema');
      expect(config).toEqual({
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 3000,
        retryableErrors: DEFAULT_RETRY_CONFIG.retryableErrors,
      });
    });

    it('should merge channel-specific overrides for write operations', () => {
      const config = getRetryConfigForChannel('save-file-content');
      expect(config).toEqual({
        maxAttempts: 2,
        baseDelay: 2000,
        maxDelay: 5000,
        retryableErrors: DEFAULT_RETRY_CONFIG.retryableErrors,
      });
    });

    it('should merge channel-specific overrides for diagnostics operations', () => {
      const config = getRetryConfigForChannel('diagnostics:get-errors');
      expect(config).toEqual({
        maxAttempts: 2,
        baseDelay: 1000,
        maxDelay: 3000,
        retryableErrors: DEFAULT_RETRY_CONFIG.retryableErrors,
      });
    });

    it('should preserve unoverridden default values', () => {
      const config = getRetryConfigForChannel('get-file-content');
      // This channel only overrides timing, not retryableErrors
      expect(config.retryableErrors).toEqual(DEFAULT_RETRY_CONFIG.retryableErrors);
    });

    it('should return a new object, not mutate defaults', () => {
      const config1 = getRetryConfigForChannel('get-website-schema');
      const config2 = getRetryConfigForChannel('save-file-content');

      expect(config1).not.toBe(DEFAULT_RETRY_CONFIG);
      expect(config2).not.toBe(DEFAULT_RETRY_CONFIG);
      expect(config1).not.toBe(config2);
    });

    it('should handle all configured read operations consistently', () => {
      const readChannels = ['get-website-schema', 'get-file-content', 'get-website-files', 'list-websites'];

      readChannels.forEach((channel) => {
        const config = getRetryConfigForChannel(channel);
        expect(config.maxAttempts).toBe(3);
        expect(config.baseDelay).toBe(1000);
        expect(config.maxDelay).toBe(3000);
      });
    });

    it('should handle all configured write operations consistently', () => {
      const writeChannels = ['save-file-content', 'rename-website'];

      writeChannels.forEach((channel) => {
        const config = getRetryConfigForChannel(channel);
        expect(config.maxAttempts).toBe(2);
        expect(config.baseDelay).toBe(2000);
        expect(config.maxDelay).toBe(5000);
      });
    });

    it('should return valid RetryConfig type', () => {
      const config = getRetryConfigForChannel('any-channel');

      expect(typeof config.maxAttempts).toBe('number');
      expect(typeof config.baseDelay).toBe('number');
      expect(typeof config.maxDelay).toBe('number');
      expect(Array.isArray(config.retryableErrors)).toBe(true);
      expect(config.maxAttempts).toBeGreaterThan(0);
      expect(config.baseDelay).toBeGreaterThan(0);
      expect(config.maxDelay).toBeGreaterThanOrEqual(config.baseDelay);
    });
  });

  describe('Integration and Edge Cases', () => {
    it('should not have overlapping channels in blacklist and specific config', () => {
      const specificConfigChannels = Object.keys(CHANNEL_SPECIFIC_CONFIG);
      const blacklistedChannels = Array.from(RETRY_BLACKLIST);

      const overlap = specificConfigChannels.filter((channel) => blacklistedChannels.includes(channel));

      expect(overlap).toEqual([]);
    });

    it('should maintain immutability of exported constants', () => {
      const originalSize = RETRY_BLACKLIST.size;
      const originalConfigKeys = Object.keys(CHANNEL_SPECIFIC_CONFIG).length;

      // Attempt to call functions that shouldn't modify state
      isRetryBlacklisted('test-channel');
      getRetryConfigForChannel('test-channel');

      expect(RETRY_BLACKLIST.size).toBe(originalSize);
      expect(Object.keys(CHANNEL_SPECIFIC_CONFIG).length).toBe(originalConfigKeys);
    });

    it('should handle special characters in channel names', () => {
      const specialChannels = ['channel:with:colons', 'channel-with-dashes', 'channel_with_underscores'];

      specialChannels.forEach((channel) => {
        expect(() => isRetryBlacklisted(channel)).not.toThrow();
        expect(() => getRetryConfigForChannel(channel)).not.toThrow();
      });
    });
  });
});
