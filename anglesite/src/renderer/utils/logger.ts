/**
 * @file Renderer process logging service
 * @description Provides environment-aware logging for the renderer process
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  component: string;
  message: string;
  data?: any;
  timestamp: Date;
}

class RendererLogger {
  private isDevelopment: boolean;
  private isDebugEnabled: boolean;
  private logBuffer: LogEntry[] = [];
  private maxBufferSize = 100;

  constructor() {
    // Check if we're in development mode
    this.isDevelopment = process.env.NODE_ENV !== 'production';
    // Allow debug logging to be enabled via localStorage for troubleshooting
    this.isDebugEnabled = this.isDevelopment || localStorage.getItem('DEBUG_LOGGING') === 'true';
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.isDebugEnabled && level === 'debug') {
      return false;
    }
    // Always log warnings and errors
    if (level === 'warn' || level === 'error') {
      return true;
    }
    // Only log info and debug in development
    return this.isDevelopment;
  }

  private addToBuffer(entry: LogEntry): void {
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }
  }

  private formatMessage(component: string, message: string): string {
    return `[${component}] ${message}`;
  }

  debug(component: string, message: string, data?: any): void {
    const entry: LogEntry = {
      level: 'debug',
      component,
      message,
      data,
      timestamp: new Date(),
    };

    this.addToBuffer(entry);

    if (this.shouldLog('debug')) {
      console.log(this.formatMessage(component, message), data || '');
    }
  }

  info(component: string, message: string, data?: any): void {
    const entry: LogEntry = {
      level: 'info',
      component,
      message,
      data,
      timestamp: new Date(),
    };

    this.addToBuffer(entry);

    if (this.shouldLog('info')) {
      console.info(this.formatMessage(component, message), data || '');
    }
  }

  warn(component: string, message: string, data?: any): void {
    const entry: LogEntry = {
      level: 'warn',
      component,
      message,
      data,
      timestamp: new Date(),
    };

    this.addToBuffer(entry);

    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage(component, message), data || '');
    }
  }

  error(component: string, message: string, error?: Error | any): void {
    const entry: LogEntry = {
      level: 'error',
      component,
      message,
      data: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      timestamp: new Date(),
    };

    this.addToBuffer(entry);

    if (this.shouldLog('error')) {
      console.error(this.formatMessage(component, message), error || '');
    }
  }

  /**
   * Get recent log entries for debugging
   */
  getLogBuffer(): LogEntry[] {
    return [...this.logBuffer];
  }

  /**
   * Clear the log buffer
   */
  clearBuffer(): void {
    this.logBuffer = [];
  }

  /**
   * Enable or disable debug logging at runtime
   */
  setDebugEnabled(enabled: boolean): void {
    this.isDebugEnabled = enabled;
    if (enabled) {
      localStorage.setItem('DEBUG_LOGGING', 'true');
    } else {
      localStorage.removeItem('DEBUG_LOGGING');
    }
  }
}

// Export singleton instance
export const logger = new RendererLogger();

// Export type for use in components
export type { LogEntry, LogLevel };