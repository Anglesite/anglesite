/**
 * @file MonitorManager service implementation
 *
 * Provides multi-monitor awareness for window state persistence, including
 * intelligent window placement, monitor configuration detection, and fallback
 * logic for handling monitor disconnections and resolution changes.
 */

import { screen, Display } from 'electron';
import {
  MonitorInfo,
  MonitorConfiguration,
  WindowState,
  Rectangle,
  RelativePosition,
  validateMonitorConfiguration,
} from '../core/types';
import { IMonitorManager } from '../core/interfaces';

export class MonitorManager implements IMonitorManager {
  private cachedConfiguration: MonitorConfiguration | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_DURATION = 5000; // 5 seconds

  // Event handler references for cleanup
  private displayAddedHandler: (() => void) | null = null;
  private displayRemovedHandler: (() => void) | null = null;
  private displayMetricsChangedHandler: (() => void) | null = null;

  constructor() {
    this.setupEventListeners();
  }

  /**
   * Set up screen event listeners to invalidate cache when displays change.
   */
  private setupEventListeners(): void {
    this.displayAddedHandler = () => this.invalidateCache();
    this.displayRemovedHandler = () => this.invalidateCache();
    this.displayMetricsChangedHandler = () => this.invalidateCache();

    screen.on('display-added', this.displayAddedHandler);
    screen.on('display-removed', this.displayRemovedHandler);
    screen.on('display-metrics-changed', this.displayMetricsChangedHandler);
  }

  /**
   * Invalidate the cached monitor configuration.
   */
  private invalidateCache(): void {
    this.cachedConfiguration = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Convert Electron Display to MonitorInfo.
   */
  private convertDisplayToMonitorInfo(display: Display, isPrimary: boolean): MonitorInfo {
    return {
      id: display.id,
      bounds: {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
      },
      workAreaBounds: {
        x: display.workArea.x,
        y: display.workArea.y,
        width: display.workArea.width,
        height: display.workArea.height,
      },
      scaleFactor: display.scaleFactor,
      primary: isPrimary,
      label: undefined, // Electron doesn't provide display labels consistently
    };
  }

  /**
   * Get current monitor configuration, with caching for performance.
   */
  getCurrentConfiguration(): MonitorConfiguration {
    const now = Date.now();

    // Return cached configuration if still valid
    if (this.cachedConfiguration && now - this.cacheTimestamp < this.CACHE_DURATION) {
      return this.cachedConfiguration;
    }

    try {
      const displays = screen.getAllDisplays();
      const primaryDisplay = screen.getPrimaryDisplay();

      if (displays.length === 0) {
        throw new Error('No displays detected');
      }

      const monitors: MonitorInfo[] = displays.map((display) =>
        this.convertDisplayToMonitorInfo(display, display.id === primaryDisplay.id)
      );

      const configuration: MonitorConfiguration = {
        monitors,
        primaryMonitorId: primaryDisplay.id,
        timestamp: now,
      };

      // Validate the configuration before caching
      if (!validateMonitorConfiguration(configuration)) {
        throw new Error('Invalid monitor configuration detected');
      }

      // Cache the configuration
      this.cachedConfiguration = configuration;
      this.cacheTimestamp = now;

      return configuration;
    } catch (error) {
      console.error('Failed to get monitor configuration:', error);

      // Fallback to minimal single monitor configuration
      const fallbackMonitor: MonitorInfo = {
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workAreaBounds: { x: 0, y: 25, width: 1920, height: 1055 },
        scaleFactor: 1.0,
        primary: true,
      };

      return {
        monitors: [fallbackMonitor],
        primaryMonitorId: 1,
        timestamp: now,
      };
    }
  }

  /**
   * Refresh monitor configuration by invalidating cache and re-detecting.
   */
  async refreshConfiguration(): Promise<MonitorConfiguration> {
    this.invalidateCache();
    return this.getCurrentConfiguration();
  }

  /**
   * Find the best monitor for placing a window based on saved state.
   */
  findBestMonitorForWindow(savedState: WindowState): MonitorInfo {
    const currentConfig = this.getCurrentConfiguration();

    // Strategy 1: Use explicitly specified target monitor if available
    if (savedState.targetMonitorId !== undefined) {
      const targetMonitor = currentConfig.monitors.find((m) => m.id === savedState.targetMonitorId);
      if (targetMonitor) {
        return targetMonitor;
      }
      console.log(`Target monitor ${savedState.targetMonitorId} not found, falling back`);
    }

    // Strategy 2: Use window bounds to determine which monitor it was on
    if (savedState.bounds) {
      const windowCenter = {
        x: savedState.bounds.x + savedState.bounds.width / 2,
        y: savedState.bounds.y + savedState.bounds.height / 2,
      };

      // Find monitor that contains the window center
      for (const monitor of currentConfig.monitors) {
        if (this.pointInRectangle(windowCenter, monitor.bounds)) {
          return monitor;
        }
      }

      // Find monitor with maximum overlap
      let bestMonitor = currentConfig.monitors[0];
      let maxOverlap = 0;

      for (const monitor of currentConfig.monitors) {
        const overlap = this.calculateRectangleOverlap(savedState.bounds, monitor.bounds);
        if (overlap > maxOverlap) {
          maxOverlap = overlap;
          bestMonitor = monitor;
        }
      }

      if (maxOverlap > 0) {
        return bestMonitor;
      }
    }

    // Strategy 3: Default to primary monitor
    const primaryMonitor = currentConfig.monitors.find((m) => m.primary);
    return primaryMonitor || currentConfig.monitors[0];
  }

  /**
   * Calculate window bounds for placement on the target monitor.
   */
  calculateWindowBounds(windowState: WindowState, targetMonitor: MonitorInfo): Rectangle {
    // Strategy 1: Use relative position if available (preferred for resolution changes)
    if (windowState.relativePosition) {
      const relPos = windowState.relativePosition;

      // Calculate absolute bounds from relative position
      const bounds: Rectangle = {
        x: targetMonitor.workAreaBounds.x + targetMonitor.workAreaBounds.width * relPos.percentX,
        y: targetMonitor.workAreaBounds.y + targetMonitor.workAreaBounds.height * relPos.percentY,
        width: targetMonitor.workAreaBounds.width * relPos.percentWidth,
        height: targetMonitor.workAreaBounds.height * relPos.percentHeight,
      };

      return bounds; // Don't auto-constrain, trust the relative positioning
    }

    // Strategy 2: Use absolute bounds if available
    if (windowState.bounds) {
      // Only ensure visibility if the window is way off-screen
      if (this.isWindowReasonablyVisible(windowState.bounds, targetMonitor)) {
        return windowState.bounds;
      }
      return this.ensureWindowVisible(windowState.bounds);
    }

    // Strategy 3: Provide default bounds centered on target monitor
    const defaultWidth = Math.min(1200, targetMonitor.workAreaBounds.width * 0.8);
    const defaultHeight = Math.min(800, targetMonitor.workAreaBounds.height * 0.8);

    const bounds: Rectangle = {
      x: targetMonitor.workAreaBounds.x + (targetMonitor.workAreaBounds.width - defaultWidth) / 2,
      y: targetMonitor.workAreaBounds.y + (targetMonitor.workAreaBounds.height - defaultHeight) / 2,
      width: defaultWidth,
      height: defaultHeight,
    };

    return bounds;
  }

  /**
   * Check if monitor configuration has changed since saved state.
   */
  isMonitorConfigurationChanged(saved: MonitorConfiguration): boolean {
    const current = this.getCurrentConfiguration();

    // Quick checks for obvious changes
    if (current.monitors.length !== saved.monitors.length) {
      return true;
    }

    if (current.primaryMonitorId !== saved.primaryMonitorId) {
      return true;
    }

    // Deep comparison of monitor properties
    for (const currentMonitor of current.monitors) {
      const savedMonitor = saved.monitors.find((m) => m.id === currentMonitor.id);

      if (!savedMonitor) {
        return true; // Monitor added
      }

      // Check if bounds changed (resolution or position change)
      if (!this.rectanglesEqual(currentMonitor.bounds, savedMonitor.bounds)) {
        return true;
      }

      // Check if scale factor changed
      if (Math.abs(currentMonitor.scaleFactor - savedMonitor.scaleFactor) > 0.01) {
        return true;
      }

      // Check if primary status changed
      if (currentMonitor.primary !== savedMonitor.primary) {
        return true;
      }
    }

    // Check for removed monitors
    for (const savedMonitor of saved.monitors) {
      const currentMonitor = current.monitors.find((m) => m.id === savedMonitor.id);
      if (!currentMonitor) {
        return true; // Monitor removed
      }
    }

    return false;
  }

  /**
   * Searches the current monitor configuration for a monitor with the specified ID.
   */
  findMonitorById(id: number): MonitorInfo | null {
    const config = this.getCurrentConfiguration();
    return config.monitors.find((m) => m.id === id) || null;
  }

  /**
   * Returns the primary monitor or the first available monitor as fallback.
   */
  getPrimaryMonitor(): MonitorInfo {
    const config = this.getCurrentConfiguration();
    const primary = config.monitors.find((m) => m.primary);
    return primary || config.monitors[0];
  }

  /**
   * Ensure window bounds are visible on screen.
   */
  ensureWindowVisible(bounds: Rectangle): Rectangle {
    const config = this.getCurrentConfiguration();
    const MINIMUM_VISIBLE = 100; // Pixels that must be visible

    let adjustedBounds = { ...bounds };

    // Find the best monitor for the current bounds
    let bestMonitor: MonitorInfo | null = null;

    // First, try to find a monitor that contains the window center
    const windowCenter = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };

    for (const monitor of config.monitors) {
      if (this.pointInRectangle(windowCenter, monitor.workAreaBounds)) {
        bestMonitor = monitor;
        break;
      }
    }

    // If no monitor contains the center, use the monitor with maximum overlap
    if (!bestMonitor) {
      let maxOverlap = 0;
      for (const monitor of config.monitors) {
        const overlap = this.calculateRectangleOverlap(bounds, monitor.workAreaBounds);
        if (overlap > maxOverlap) {
          maxOverlap = overlap;
          bestMonitor = monitor;
        }
      }
    }

    // Fallback to primary monitor
    if (!bestMonitor) {
      bestMonitor = this.getPrimaryMonitor();
    }

    const workArea = bestMonitor.workAreaBounds;

    // Ensure minimum size
    adjustedBounds.width = Math.max(adjustedBounds.width, 300);
    adjustedBounds.height = Math.max(adjustedBounds.height, 200);

    // Constrain size to work area
    if (adjustedBounds.width > workArea.width) {
      adjustedBounds.width = workArea.width - 20; // Leave some margin
    }
    if (adjustedBounds.height > workArea.height) {
      adjustedBounds.height = workArea.height - 20;
    }

    // Ensure minimum visibility on the right and bottom
    if (adjustedBounds.x + MINIMUM_VISIBLE > workArea.x + workArea.width) {
      adjustedBounds.x = workArea.x + workArea.width - MINIMUM_VISIBLE;
    }
    if (adjustedBounds.y + MINIMUM_VISIBLE > workArea.y + workArea.height) {
      adjustedBounds.y = workArea.y + workArea.height - MINIMUM_VISIBLE;
    }

    // Ensure minimum visibility on the left and top
    if (adjustedBounds.x + adjustedBounds.width < workArea.x + MINIMUM_VISIBLE) {
      adjustedBounds.x = workArea.x + MINIMUM_VISIBLE - adjustedBounds.width;
    }
    if (adjustedBounds.y + adjustedBounds.height < workArea.y + MINIMUM_VISIBLE) {
      adjustedBounds.y = workArea.y + MINIMUM_VISIBLE - adjustedBounds.height;
    }

    // Final constraint to work area
    if (adjustedBounds.x < workArea.x) {
      adjustedBounds.x = workArea.x;
    }
    if (adjustedBounds.y < workArea.y) {
      adjustedBounds.y = workArea.y;
    }

    return adjustedBounds;
  }

  /**
   * Calculate relative position of window bounds within a monitor.
   */
  calculateRelativePosition(bounds: Rectangle, monitor: MonitorInfo): RelativePosition {
    const workArea = monitor.workAreaBounds;

    return {
      percentX: (bounds.x - workArea.x) / workArea.width,
      percentY: (bounds.y - workArea.y) / workArea.height,
      percentWidth: bounds.width / workArea.width,
      percentHeight: bounds.height / workArea.height,
    };
  }

  /**
   * Helper: Check if a point is within a rectangle.
   */
  private pointInRectangle(point: { x: number; y: number }, rect: Rectangle): boolean {
    return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
  }

  /**
   * Helper: Calculate overlap area between two rectangles.
   */
  private calculateRectangleOverlap(rect1: Rectangle, rect2: Rectangle): number {
    const left = Math.max(rect1.x, rect2.x);
    const right = Math.min(rect1.x + rect1.width, rect2.x + rect2.width);
    const top = Math.max(rect1.y, rect2.y);
    const bottom = Math.min(rect1.y + rect1.height, rect2.y + rect2.height);

    if (left < right && top < bottom) {
      return (right - left) * (bottom - top);
    }
    return 0;
  }

  /**
   * Helper: Check if two rectangles are equal.
   */
  private rectanglesEqual(rect1: Rectangle, rect2: Rectangle): boolean {
    return rect1.x === rect2.x && rect1.y === rect2.y && rect1.width === rect2.width && rect1.height === rect2.height;
  }

  /**
   * Helper: Check if a window is reasonably visible (at least partially on screen).
   */
  private isWindowReasonablyVisible(bounds: Rectangle, monitor: MonitorInfo): boolean {
    const overlap = this.calculateRectangleOverlap(bounds, monitor.workAreaBounds);
    const windowArea = bounds.width * bounds.height;
    const overlapRatio = overlap / windowArea;

    // Consider window reasonably visible if at least 20% is on screen
    return overlapRatio >= 0.2;
  }

  /**
   * Dispose of the monitor manager and clean up resources.
   */
  dispose(): void {
    // Remove event listeners
    if (this.displayAddedHandler) {
      screen.off('display-added', this.displayAddedHandler);
      this.displayAddedHandler = null;
    }
    if (this.displayRemovedHandler) {
      screen.off('display-removed', this.displayRemovedHandler);
      this.displayRemovedHandler = null;
    }
    if (this.displayMetricsChangedHandler) {
      screen.off('display-metrics-changed', this.displayMetricsChangedHandler);
      this.displayMetricsChangedHandler = null;
    }

    // Clear cache
    this.invalidateCache();
  }
}
