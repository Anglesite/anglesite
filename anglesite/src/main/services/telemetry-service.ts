import { randomUUID } from 'crypto';
import { IStore } from '../core/interfaces';
import Database from 'better-sqlite3';
import { TelemetryConfig, TelemetryEndpoint, TelemetryEvent, TelemetryQuery, TelemetryStats } from '../types/telemetry';

const DEFAULT_CONFIG: TelemetryConfig = {
  enabled: false,
  samplingRate: 1.0,
  maxBatchSize: 100,
  batchIntervalMs: 30000,
  maxStorageMb: 10,
  retentionDays: 30,
  anonymizeErrors: true,
  endpoints: [],
};

const PII_PATTERNS = [
  // Email addresses
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
  // IP addresses
  { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[REDACTED_IP]' },
  // Social Security Numbers
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED_SSN]' },
  // Credit card numbers
  { pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, replacement: '[REDACTED_CC]' },
  // Phone numbers
  { pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: '[REDACTED_PHONE]' },
  // API keys (common patterns)
  {
    pattern: /\b(?:api[_-]?key|apikey|api[_-]?token)["\s:=]+["']?[\w-]{20,}["']?/gi,
    replacement: '[REDACTED_API_KEY]',
  },
];

export class TelemetryService {
  private config: TelemetryConfig = DEFAULT_CONFIG;
  private sessionId: string = randomUUID();
  private eventBatch: TelemetryEvent[] = [];
  private batchTimer?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  private isInitialized = false;

  constructor(
    private storeService: IStore,
    private db: Database.Database
  ) {}

  async initialize(): Promise<void> {
    try {
      // Load configuration from store
      const storedConfig = this.storeService.get('telemetryConfig');
      if (storedConfig) {
        this.config = { ...DEFAULT_CONFIG, ...storedConfig, endpoints: [] };
      }

      // Initialize database schema
      this.initializeDatabase();

      // Start cleanup interval
      this.startCleanupInterval();

      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize telemetry:', error);
      throw new Error('Failed to initialize telemetry');
    }
  }

  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS telemetry_events (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        version TEXT NOT NULL,
        environment TEXT NOT NULL,
        error_message TEXT NOT NULL,
        error_stack TEXT,
        component_name TEXT,
        component_hierarchy TEXT,
        context TEXT,
        system_info TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_telemetry_component ON telemetry_events(component_name);
      CREATE INDEX IF NOT EXISTS idx_telemetry_error ON telemetry_events(error_message);
      CREATE INDEX IF NOT EXISTS idx_telemetry_created ON telemetry_events(created_at);
    `);
  }

  async configure(config: Partial<TelemetryConfig>): Promise<void> {
    // Validate configuration
    this.validateConfig(config);

    // Merge with existing config
    this.config = { ...this.config, ...config };

    // Save to store (excluding endpoints which are runtime-only)
    const { endpoints, ...configToSave } = this.config;
    this.storeService.set('telemetryConfig', configToSave);

    // Restart batch timer if interval changed
    if (config.batchIntervalMs !== undefined) {
      this.restartBatchTimer();
    }
  }

  private validateConfig(config: Partial<TelemetryConfig>): void {
    if (config.samplingRate !== undefined) {
      if (config.samplingRate < 0 || config.samplingRate > 1) {
        throw new Error('Invalid configuration: samplingRate must be between 0 and 1');
      }
    }

    if (config.maxBatchSize !== undefined && config.maxBatchSize < 1) {
      throw new Error('Invalid configuration: maxBatchSize must be positive');
    }

    if (config.maxStorageMb !== undefined && config.maxStorageMb <= 0) {
      throw new Error('Invalid configuration: maxStorageMb must be positive');
    }

    if (config.retentionDays !== undefined) {
      if (config.retentionDays < 1 || config.retentionDays > 365) {
        throw new Error('Invalid configuration: retentionDays must be between 1 and 365');
      }
    }
  }

  getConfig(): TelemetryConfig {
    return { ...this.config };
  }

  async recordEvent(eventData: Partial<TelemetryEvent>): Promise<TelemetryEvent | null> {
    // Check if telemetry is enabled
    if (!this.config.enabled || !this.isInitialized) {
      return null;
    }

    // Check sampling rate
    if (!this.shouldSample()) {
      return null;
    }

    // Create full event
    const event = this.createEvent(eventData);

    // Anonymize if configured
    if (this.config.anonymizeErrors) {
      this.anonymizeEvent(event);
    }

    // Sanitize circular references
    this.sanitizeEvent(event);

    // Add to batch
    this.eventBatch.push(event);

    // Check if batch should be processed
    if (this.eventBatch.length >= this.config.maxBatchSize) {
      await this.processBatch();
    } else {
      this.ensureBatchTimer();
    }

    return event;
  }

  private shouldSample(): boolean {
    return Math.random() < this.config.samplingRate;
  }

  private createEvent(eventData: Partial<TelemetryEvent>): TelemetryEvent {
    const { app } = require('electron');

    return {
      id: randomUUID(),
      timestamp: Date.now(),
      sessionId: this.sessionId,
      version: app.getVersion(),
      environment:
        process.env.NODE_ENV === 'production' ? 'production' : process.env.NODE_ENV === 'test' ? 'test' : 'development',
      error: eventData.error || { message: 'Unknown error' },
      component: eventData.component,
      context: eventData.context,
      system: {
        platform: process.platform,
        electronVersion: process.versions.electron || 'unknown',
        nodeVersion: process.versions.node,
        memory: {
          used: process.memoryUsage().heapUsed,
          total: process.memoryUsage().heapTotal,
        },
      },
    };
  }

  private anonymizeEvent(event: TelemetryEvent): void {
    // Anonymize error message and stack
    if (event.error.message) {
      event.error.message = this.anonymizeString(event.error.message);
    }
    if (event.error.stack) {
      event.error.stack = this.anonymizeString(event.error.stack);
    }

    // Anonymize component props and state
    if (event.component?.props) {
      event.component.props = this.anonymizeObject(event.component.props);
    }
    if (event.component?.state) {
      event.component.state = this.anonymizeObject(event.component.state);
    }
  }

  private anonymizeString(str: string): string {
    let result = str;
    for (const { pattern, replacement } of PII_PATTERNS) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  private anonymizeObject(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.anonymizeString(value);
      } else if (value && typeof value === 'object') {
        result[key] = Array.isArray(value)
          ? value.map((v) => (typeof v === 'string' ? this.anonymizeString(v) : v))
          : this.anonymizeObject(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private sanitizeEvent(event: TelemetryEvent): void {
    // Remove circular references
    const seen = new WeakSet();

    const sanitize = (obj: any): any => {
      if (obj === null || typeof obj !== 'object') return obj;
      if (seen.has(obj)) return '[Circular]';

      seen.add(obj);

      if (Array.isArray(obj)) {
        return obj.map(sanitize);
      }

      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = sanitize(value);
      }
      return result;
    };

    if (event.component) {
      event.component = sanitize(event.component);
    }
    if (event.context) {
      event.context = sanitize(event.context);
    }
  }

  private async processBatch(): Promise<void> {
    if (this.eventBatch.length === 0) return;

    const batch = [...this.eventBatch];
    this.eventBatch = [];

    // Store in database
    await this.storeEvents(batch);

    // Send to endpoints if configured
    await this.transmitEvents(batch);

    // Clear batch timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }
  }

  private async storeEvents(events: TelemetryEvent[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO telemetry_events (
        id, timestamp, session_id, version, environment,
        error_message, error_stack, component_name, component_hierarchy,
        context, system_info
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((events: TelemetryEvent[]) => {
      for (const event of events) {
        stmt.run(
          event.id,
          event.timestamp,
          event.sessionId,
          event.version,
          event.environment,
          event.error.message,
          event.error.stack || null,
          event.component?.name || null,
          event.component?.hierarchy ? JSON.stringify(event.component.hierarchy) : null,
          event.context ? JSON.stringify(event.context) : null,
          JSON.stringify(event.system)
        );
      }
    });

    try {
      insertMany(events);
      await this.enforceStorageLimit();
    } catch (error) {
      console.error('Failed to store telemetry events:', error);
    }
  }

  private async transmitEvents(events: TelemetryEvent[]): Promise<void> {
    const enabledEndpoints = this.config.endpoints?.filter((e) => e.enabled) || [];

    for (const endpoint of enabledEndpoints) {
      const filteredEvents = endpoint.filter ? events.filter(endpoint.filter) : events;

      if (filteredEvents.length > 0) {
        this.sendToEndpoint(endpoint, filteredEvents).catch((error) => {
          console.error(`Failed to send telemetry to ${endpoint.url}:`, error);
        });
      }
    }
  }

  private async sendToEndpoint(endpoint: TelemetryEndpoint, events: TelemetryEvent[]): Promise<void> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (endpoint.apiKey) {
      headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
    }

    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ events }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }

  private ensureBatchTimer(): void {
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.processBatch();
      }, this.config.batchIntervalMs);
    }
  }

  private restartBatchTimer(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }
    if (this.eventBatch.length > 0) {
      this.ensureBatchTimer();
    }
  }

  private startCleanupInterval(): void {
    // Run cleanup every 6 hours
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupOldEvents();
      },
      6 * 60 * 60 * 1000
    );
  }

  async cleanupOldEvents(): Promise<void> {
    const cutoffTime = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;

    try {
      this.deleteOldEvents(cutoffTime);
    } catch (error) {
      console.error('Failed to cleanup old telemetry events:', error);
    }
  }

  private deleteOldEvents(cutoffTime: number): void {
    const stmt = this.db.prepare('DELETE FROM telemetry_events WHERE timestamp < ?');
    stmt.run(cutoffTime);
  }

  private async enforceStorageLimit(): Promise<void> {
    const stats = this.getStorageStats();

    if (stats.storageMb > this.config.maxStorageMb) {
      // Delete oldest events to get under limit
      const excessMb = stats.storageMb - this.config.maxStorageMb;
      const eventsToDelete = Math.ceil((excessMb / stats.storageMb) * stats.totalEvents);

      const stmt = this.db.prepare(`
        DELETE FROM telemetry_events
        WHERE id IN (
          SELECT id FROM telemetry_events
          ORDER BY timestamp ASC
          LIMIT ?
        )
      `);

      stmt.run(eventsToDelete);
    }
  }

  private getStorageStats(): { totalEvents: number; storageMb: number } {
    const countResult = this.db.prepare('SELECT COUNT(*) as count FROM telemetry_events').get() as { count: number };
    const sizeResult = this.db
      .prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()')
      .get() as { size: number };

    return {
      totalEvents: countResult.count,
      storageMb: sizeResult.size / (1024 * 1024),
    };
  }

  async queryEvents(query: TelemetryQuery = {}): Promise<TelemetryEvent[]> {
    let sql = 'SELECT * FROM telemetry_events WHERE 1=1';
    const params: any[] = [];

    if (query.startTime) {
      sql += ' AND timestamp >= ?';
      params.push(query.startTime);
    }

    if (query.endTime) {
      sql += ' AND timestamp <= ?';
      params.push(query.endTime);
    }

    if (query.componentName) {
      sql += ' AND component_name = ?';
      params.push(query.componentName);
    }

    if (query.errorMessage) {
      sql += ' AND error_message LIKE ?';
      params.push(`%${query.errorMessage}%`);
    }

    sql += ` ORDER BY ${query.orderBy || 'timestamp'} ${query.order || 'desc'}`;

    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      sessionId: row.session_id,
      version: row.version,
      environment: row.environment,
      error: {
        message: row.error_message,
        stack: row.error_stack,
      },
      component: row.component_name
        ? {
            name: row.component_name,
            hierarchy: row.component_hierarchy ? JSON.parse(row.component_hierarchy) : [],
          }
        : undefined,
      context: row.context ? JSON.parse(row.context) : undefined,
      system: JSON.parse(row.system_info),
    }));
  }

  async getStats(): Promise<TelemetryStats> {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    const stats = {
      totalEvents: 0,
      eventsLast24h: 0,
      eventsLast7d: 0,
      eventsLast30d: 0,
      topErrors: [] as any[],
      topComponents: [] as any[],
      storageUsedMb: 0,
    };

    // Get event counts
    const counts = this.db
      .prepare(
        `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN timestamp > ? THEN 1 ELSE 0 END) as last24h,
        SUM(CASE WHEN timestamp > ? THEN 1 ELSE 0 END) as last7d,
        SUM(CASE WHEN timestamp > ? THEN 1 ELSE 0 END) as last30d
      FROM telemetry_events
    `
      )
      .get(now - day, now - 7 * day, now - 30 * day) as any;

    stats.totalEvents = counts.total;
    stats.eventsLast24h = counts.last24h;
    stats.eventsLast7d = counts.last7d;
    stats.eventsLast30d = counts.last30d;

    // Get top errors
    const topErrors = this.db
      .prepare(
        `
      SELECT error_message as message, COUNT(*) as count, MAX(timestamp) as lastSeen
      FROM telemetry_events
      WHERE timestamp > ?
      GROUP BY error_message
      ORDER BY count DESC
      LIMIT 10
    `
      )
      .all(now - 7 * day) as any[];

    stats.topErrors = topErrors;

    // Get top components with errors
    const topComponents = this.db
      .prepare(
        `
      SELECT component_name as name, COUNT(*) as errorCount
      FROM telemetry_events
      WHERE component_name IS NOT NULL AND timestamp > ?
      GROUP BY component_name
      ORDER BY errorCount DESC
      LIMIT 10
    `
      )
      .all(now - 7 * day) as any[];

    stats.topComponents = topComponents;

    // Get storage size
    const storageStats = this.getStorageStats();
    stats.storageUsedMb = storageStats.storageMb;

    return stats;
  }

  async shutdown(): Promise<void> {
    // Process remaining batch
    await this.processBatch();

    // Clear timers
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close database
    this.db.close();

    this.isInitialized = false;
  }
}
