import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { DIContainer } from '../core/container';
import { TelemetryService } from '../services/telemetry-service';
import { TelemetryEvent, TelemetryQuery, TelemetryExport } from '../types/telemetry';

export function registerTelemetryHandlers(container: DIContainer): void {
  const telemetryService = container.resolve<TelemetryService>('telemetry');

  // Report batch of telemetry events from renderer
  ipcMain.handle(
    'telemetry:report-batch',
    async (
      event: IpcMainInvokeEvent,
      batch: Partial<TelemetryEvent>[]
    ): Promise<{ success: boolean; processed: number }> => {
      try {
        let processed = 0;

        for (const eventData of batch) {
          const result = await telemetryService.recordEvent(eventData);
          if (result) {
            processed++;
          }
        }

        return { success: true, processed };
      } catch (error) {
        console.error('Failed to process telemetry batch:', error);
        return { success: false, processed: 0 };
      }
    }
  );

  // Get telemetry configuration
  ipcMain.handle('telemetry:get-config', async (): Promise<any> => {
    try {
      const config = telemetryService.getConfig();

      // Return only renderer-relevant config
      return {
        enabled: config.enabled,
        samplingRate: config.samplingRate,
        batchSize: config.maxBatchSize,
        batchIntervalMs: config.batchIntervalMs,
        anonymize: config.anonymizeErrors,
      };
    } catch (error) {
      console.error('Failed to get telemetry config:', error);
      return null;
    }
  });

  // Update telemetry configuration
  ipcMain.handle('telemetry:update-config', async (event: IpcMainInvokeEvent, config: any): Promise<boolean> => {
    try {
      await telemetryService.configure(config);

      // Broadcast config update to all renderers
      const { webContents } = require('electron');
      webContents.getAllWebContents().forEach((wc) => {
        if (!wc.isDestroyed()) {
          wc.send('telemetry:config-updated', config);
        }
      });

      return true;
    } catch (error) {
      console.error('Failed to update telemetry config:', error);
      return false;
    }
  });

  // Query telemetry events
  ipcMain.handle(
    'telemetry:query',
    async (event: IpcMainInvokeEvent, query: TelemetryQuery): Promise<TelemetryEvent[]> => {
      try {
        return await telemetryService.queryEvents(query);
      } catch (error) {
        console.error('Failed to query telemetry events:', error);
        return [];
      }
    }
  );

  // Get telemetry statistics
  ipcMain.handle('telemetry:get-stats', async (): Promise<any> => {
    try {
      return await telemetryService.getStats();
    } catch (error) {
      console.error('Failed to get telemetry stats:', error);
      return null;
    }
  });

  // Export telemetry data
  ipcMain.handle(
    'telemetry:export',
    async (
      event: IpcMainInvokeEvent,
      exportConfig: TelemetryExport
    ): Promise<{ success: boolean; data?: string; error?: string }> => {
      try {
        const events = await telemetryService.queryEvents(exportConfig.query || {});

        let exportData: string;

        switch (exportConfig.format) {
          case 'json':
            exportData = JSON.stringify(events, null, 2);
            break;

          case 'ndjson':
            exportData = events.map((e) => JSON.stringify(e)).join('\n');
            break;

          case 'csv':
            exportData = convertToCSV(events);
            break;

          default:
            throw new Error(`Unsupported export format: ${exportConfig.format}`);
        }

        // Anonymize if requested
        if (exportConfig.anonymize) {
          exportData = anonymizeExportData(exportData);
        }

        return { success: true, data: exportData };
      } catch (error) {
        console.error('Failed to export telemetry data:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Clear telemetry data
  ipcMain.handle(
    'telemetry:clear',
    async (event: IpcMainInvokeEvent, options: { before?: number; componentName?: string }): Promise<boolean> => {
      try {
        // This would need to be implemented in TelemetryService
        // For now, return false
        console.log('Clear telemetry requested with options:', options);
        return false;
      } catch (error) {
        console.error('Failed to clear telemetry:', error);
        return false;
      }
    }
  );

  // Test error for debugging
  ipcMain.handle('telemetry:test-error', async (): Promise<void> => {
    try {
      // Generate a test error
      const testEvent: Partial<TelemetryEvent> = {
        error: {
          message: 'Test telemetry error',
          stack: new Error('Test error').stack,
        },
        component: {
          name: 'TestComponent',
          hierarchy: ['App', 'TestContainer', 'TestComponent'],
        },
        context: {
          route: '/test',
          userAction: 'test:button-click',
        },
      };

      await telemetryService.recordEvent(testEvent);
    } catch (error) {
      console.error('Failed to generate test error:', error);
    }
  });
}

function convertToCSV(events: TelemetryEvent[]): string {
  if (events.length === 0) return '';

  const headers = [
    'id',
    'timestamp',
    'sessionId',
    'version',
    'environment',
    'error_message',
    'component_name',
    'component_hierarchy',
    'route',
    'user_action',
    'platform',
    'electron_version',
  ];

  const rows = events.map((event) => [
    event.id,
    new Date(event.timestamp).toISOString(),
    event.sessionId,
    event.version,
    event.environment,
    escapeCSV(event.error.message),
    event.component?.name || '',
    event.component?.hierarchy.join(' > ') || '',
    event.context?.route || '',
    event.context?.userAction || '',
    event.system.platform,
    event.system.electronVersion,
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function anonymizeExportData(data: string): string {
  const patterns = [
    { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[EMAIL]' },
    { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[IP]' },
    { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },
    { pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, replacement: '[CC]' },
    { pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: '[PHONE]' },
  ];

  let result = data;
  for (const { pattern, replacement } of patterns) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
