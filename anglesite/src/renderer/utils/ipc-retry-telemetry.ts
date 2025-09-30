import { logger } from './logger';

/**
 * IPC retry event for telemetry tracking
 */
export interface IPCRetryEvent {
  channel: string;
  attempt: number;
  totalAttempts: number;
  delay: number;
  error: Error;
  timestamp: number;
  success: boolean;
  totalDuration: number;
}

/**
 * Check if telemetry is enabled (cached for performance)
 */
let telemetryEnabled: boolean | null = null;
let telemetryCheckTime = 0;
const TELEMETRY_CHECK_TTL = 60000; // Re-check every 60 seconds

async function isTelemetryEnabled(): Promise<boolean> {
  const now = Date.now();

  // Return cached value if still valid
  if (telemetryEnabled !== null && now - telemetryCheckTime < TELEMETRY_CHECK_TTL) {
    return telemetryEnabled;
  }

  try {
    // Check if telemetry channel exists and is enabled
    const config = (await window.electronAPI.invoke('telemetry:get-config')) as { enabled?: boolean } | null;
    telemetryEnabled = config?.enabled === true;
    telemetryCheckTime = now;
    return telemetryEnabled;
  } catch (error) {
    // If telemetry not available, assume disabled
    logger.debug('IPC Retry Telemetry', 'Telemetry check failed, assuming disabled', error);
    telemetryEnabled = false;
    telemetryCheckTime = now;
    return false;
  }
}

/**
 * Record a retry attempt in telemetry system.
 * @param event Retry event details
 */
export async function recordRetryAttempt(event: IPCRetryEvent): Promise<void> {
  // Check if telemetry is enabled
  const enabled = await isTelemetryEnabled();
  if (!enabled) {
    return;
  }

  try {
    await window.electronAPI.invoke('telemetry:report-event', {
      timestamp: event.timestamp,
      error: {
        message: `IPC retry attempt ${event.attempt}/${event.totalAttempts}: ${event.channel}`,
        stack: event.error.stack,
      },
      component: {
        name: 'IPCRetryWrapper',
        hierarchy: ['Renderer', 'IPC', 'Retry'],
      },
      context: {
        channel: event.channel,
        attemptNumber: event.attempt,
        totalAttempts: event.totalAttempts,
        delay: event.delay,
        success: event.success,
        totalDuration: event.totalDuration,
        errorMessage: event.error.message,
      },
    });

    logger.debug('IPC Retry Telemetry', `Recorded retry attempt for ${event.channel}`, {
      attempt: event.attempt,
      success: event.success,
    });
  } catch (error) {
    // Don't throw if telemetry fails (non-critical)
    logger.warn('IPC Retry Telemetry', 'Failed to record retry attempt', error);
  }
}

/**
 * Record successful retry completion.
 * @param channel IPC channel name
 * @param attempts Total attempts made
 * @param duration Total duration in ms
 */
export async function recordRetrySuccess(channel: string, attempts: number, duration: number): Promise<void> {
  const enabled = await isTelemetryEnabled();
  if (!enabled) {
    return;
  }

  try {
    await window.electronAPI.invoke('telemetry:report-event', {
      timestamp: Date.now(),
      error: {
        message: `IPC retry succeeded after ${attempts} attempts: ${channel}`,
      },
      component: {
        name: 'IPCRetryWrapper',
        hierarchy: ['Renderer', 'IPC', 'Retry'],
      },
      context: {
        channel,
        totalAttempts: attempts,
        totalDuration: duration,
        finalResult: 'success',
      },
    });

    logger.debug('IPC Retry Telemetry', `Recorded retry success for ${channel}`, {
      attempts,
      duration,
    });
  } catch (error) {
    logger.warn('IPC Retry Telemetry', 'Failed to record retry success', error);
  }
}

/**
 * Record final retry failure and report to diagnostics.
 * @param channel IPC channel name
 * @param error Final error
 * @param attempts Total attempts made
 * @param duration Total duration in ms
 */
export async function recordRetryFailure(
  channel: string,
  error: Error,
  attempts: number,
  duration: number
): Promise<void> {
  const enabled = await isTelemetryEnabled();

  // Always log locally, even if telemetry disabled
  logger.error('IPC Retry Telemetry', `Retry failed after ${attempts} attempts: ${channel}`, {
    error,
    channel,
    attempts,
    duration,
  });

  if (!enabled) {
    return;
  }

  try {
    await window.electronAPI.invoke('telemetry:report-event', {
      timestamp: Date.now(),
      error: {
        message: `IPC retry failed after ${attempts} attempts: ${channel}`,
        stack: error.stack,
      },
      component: {
        name: 'IPCRetryWrapper',
        hierarchy: ['Renderer', 'IPC', 'Retry'],
      },
      context: {
        channel,
        totalAttempts: attempts,
        totalDuration: duration,
        finalResult: 'failure',
        errorMessage: error.message,
      },
    });

    logger.debug('IPC Retry Telemetry', `Recorded retry failure for ${channel}`, {
      attempts,
      duration,
    });
  } catch (telemetryError) {
    logger.warn('IPC Retry Telemetry', 'Failed to record retry failure', telemetryError);
  }
}

/**
 * Reset telemetry cache (for testing).
 */
export function resetTelemetryCache(): void {
  telemetryEnabled = null;
  telemetryCheckTime = 0;
}
