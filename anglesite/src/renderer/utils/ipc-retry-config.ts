/**
 * IPC Retry Configuration
 *
 * Provides retry configuration for IPC communication between renderer and main processes.
 * Includes default retry settings, channel-specific overrides, and retry blacklists.
 */

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  retryableErrors: string[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 5000,
  retryableErrors: ['TIMEOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'Network error'],
};

// Blacklist of channels that should NEVER retry
export const RETRY_BLACKLIST: ReadonlySet<string> = new Set([
  'diagnostics:clear-errors',
  'diagnostics:export-errors',
  'diagnostics:toggle-window',
  'create-new-page',
  'start-website-dev-server',
  'diagnostics:subscribe-errors',
  'diagnostics:unsubscribe-errors',
  'diagnostics:dismiss-notification',
]);

// Channel-specific retry configuration overrides
export const CHANNEL_SPECIFIC_CONFIG: Readonly<Record<string, Partial<RetryConfig>>> = {
  // Read operations - faster retries
  'get-website-schema': { maxAttempts: 3, baseDelay: 1000, maxDelay: 3000 },
  'get-file-content': { maxAttempts: 3, baseDelay: 1000, maxDelay: 3000 },
  'get-website-files': { maxAttempts: 3, baseDelay: 1000, maxDelay: 3000 },
  'list-websites': { maxAttempts: 3, baseDelay: 1000, maxDelay: 3000 },

  // Write operations - more cautious retries
  'save-file-content': { maxAttempts: 2, baseDelay: 2000, maxDelay: 5000 },
  'rename-website': { maxAttempts: 2, baseDelay: 2000, maxDelay: 5000 },

  // Diagnostics operations
  'diagnostics:get-errors': { maxAttempts: 2, baseDelay: 1000, maxDelay: 3000 },
};

/**
 * Get effective retry configuration for a specific channel
 * Merges channel-specific overrides with default configuration.
 * If no channel-specific config exists, returns the default config.
 * @param channel The IPC channel name
 * @returns The effective retry configuration for the channel
 */
export function getRetryConfigForChannel(channel: string): RetryConfig {
  const channelConfig = CHANNEL_SPECIFIC_CONFIG[channel];
  return {
    ...DEFAULT_RETRY_CONFIG,
    ...channelConfig,
  };
}

/**
 * Check if a channel is blacklisted from retrying
 * Blacklisted channels should never retry failed IPC calls.
 * This is typically used for operations that have side effects
 * or should not be attempted multiple times.
 * @param channel The IPC channel name
 * @returns True if the channel is blacklisted, false otherwise
 */
export function isRetryBlacklisted(channel: string): boolean {
  return RETRY_BLACKLIST.has(channel);
}
