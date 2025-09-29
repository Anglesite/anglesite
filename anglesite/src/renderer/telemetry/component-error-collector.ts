import { ipcRenderer } from 'electron';
import { TelemetryEvent } from '../../main/types/telemetry';

interface CollectorConfig {
  enabled: boolean;
  batchSize: number;
  batchIntervalMs: number;
  samplingRate: number;
  anonymize?: boolean;
}

interface ErrorContext {
  componentName: string;
  componentHierarchy?: string[];
  props?: Record<string, unknown>;
  state?: Record<string, unknown>;
  route?: string;
  userAction?: string;
  websiteId?: string;
}

const DEFAULT_CONFIG: CollectorConfig = {
  enabled: false,
  batchSize: 10,
  batchIntervalMs: 30000,
  samplingRate: 1.0,
  anonymize: true,
};

const MAX_MESSAGE_LENGTH = 10000;
const MAX_STACK_LENGTH = 50000;
const MAX_PROPS_SIZE = 10240; // 10KB

export class ComponentErrorCollector {
  private static instance: ComponentErrorCollector;
  private config: CollectorConfig = DEFAULT_CONFIG;
  private eventBatch: Partial<TelemetryEvent>[] = [];
  private batchTimer?: NodeJS.Timeout;
  private sessionId: string;
  private userAction?: { type: string; target: string };
  private websiteId?: string;

  private constructor() {
    this.sessionId = this.generateSessionId();
    this.loadConfig();
  }

  static getInstance(): ComponentErrorCollector {
    if (!ComponentErrorCollector.instance) {
      ComponentErrorCollector.instance = new ComponentErrorCollector();
    }
    return ComponentErrorCollector.instance;
  }

  configure(config: Partial<CollectorConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart batch timer if interval changed
    if (config.batchIntervalMs !== undefined && this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.ensureBatchTimer();
    }
  }

  captureError(error: Error, context: ErrorContext): boolean {
    if (!this.config.enabled) {
      return false;
    }

    // Check sampling
    if (!this.shouldSample()) {
      return false;
    }

    // Create telemetry event
    const event = this.createEvent(error, context);

    // Add to batch
    this.eventBatch.push(event);

    // Check if batch should be sent
    if (this.eventBatch.length >= this.config.batchSize) {
      this.sendBatch();
    } else {
      this.ensureBatchTimer();
    }

    return true;
  }

  setUserAction(type: string, target: string): void {
    this.userAction = { type, target };
  }

  setWebsiteContext(websiteId: string): void {
    this.websiteId = websiteId;
  }

  collectContext(): { route?: string; userAction?: string; websiteId?: string } {
    const context: any = {};

    // Collect route
    if (typeof window !== 'undefined' && window.location) {
      context.route = window.location.pathname;
    }

    // Collect user action (and clear it)
    if (this.userAction) {
      context.userAction = `${this.userAction.type}:${this.userAction.target}`;
      this.userAction = undefined;
    }

    // Collect website context
    if (this.websiteId) {
      context.websiteId = this.websiteId;
    }

    return context;
  }

  reset(): void {
    this.eventBatch = [];
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }
    this.userAction = undefined;
    this.websiteId = undefined;
  }

  private shouldSample(): boolean {
    return Math.random() < this.config.samplingRate;
  }

  private createEvent(error: Error, context: ErrorContext): Partial<TelemetryEvent> {
    const collectedContext = this.collectContext();

    const event: Partial<TelemetryEvent> = {
      timestamp: Date.now(),
      sessionId: this.sessionId,
      error: {
        message: this.truncateString(error.message, MAX_MESSAGE_LENGTH),
        stack: error.stack ? this.truncateString(error.stack, MAX_STACK_LENGTH) : undefined,
        componentStack: (error as any).componentStack,
      },
      component: {
        name: context.componentName,
        hierarchy: context.componentHierarchy || [],
        props: context.props ? this.sanitizeProps(context.props) : undefined,
        state: context.state ? this.sanitizeProps(context.state) : undefined,
      },
      context: {
        ...collectedContext,
        route: collectedContext.route || context.route,
      },
    };

    // Anonymize if configured
    if (this.config.anonymize) {
      this.anonymizeEvent(event);
    }

    return event;
  }

  private truncateString(str: string, maxLength: number): string {
    if (str.length <= maxLength) {
      return str;
    }
    return str.substring(0, maxLength - 15) + '...[truncated]';
  }

  private sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
    try {
      // Remove circular references and limit size
      const seen = new WeakSet();

      const sanitize = (obj: any, depth = 0): any => {
        if (depth > 10) return '[Max Depth]';
        if (obj === null || typeof obj !== 'object') return obj;
        if (seen.has(obj)) return '[Circular]';

        seen.add(obj);

        if (Array.isArray(obj)) {
          return obj.slice(0, 100).map((v) => sanitize(v, depth + 1));
        }

        const result: any = {};
        let size = 0;

        for (const [key, value] of Object.entries(obj)) {
          if (size > MAX_PROPS_SIZE) break;

          const sanitized = sanitize(value, depth + 1);
          result[key] = sanitized;
          size += JSON.stringify({ [key]: sanitized }).length;
        }

        return result;
      };

      return sanitize(props);
    } catch (error) {
      console.error('Failed to sanitize props:', error);
      return { error: 'Failed to sanitize' };
    }
  }

  private anonymizeEvent(event: Partial<TelemetryEvent>): void {
    const patterns = [
      { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
      { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[REDACTED_IP]' },
      { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED_SSN]' },
      { pattern: /\b(?:api[_-]?key|apikey|token)["\s:=]+["']?[\w-]{20,}["']?/gi, replacement: '[REDACTED_KEY]' },
    ];

    // Anonymize error message
    if (event.error?.message) {
      for (const { pattern, replacement } of patterns) {
        event.error.message = event.error.message.replace(pattern, replacement);
      }
    }

    // Anonymize error stack
    if (event.error?.stack) {
      for (const { pattern, replacement } of patterns) {
        event.error.stack = event.error.stack.replace(pattern, replacement);
      }
    }

    // Anonymize props
    if (event.component?.props) {
      event.component.props = this.anonymizeObject(event.component.props, patterns);
    }
  }

  private anonymizeObject(
    obj: Record<string, unknown>,
    patterns: Array<{ pattern: RegExp; replacement: string }>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      // Skip sensitive keys entirely
      if (/email|password|token|key|secret|ssn|credit/i.test(key)) {
        result[key] = '[REDACTED]';
        continue;
      }

      if (typeof value === 'string') {
        let anonymized = value;
        for (const { pattern, replacement } of patterns) {
          anonymized = anonymized.replace(pattern, replacement);
        }
        result[key] = anonymized;
      } else if (value && typeof value === 'object') {
        result[key] = Array.isArray(value)
          ? value.map((v) => (typeof v === 'string' ? this.anonymizeString(v, patterns) : v))
          : this.anonymizeObject(value as Record<string, unknown>, patterns);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private anonymizeString(str: string, patterns: Array<{ pattern: RegExp; replacement: string }>): string {
    let result = str;
    for (const { pattern, replacement } of patterns) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  private ensureBatchTimer(): void {
    if (!this.batchTimer && this.eventBatch.length > 0) {
      this.batchTimer = setTimeout(() => {
        this.sendBatch();
      }, this.config.batchIntervalMs);
    }
  }

  private sendBatch(): void {
    if (this.eventBatch.length === 0) return;

    const batch = [...this.eventBatch];
    this.eventBatch = [];

    // Clear timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }

    // Send to main process
    ipcRenderer.invoke('telemetry:report-batch', batch).catch((error) => {
      console.error('Failed to send telemetry batch:', error);
    });
  }

  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private loadConfig(): void {
    // Load config from main process
    ipcRenderer
      .invoke('telemetry:get-config')
      .then((config) => {
        if (config) {
          this.config = { ...DEFAULT_CONFIG, ...config };
        }
      })
      .catch((error) => {
        console.error('Failed to load telemetry config:', error);
      });

    // Listen for config updates
    ipcRenderer.on('telemetry:config-updated', (event, config) => {
      this.config = { ...DEFAULT_CONFIG, ...config };
    });
  }
}
