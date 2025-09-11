/**
 * @file Tests for monitor management types and interfaces
 *
 * Tests the core type definitions for multi-monitor window state persistence,
 * ensuring type safety and proper validation of monitor-related data structures.
 */

import {
  MonitorInfo,
  MonitorConfiguration,
  RelativePosition,
  WindowState,
  validateMonitorInfo,
  validateRelativePosition,
  validateMonitorConfiguration,
} from '../../src/main/core/types';

describe('Monitor Management Types', () => {
  describe('MonitorInfo validation', () => {
    test('should validate correct MonitorInfo structure', () => {
      const validMonitor: MonitorInfo = {
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workAreaBounds: { x: 0, y: 25, width: 1920, height: 1055 },
        scaleFactor: 1.0,
        primary: true,
        label: 'Primary Display',
      };

      expect(validateMonitorInfo(validMonitor)).toBe(true);
    });

    test('should reject MonitorInfo with invalid bounds', () => {
      const invalidMonitor: MonitorInfo = {
        id: 1,
        bounds: { x: 0, y: 0, width: -1920, height: 1080 }, // Negative width
        workAreaBounds: { x: 0, y: 25, width: 1920, height: 1055 },
        scaleFactor: 1.0,
        primary: true,
      };

      expect(validateMonitorInfo(invalidMonitor)).toBe(false);
    });

    test('should reject MonitorInfo with invalid scale factor', () => {
      const invalidMonitor: MonitorInfo = {
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workAreaBounds: { x: 0, y: 25, width: 1920, height: 1055 },
        scaleFactor: 0, // Invalid scale factor
        primary: true,
      };

      expect(validateMonitorInfo(invalidMonitor)).toBe(false);
    });
  });

  describe('RelativePosition validation', () => {
    test('should validate correct RelativePosition values', () => {
      const validPosition: RelativePosition = {
        percentX: 0.1,
        percentY: 0.2,
        percentWidth: 0.5,
        percentHeight: 0.6,
      };

      expect(validateRelativePosition(validPosition)).toBe(true);
    });

    test('should accept edge case values (0.0 and 1.0)', () => {
      const edgeCasePosition: RelativePosition = {
        percentX: 0.0,
        percentY: 1.0,
        percentWidth: 1.0,
        percentHeight: 0.1,
      };

      expect(validateRelativePosition(edgeCasePosition)).toBe(true);
    });

    test('should reject negative percentage values', () => {
      const invalidPosition: RelativePosition = {
        percentX: -0.1,
        percentY: 0.2,
        percentWidth: 0.5,
        percentHeight: 0.6,
      };

      expect(validateRelativePosition(invalidPosition)).toBe(false);
    });

    test('should reject percentage values greater than reasonable limits', () => {
      const invalidPosition: RelativePosition = {
        percentX: 0.1,
        percentY: 0.2,
        percentWidth: 5.0, // Too large
        percentHeight: 0.6,
      };

      expect(validateRelativePosition(invalidPosition)).toBe(false);
    });
  });

  describe('MonitorConfiguration validation', () => {
    test('should validate correct MonitorConfiguration', () => {
      const monitor1: MonitorInfo = {
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workAreaBounds: { x: 0, y: 25, width: 1920, height: 1055 },
        scaleFactor: 1.0,
        primary: true,
      };

      const monitor2: MonitorInfo = {
        id: 2,
        bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
        workAreaBounds: { x: 1920, y: 25, width: 2560, height: 1415 },
        scaleFactor: 1.25,
        primary: false,
      };

      const validConfig: MonitorConfiguration = {
        monitors: [monitor1, monitor2],
        primaryMonitorId: 1,
        timestamp: Date.now(),
      };

      expect(validateMonitorConfiguration(validConfig)).toBe(true);
    });

    test('should reject configuration without primary monitor', () => {
      const monitor1: MonitorInfo = {
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workAreaBounds: { x: 0, y: 25, width: 1920, height: 1055 },
        scaleFactor: 1.0,
        primary: false, // No primary monitor
      };

      const invalidConfig: MonitorConfiguration = {
        monitors: [monitor1],
        primaryMonitorId: 1,
        timestamp: Date.now(),
      };

      expect(validateMonitorConfiguration(invalidConfig)).toBe(false);
    });

    test('should reject configuration with mismatched primary monitor ID', () => {
      const monitor1: MonitorInfo = {
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workAreaBounds: { x: 0, y: 25, width: 1920, height: 1055 },
        scaleFactor: 1.0,
        primary: true,
      };

      const invalidConfig: MonitorConfiguration = {
        monitors: [monitor1],
        primaryMonitorId: 2, // ID doesn't match any monitor
        timestamp: Date.now(),
      };

      expect(validateMonitorConfiguration(invalidConfig)).toBe(false);
    });

    test('should reject empty monitor array', () => {
      const invalidConfig: MonitorConfiguration = {
        monitors: [],
        primaryMonitorId: 1,
        timestamp: Date.now(),
      };

      expect(validateMonitorConfiguration(invalidConfig)).toBe(false);
    });
  });

  describe('Enhanced WindowState', () => {
    test('should support backward compatibility with existing WindowState', () => {
      const legacyWindowState: WindowState = {
        websiteName: 'test-site',
        websitePath: '/path/to/site',
        bounds: { x: 100, y: 100, width: 800, height: 600 },
        isMaximized: false,
        windowType: 'editor',
      };

      // Should be valid even without monitor-related fields
      expect(legacyWindowState.websiteName).toBe('test-site');
      expect(legacyWindowState.targetMonitorId).toBeUndefined();
      expect(legacyWindowState.relativePosition).toBeUndefined();
    });

    test('should support new monitor-aware WindowState', () => {
      const monitorAwareWindowState: WindowState = {
        websiteName: 'test-site',
        websitePath: '/path/to/site',
        bounds: { x: 2000, y: 100, width: 1200, height: 800 },
        isMaximized: false,
        windowType: 'editor',
        targetMonitorId: 2,
        relativePosition: {
          percentX: 0.03125,
          percentY: 0.069,
          percentWidth: 0.46875,
          percentHeight: 0.555,
        },
        monitorConfig: {
          monitors: [
            {
              id: 1,
              bounds: { x: 0, y: 0, width: 1920, height: 1080 },
              workAreaBounds: { x: 0, y: 25, width: 1920, height: 1055 },
              scaleFactor: 1.0,
              primary: true,
            },
            {
              id: 2,
              bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
              workAreaBounds: { x: 1920, y: 25, width: 2560, height: 1415 },
              scaleFactor: 1.25,
              primary: false,
            },
          ],
          primaryMonitorId: 1,
          timestamp: Date.now(),
        },
      };

      expect(monitorAwareWindowState.targetMonitorId).toBe(2);
      expect(monitorAwareWindowState.relativePosition?.percentX).toBe(0.03125);
      expect(monitorAwareWindowState.monitorConfig?.monitors).toHaveLength(2);
    });
  });

  describe('Type safety and constraints', () => {
    test('should enforce monitor ID uniqueness in configuration', () => {
      const monitor1: MonitorInfo = {
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workAreaBounds: { x: 0, y: 25, width: 1920, height: 1055 },
        scaleFactor: 1.0,
        primary: true,
      };

      const monitor2: MonitorInfo = {
        id: 1, // Duplicate ID
        bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
        workAreaBounds: { x: 1920, y: 25, width: 2560, height: 1415 },
        scaleFactor: 1.25,
        primary: false,
      };

      const invalidConfig: MonitorConfiguration = {
        monitors: [monitor1, monitor2],
        primaryMonitorId: 1,
        timestamp: Date.now(),
      };

      expect(validateMonitorConfiguration(invalidConfig)).toBe(false);
    });

    test('should handle extreme coordinate values gracefully', () => {
      const extremeMonitor: MonitorInfo = {
        id: 1,
        bounds: { x: -32768, y: -32768, width: 65536, height: 32768 },
        workAreaBounds: { x: -32768, y: -32743, width: 65536, height: 32743 },
        scaleFactor: 3.0,
        primary: true,
      };

      expect(validateMonitorInfo(extremeMonitor)).toBe(true);
    });
  });
});
