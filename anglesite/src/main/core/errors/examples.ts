/**
 * @file Error System Usage Examples.
 *
 * Demonstrates how to use the structured error handling system in Anglesite.
 * Shows best practices for error creation, handling, and recovery.
 */

import {
  AngleError,
  ErrorSeverity,
  ErrorCategory,
  ErrorUtils,
  withContext,
  withRetry,
  registerErrorHandler,
  addErrorBreadcrumb,
  WebsiteError,
  WebsiteNotFoundError,
  ServerStartError,
  FileNotFoundError,
  AtomicWriteError,
  RequiredFieldError,
  HandleErrors,
} from './index';

/**
 * Example 1: Basic error creation and throwing.
 */
export class WebsiteService {
  async loadWebsite(websiteId: string): Promise<unknown> {
    // Simulate website loading logic
    const websiteExists = Math.random() > 0.5;

    if (!websiteExists) {
      throw new WebsiteNotFoundError(websiteId, {
        operation: 'loadWebsite',
        context: { timestamp: new Date() },
      });
    }

    return { id: websiteId, name: 'Example Website' };
  }

  /**
   * Example 2: Using error handling with try/catch.
   */
  async getWebsites(): Promise<unknown[]> {
    try {
      // This method will throw an error for demonstration
      throw new WebsiteError('Database connection failed', 'DATABASE_CONNECTION_ERROR');
    } catch (error: unknown) {
      // Recovery strategy - return empty array on error
      console.warn(`Failed to get websites: ${(error as AngleError).message}`);
      return [];
    }
  }

  /**
   * Example 3: Using withContext for error enrichment.
   */
  async createWebsite(name: string, domain: string): Promise<unknown> {
    return await withContext(
      {
        operation: 'createWebsite',
        website: { id: undefined, domain },
        user: { id: 'user123', email: undefined },
      },
      async () => {
        // Add breadcrumb for context
        addErrorBreadcrumb(`Starting website creation for ${name}`, 'info', 'website');

        // Simulate validation
        if (!name || name.length < 3) {
          throw new RequiredFieldError('name');
        }

        // Simulate creation logic that might fail
        if (Math.random() > 0.7) {
          throw new Error('Random failure for demo');
        }

        return { id: 'website123', name, domain };
      }
    );
  }

  /**
   * Example 4: Using withRetry for network operations.
   */
  async publishWebsite(websiteId: string): Promise<void> {
    await withRetry(
      async () => {
        // Simulate network operation that might fail
        if (Math.random() > 0.6) {
          throw new Error('Network timeout');
        }

        console.log(`Website ${websiteId} published successfully`);
      },
      3, // max retries
      1000, // delay between retries
      { operation: 'publishWebsite', websiteId }
    );
  }
}

/**
 * Example 5: Custom error handling for specific scenarios.
 */
export class FileService {
  async saveFile(path: string, content: string): Promise<void> {
    try {
      // Simulate file operations
      if (path.includes('/restricted/')) {
        throw new Error('EACCES: permission denied');
      }

      if (Math.random() > 0.8) {
        throw new Error('ENOSPC: no space left on device');
      }

      console.log(`File saved: ${path} (${content.length} bytes)`);
    } catch (error) {
      // Transform native errors into our structured errors
      const nativeError = error as Error;

      if (nativeError.message.includes('EACCES')) {
        throw new FileNotFoundError(
          path,
          {
            operation: 'saveFile',
          },
          nativeError
        );
      }

      if (nativeError.message.includes('ENOSPC')) {
        throw new AtomicWriteError(
          path,
          'Insufficient disk space',
          {
            operation: 'saveFile',
          },
          nativeError
        );
      }

      // Wrap unknown errors
      throw ErrorUtils.wrap(error, {
        operation: 'saveFile',
        resource: path,
      });
    }
  }
}

/**
 * Example 6: Error handlers for different scenarios.
 */
export function setupErrorHandlers(): void {
  // Handler for critical errors - should alert operations
  registerErrorHandler('*', async (error: AngleError) => {
    if (error.severity === ErrorSeverity.CRITICAL) {
      // In a real app, this would send alerts
      console.error('🚨 CRITICAL ERROR DETECTED:', error.serialize());
    }
  });

  // Handler for website errors - log to website-specific logs
  registerErrorHandler('WebsiteError', async (error: AngleError) => {
    const websiteError = error as WebsiteError;
    console.log(`📝 Website error for ${websiteError.websiteId}:`, error.message);
  });

  // Handler for server errors - attempt service restart
  registerErrorHandler('ServerStartError', async (error: AngleError) => {
    const serverError = error as ServerStartError;
    console.log(`🔄 Attempting to restart server on port ${serverError.port}`);
    // Recovery logic would go here
  });

  // Handler for validation errors - collect metrics
  registerErrorHandler('ValidationError', async (error: AngleError) => {
    const validationError = error as RequiredFieldError;
    console.log(`📊 Validation error for field '${validationError.field}':`, error.message);
    // Metrics collection would go here
  });
}

/**
 * Example 7: Error analysis and reporting.
 */
export class ErrorAnalyzer {
  static analyzeErrors(errors: AngleError[]): {
    summary: string;
    recommendations: string[];
    criticalCount: number;
    recoverableCount: number;
  } {
    const stats = ErrorUtils.getStatistics(errors);
    const grouped = ErrorUtils.groupByCategory(errors);

    const recommendations: string[] = [];

    // Analyze patterns and provide recommendations
    if (stats.bySeverity.CRITICAL > 0) {
      recommendations.push('🚨 Critical errors detected - immediate attention required');
    }

    if (grouped.has(ErrorCategory.NETWORK) && grouped.get(ErrorCategory.NETWORK)!.length > 3) {
      recommendations.push('🌐 Multiple network errors - check connectivity');
    }

    if (grouped.has(ErrorCategory.FILE_SYSTEM) && grouped.get(ErrorCategory.FILE_SYSTEM)!.length > 2) {
      recommendations.push('💾 File system errors detected - check disk space and permissions');
    }

    if (stats.nonRecoverable > stats.recoverable) {
      recommendations.push('⚠️ High number of non-recoverable errors - investigate root causes');
    }

    const summary = `Analyzed ${stats.total} errors: ${stats.recoverable} recoverable, ${stats.nonRecoverable} non-recoverable`;

    return {
      summary,
      recommendations,
      criticalCount: stats.bySeverity.CRITICAL || 0,
      recoverableCount: stats.recoverable,
    };
  }

  static generateErrorReport(errors: AngleError[]): string {
    const analysis = this.analyzeErrors(errors);
    const lines: string[] = [];

    lines.push('# Error Analysis Report');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push(`## Summary`);
    lines.push(analysis.summary);
    lines.push('');

    if (analysis.recommendations.length > 0) {
      lines.push(`## Recommendations`);
      analysis.recommendations.forEach((rec) => lines.push(`- ${rec}`));
      lines.push('');
    }

    lines.push(`## Error Details`);
    errors.forEach((error, index) => {
      lines.push(`### Error ${index + 1}`);
      lines.push(`**Type:** ${error.constructor.name}`);
      lines.push(`**Code:** ${error.code}`);
      lines.push(`**Category:** ${error.category}`);
      lines.push(`**Severity:** ${error.severity}`);
      lines.push(`**Message:** ${error.message}`);
      lines.push(`**Timestamp:** ${error.timestamp.toISOString()}`);

      if (error.metadata.context) {
        lines.push(`**Context:** ${JSON.stringify(error.metadata.context, null, 2)}`);
      }

      lines.push('');
    });

    return lines.join('\n');
  }
}

/**
 * Example 8: Integration with existing Anglesite services.
 */
export class EnhancedWebsiteManager {
  async createWebsite(config: Record<string, unknown>): Promise<unknown> {
    return await withContext(
      {
        operation: 'createWebsite',
        website: { id: undefined, domain: config.domain as string },
      },
      async () => {
        try {
          // Use the existing atomic operations with enhanced error handling
          const result = await this.performAtomicWebsiteCreation(config);

          addErrorBreadcrumb(`Website created successfully: ${config.name}`, 'info', 'website');

          return result;
        } catch (error) {
          // Enhanced error context
          throw ErrorUtils.wrap(error, {
            operation: 'createWebsite',
            website: { id: undefined, domain: config.domain as string },
            timestamp: new Date().toISOString(),
          });
        }
      }
    );
  }

  private async performAtomicWebsiteCreation(config: Record<string, unknown>): Promise<unknown> {
    // This would use the enhanced atomic operations
    // which now throw structured errors
    return { id: 'website123', ...config };
  }
}

/**
 * Example 9: Testing error scenarios.
 */
export class ErrorTestingUtils {
  static async testErrorHandling(): Promise<void> {
    console.log('🧪 Testing error handling system...');

    const websiteService = new WebsiteService();

    // Test 1: Website not found
    try {
      await websiteService.loadWebsite('nonexistent');
    } catch (error) {
      console.log('✅ Caught WebsiteNotFoundError:', (error as AngleError).code);
    }

    // Test 2: Error recovery with decorator
    try {
      const result = await websiteService.getWebsites();
      console.log('✅ Recovery worked, got:', result);
    } catch (error) {
      console.log('❌ Recovery failed:', error);
    }

    // Test 3: Validation error with context
    try {
      await websiteService.createWebsite('ab', 'test.com');
    } catch (error) {
      const angleError = error as AngleError;
      console.log('✅ Validation error with context:', {
        code: angleError.code,
        severity: angleError.severity,
        context: angleError.metadata.context,
      });
    }

    console.log('🏁 Error handling tests completed');
  }
}

// Export example usage
export const ExampleUsage = {
  WebsiteService,
  FileService,
  setupErrorHandlers,
  ErrorAnalyzer,
  EnhancedWebsiteManager,
  ErrorTestingUtils,
};
