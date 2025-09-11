/**
 * @file Tests for MonitorManager service
 *
 * Tests the core monitor management functionality including monitor detection,
 * window placement algorithms, and fallback logic for multi-monitor setups.
 */

import { MonitorManager } from '../../src/main/services/monitor-manager';
import { MonitorInfo, WindowState, Rectangle } from '../../src/main/core/types';
import { screen, Display } from 'electron';

// Mock Electron's screen module
jest.mock('electron', () => ({
  screen: {
    getAllDisplays: jest.fn(),
    getPrimaryDisplay: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  },
}));

const mockScreen = screen as jest.Mocked<typeof screen>;

describe('MonitorManager', () => {
  let monitorManager: MonitorManager;

  const createMockDisplay = (overrides: Partial<Display> = {}): Display =>
    ({
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 25, width: 1920, height: 1055 },
      scaleFactor: 1.0,
      rotation: 0,
      touchSupport: 'unknown',
      monochrome: false,
      accelerometerSupport: 'unknown',
      colorSpace: '',
      colorDepth: 24,
      depthPerComponent: 8,
      displayFrequency: 60,
      detected: true,
      internal: false,
      label: 'Mock Display',
      maximumCursorSize: { width: 64, height: 64 },
      size: { width: 1920, height: 1080 },
      workAreaSize: { width: 1920, height: 1055 },
      ...overrides,
    }) as Display;

  const createMockMonitor = (overrides: Partial<MonitorInfo> = {}): MonitorInfo => ({
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workAreaBounds: { x: 0, y: 25, width: 1920, height: 1055 },
    scaleFactor: 1.0,
    primary: true,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    monitorManager = new MonitorManager();
  });

  afterEach(() => {
    monitorManager.dispose();
  });

  describe('getCurrentConfiguration', () => {
    test('should detect single monitor configuration', () => {
      const mockDisplay = createMockDisplay({ id: 1 });
      mockScreen.getAllDisplays.mockReturnValue([mockDisplay]);
      mockScreen.getPrimaryDisplay.mockReturnValue(mockDisplay);

      const config = monitorManager.getCurrentConfiguration();

      expect(config.monitors).toHaveLength(1);
      expect(config.monitors[0]).toMatchObject({
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workAreaBounds: { x: 0, y: 25, width: 1920, height: 1055 },
        scaleFactor: 1.0,
        primary: true,
      });
      expect(config.primaryMonitorId).toBe(1);
      expect(config.timestamp).toBeCloseTo(Date.now(), -1000);
    });

    test('should detect dual monitor configuration', () => {
      const primaryDisplay = createMockDisplay({
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      });
      const secondaryDisplay = createMockDisplay({
        id: 2,
        bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
        workArea: { x: 1920, y: 25, width: 2560, height: 1415 },
        scaleFactor: 1.25,
      });

      mockScreen.getAllDisplays.mockReturnValue([primaryDisplay, secondaryDisplay]);
      mockScreen.getPrimaryDisplay.mockReturnValue(primaryDisplay);

      const config = monitorManager.getCurrentConfiguration();

      expect(config.monitors).toHaveLength(2);
      expect(config.monitors.find((m) => m.id === 1)?.primary).toBe(true);
      expect(config.monitors.find((m) => m.id === 2)?.primary).toBe(false);
      expect(config.primaryMonitorId).toBe(1);
    });

    test('should handle monitors with negative coordinates', () => {
      const leftDisplay = createMockDisplay({
        id: 1,
        bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
      });
      const rightDisplay = createMockDisplay({
        id: 2,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      });

      mockScreen.getAllDisplays.mockReturnValue([leftDisplay, rightDisplay]);
      mockScreen.getPrimaryDisplay.mockReturnValue(rightDisplay);

      const config = monitorManager.getCurrentConfiguration();

      expect(config.monitors).toHaveLength(2);
      expect(config.monitors.find((m) => m.id === 1)?.bounds.x).toBe(-1920);
      expect(config.monitors.find((m) => m.id === 2)?.primary).toBe(true);
    });
  });

  describe('findBestMonitorForWindow', () => {
    beforeEach(() => {
      const monitor1 = createMockMonitor({
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        primary: true,
      });
      const monitor2 = createMockMonitor({
        id: 2,
        bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
        scaleFactor: 1.25,
        primary: false,
      });

      // Mock current configuration
      mockScreen.getAllDisplays.mockReturnValue([
        createMockDisplay({ id: 1, bounds: monitor1.bounds }),
        createMockDisplay({ id: 2, bounds: monitor2.bounds, scaleFactor: 1.25 }),
      ]);
      mockScreen.getPrimaryDisplay.mockReturnValue(createMockDisplay({ id: 1, bounds: monitor1.bounds }));
    });

    test('should return target monitor when available and unchanged', () => {
      const windowState: WindowState = {
        websiteName: 'test-site',
        targetMonitorId: 2,
        bounds: { x: 2000, y: 100, width: 1200, height: 800 },
      };

      const bestMonitor = monitorManager.findBestMonitorForWindow(windowState);

      expect(bestMonitor.id).toBe(2);
      expect(bestMonitor.bounds).toEqual({ x: 1920, y: 0, width: 2560, height: 1440 });
    });

    test('should fallback to primary monitor when target monitor unavailable', () => {
      const windowState: WindowState = {
        websiteName: 'test-site',
        targetMonitorId: 3, // Non-existent monitor
        bounds: { x: 2000, y: 100, width: 1200, height: 800 },
      };

      // Mock only primary monitor available
      mockScreen.getAllDisplays.mockReturnValue([
        createMockDisplay({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
      ]);

      const bestMonitor = monitorManager.findBestMonitorForWindow(windowState);

      expect(bestMonitor.id).toBe(1);
      expect(bestMonitor.primary).toBe(true);
    });

    test('should use bounds to determine best monitor when no target specified', () => {
      const windowState: WindowState = {
        websiteName: 'test-site',
        bounds: { x: 2200, y: 200, width: 800, height: 600 }, // Clearly on monitor 2
      };

      const bestMonitor = monitorManager.findBestMonitorForWindow(windowState);

      expect(bestMonitor.id).toBe(2);
    });

    test('should handle window state without bounds or target monitor', () => {
      const windowState: WindowState = {
        websiteName: 'test-site',
        // No bounds or targetMonitorId
      };

      const bestMonitor = monitorManager.findBestMonitorForWindow(windowState);

      expect(bestMonitor.id).toBe(1); // Should default to primary
      expect(bestMonitor.primary).toBe(true);
    });
  });

  describe('calculateWindowBounds', () => {
    const targetMonitor = createMockMonitor({
      id: 2,
      bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
      workAreaBounds: { x: 1920, y: 25, width: 2560, height: 1415 },
      primary: false,
    });

    test('should use relative position when available', () => {
      const windowState: WindowState = {
        websiteName: 'test-site',
        relativePosition: {
          percentX: 0.1,
          percentY: 0.1,
          percentWidth: 0.5,
          percentHeight: 0.6,
        },
      };

      const bounds = monitorManager.calculateWindowBounds(windowState, targetMonitor);

      expect(bounds).toEqual({
        x: 1920 + 2560 * 0.1, // 2176
        y: 25 + 1415 * 0.1, // 166.5
        width: 2560 * 0.5, // 1280
        height: 1415 * 0.6, // 849
      });
    });

    test('should use absolute bounds when relative position unavailable', () => {
      const windowState: WindowState = {
        websiteName: 'test-site',
        bounds: { x: 2000, y: 100, width: 1200, height: 800 },
      };

      const bounds = monitorManager.calculateWindowBounds(windowState, targetMonitor);

      expect(bounds).toEqual({ x: 2000, y: 100, width: 1200, height: 800 });
    });

    test('should provide default bounds when no position data available', () => {
      const windowState: WindowState = {
        websiteName: 'test-site',
      };

      const bounds = monitorManager.calculateWindowBounds(windowState, targetMonitor);

      // Should provide reasonable default centered on monitor
      expect(bounds.x).toBeGreaterThan(targetMonitor.workAreaBounds.x);
      expect(bounds.y).toBeGreaterThan(targetMonitor.workAreaBounds.y);
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
    });

    test('should ensure window is visible on target monitor', () => {
      const windowState: WindowState = {
        websiteName: 'test-site',
        bounds: { x: 5000, y: 5000, width: 1200, height: 800 }, // Way off screen
      };

      const bounds = monitorManager.calculateWindowBounds(windowState, targetMonitor);

      // Window should be moved to be visible
      const minVisible = 100;
      expect(bounds.x + bounds.width).toBeGreaterThan(targetMonitor.workAreaBounds.x + minVisible);
      expect(bounds.y + bounds.height).toBeGreaterThan(targetMonitor.workAreaBounds.y + minVisible);
      expect(bounds.x).toBeLessThan(targetMonitor.workAreaBounds.x + targetMonitor.workAreaBounds.width - minVisible);
      expect(bounds.y).toBeLessThan(targetMonitor.workAreaBounds.y + targetMonitor.workAreaBounds.height - minVisible);
    });
  });

  describe('calculateRelativePosition', () => {
    const monitor = createMockMonitor({
      bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
      workAreaBounds: { x: 1920, y: 25, width: 2560, height: 1415 },
    });

    test('should calculate correct relative position', () => {
      const bounds: Rectangle = { x: 2176, y: 166, width: 1280, height: 849 };

      const relativePos = monitorManager.calculateRelativePosition(bounds, monitor);

      expect(relativePos.percentX).toBeCloseTo(0.1, 3);
      expect(relativePos.percentY).toBeCloseTo(0.1, 3);
      expect(relativePos.percentWidth).toBeCloseTo(0.5, 3);
      expect(relativePos.percentHeight).toBeCloseTo(0.6, 3);
    });

    test('should handle window partially outside monitor bounds', () => {
      const bounds: Rectangle = { x: 1800, y: -100, width: 300, height: 200 };

      const relativePos = monitorManager.calculateRelativePosition(bounds, monitor);

      // Should still calculate relative to monitor bounds
      expect(relativePos.percentX).toBeLessThan(0);
      expect(relativePos.percentY).toBeLessThan(0);
      expect(relativePos.percentWidth).toBeGreaterThan(0);
      expect(relativePos.percentHeight).toBeGreaterThan(0);
    });
  });

  describe('isMonitorConfigurationChanged', () => {
    test('should detect no change when configurations match', () => {
      const currentConfig = {
        monitors: [createMockMonitor({ id: 1 })],
        primaryMonitorId: 1,
        timestamp: Date.now(),
      };

      mockScreen.getAllDisplays.mockReturnValue([createMockDisplay({ id: 1 })]);
      mockScreen.getPrimaryDisplay.mockReturnValue(createMockDisplay({ id: 1 }));

      const hasChanged = monitorManager.isMonitorConfigurationChanged(currentConfig);

      expect(hasChanged).toBe(false);
    });

    test('should detect change when monitor count differs', () => {
      const oldConfig = {
        monitors: [createMockMonitor({ id: 1 })],
        primaryMonitorId: 1,
        timestamp: Date.now() - 1000,
      };

      // Mock current state with two monitors
      mockScreen.getAllDisplays.mockReturnValue([
        createMockDisplay({ id: 1 }),
        createMockDisplay({ id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }),
      ]);
      mockScreen.getPrimaryDisplay.mockReturnValue(createMockDisplay({ id: 1 }));

      const hasChanged = monitorManager.isMonitorConfigurationChanged(oldConfig);

      expect(hasChanged).toBe(true);
    });

    test('should detect change when monitor bounds change', () => {
      const oldConfig = {
        monitors: [
          createMockMonitor({
            id: 1,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          }),
        ],
        primaryMonitorId: 1,
        timestamp: Date.now() - 1000,
      };

      // Mock current state with different resolution
      mockScreen.getAllDisplays.mockReturnValue([
        createMockDisplay({
          id: 1,
          bounds: { x: 0, y: 0, width: 2560, height: 1440 },
        }),
      ]);
      mockScreen.getPrimaryDisplay.mockReturnValue(
        createMockDisplay({ id: 1, bounds: { x: 0, y: 0, width: 2560, height: 1440 } })
      );

      const hasChanged = monitorManager.isMonitorConfigurationChanged(oldConfig);

      expect(hasChanged).toBe(true);
    });
  });

  describe('ensureWindowVisible', () => {
    const monitor = createMockMonitor({
      workAreaBounds: { x: 0, y: 25, width: 1920, height: 1055 },
    });

    beforeEach(() => {
      mockScreen.getAllDisplays.mockReturnValue([createMockDisplay({ id: 1, workArea: monitor.workAreaBounds })]);
    });

    test('should not modify window already visible', () => {
      const bounds: Rectangle = { x: 100, y: 100, width: 800, height: 600 };

      const result = monitorManager.ensureWindowVisible(bounds);

      expect(result).toEqual(bounds);
    });

    test('should move window completely off-screen to be visible', () => {
      const bounds: Rectangle = { x: 3000, y: 3000, width: 800, height: 600 };

      const result = monitorManager.ensureWindowVisible(bounds);

      // Window should be moved to ensure at least 100px is visible
      expect(result.x).toBeLessThanOrEqual(1920 - 100); // At least 100px visible on right
      expect(result.y).toBeLessThanOrEqual(1055 + 25 - 100); // At least 100px visible on bottom (accounting for workArea offset)
      expect(result.width).toBe(800); // Size preserved
      expect(result.height).toBe(600);
    });

    test('should resize oversized window to fit', () => {
      const bounds: Rectangle = { x: 0, y: 0, width: 3000, height: 2000 };

      const result = monitorManager.ensureWindowVisible(bounds);

      expect(result.width).toBeLessThanOrEqual(1920);
      expect(result.height).toBeLessThanOrEqual(1055);
      expect(result.x).toBeGreaterThanOrEqual(0);
      expect(result.y).toBeGreaterThanOrEqual(25);
    });
  });

  describe('utility methods', () => {
    test('findMonitorById should return correct monitor', () => {
      const display1 = createMockDisplay({ id: 1 });
      const display2 = createMockDisplay({
        id: 2,
        bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
        workArea: { x: 1920, y: 25, width: 2560, height: 1415 },
      });

      mockScreen.getAllDisplays.mockReturnValue([display1, display2]);
      mockScreen.getPrimaryDisplay.mockReturnValue(display1);

      const monitor = monitorManager.findMonitorById(2);

      expect(monitor?.id).toBe(2);
      expect(monitor?.bounds.width).toBe(2560);
    });

    test('findMonitorById should return null for non-existent monitor', () => {
      mockScreen.getAllDisplays.mockReturnValue([createMockDisplay({ id: 1 })]);

      const monitor = monitorManager.findMonitorById(999);

      expect(monitor).toBeNull();
    });

    test('getPrimaryMonitor should return primary monitor', () => {
      const primaryDisplay = createMockDisplay({ id: 1 });
      mockScreen.getPrimaryDisplay.mockReturnValue(primaryDisplay);

      const primary = monitorManager.getPrimaryMonitor();

      expect(primary.id).toBe(1);
      expect(primary.primary).toBe(true);
    });
  });

  describe('event handling', () => {
    test('should set up screen event listeners on initialization', () => {
      expect(mockScreen.on).toHaveBeenCalledWith('display-added', expect.any(Function));
      expect(mockScreen.on).toHaveBeenCalledWith('display-removed', expect.any(Function));
      expect(mockScreen.on).toHaveBeenCalledWith('display-metrics-changed', expect.any(Function));
    });

    test('should clean up event listeners on disposal', () => {
      monitorManager.dispose();

      expect(mockScreen.off).toHaveBeenCalledWith('display-added', expect.any(Function));
      expect(mockScreen.off).toHaveBeenCalledWith('display-removed', expect.any(Function));
      expect(mockScreen.off).toHaveBeenCalledWith('display-metrics-changed', expect.any(Function));
    });
  });
});
