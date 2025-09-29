/**
 * @file Notification Service Registrar
 * @description Handles registration of notification-related services in the DI container
 */

import { DIContainer, ServiceKeys } from '../core/container';
import { IStore, IErrorReportingService, ISystemNotificationService } from '../core/interfaces';
import { ErrorDiagnosticsService } from './error-diagnostics-service';
import { SystemNotificationService } from './system-notification-service';
import { DiagnosticsWindowManager } from '../ui/diagnostics-window-manager';

/**
 * Register notification-related services in the DI container
 */
export function registerNotificationServices(container: DIContainer): void {
  // Register ErrorDiagnosticsService
  container.register(
    'ErrorDiagnosticsService',
    () => {
      const errorReportingService = container.resolve<IErrorReportingService>(ServiceKeys.ERROR_REPORTING);
      const storeService = container.resolve<IStore>(ServiceKeys.STORE);
      return new ErrorDiagnosticsService(errorReportingService, storeService);
    },
    'singleton',
    [ServiceKeys.ERROR_REPORTING, ServiceKeys.STORE]
  );

  // Register DiagnosticsWindowManager
  container.register(
    'DiagnosticsWindowManager',
    () => {
      const storeService = container.resolve<IStore>(ServiceKeys.STORE);
      return new DiagnosticsWindowManager(storeService);
    },
    'singleton',
    [ServiceKeys.STORE]
  );

  // Register SystemNotificationService
  container.register(
    ServiceKeys.SYSTEM_NOTIFICATION,
    () => {
      const errorDiagnosticsService = container.resolve<ErrorDiagnosticsService>('ErrorDiagnosticsService');
      const diagnosticsWindowManager = container.resolve<DiagnosticsWindowManager>('DiagnosticsWindowManager');
      const storeService = container.resolve<IStore>(ServiceKeys.STORE);

      return new SystemNotificationService(errorDiagnosticsService, diagnosticsWindowManager, storeService);
    },
    'singleton',
    ['ErrorDiagnosticsService', 'DiagnosticsWindowManager', ServiceKeys.STORE]
  );
}

/**
 * Initialize notification services after registration
 * This should be called after all services are registered
 */
export async function initializeNotificationServices(container: DIContainer): Promise<void> {
  // Initialize services in dependency order
  const errorDiagnosticsService = container.resolve<ErrorDiagnosticsService>('ErrorDiagnosticsService');
  const diagnosticsWindowManager = container.resolve<DiagnosticsWindowManager>('DiagnosticsWindowManager');
  const systemNotificationService = container.resolve<ISystemNotificationService>(ServiceKeys.SYSTEM_NOTIFICATION);

  // ErrorDiagnosticsService doesn't need explicit initialization - it starts polling in constructor
  // DiagnosticsWindowManager doesn't need explicit initialization - it's created on-demand

  // Initialize SystemNotificationService
  await systemNotificationService.initialize();
}
