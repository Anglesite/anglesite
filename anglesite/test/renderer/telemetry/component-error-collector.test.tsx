import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ComponentErrorCollector } from '../../../src/renderer/telemetry/component-error-collector';
import { TelemetryErrorBoundary } from '../../../src/renderer/telemetry/telemetry-error-boundary';

// Mock IPC renderer
const mockIpcRenderer = {
  invoke: jest.fn(),
  send: jest.fn(),
  on: jest.fn(),
  removeListener: jest.fn(),
};

jest.mock('electron', () => ({
  ipcRenderer: mockIpcRenderer,
}));

// Test component that throws an error
const ThrowingComponent: React.FC<{ shouldThrow?: boolean; errorMessage?: string }> = ({
  shouldThrow = false,
  errorMessage = 'Test error',
}) => {
  if (shouldThrow) {
    throw new Error(errorMessage);
  }
  return <div>Component rendered successfully</div>;
};

// Test component with async error
const AsyncThrowingComponent: React.FC = () => {
  React.useEffect(() => {
    setTimeout(() => {
      throw new Error('Async error');
    }, 10);
  }, []);
  return <div>Async component</div>;
};

describe('ComponentErrorCollector', () => {
  let collector: ComponentErrorCollector;

  beforeEach(() => {
    collector = ComponentErrorCollector.getInstance();
    collector.reset();
    jest.clearAllMocks();

    // Mock console.error to prevent test output noise
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Error Capture', () => {
    test('should capture component render errors', () => {
      const onError = jest.fn();

      render(
        <TelemetryErrorBoundary onError={onError} componentName="TestComponent">
          <ThrowingComponent shouldThrow={true} errorMessage="Render error" />
        </TelemetryErrorBoundary>
      );

      expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Render error',
        }),
        expect.objectContaining({
          componentName: 'TestComponent',
        })
      );
    });

    test('should capture component hierarchy', () => {
      const onError = jest.fn();

      render(
        <TelemetryErrorBoundary componentName="App">
          <TelemetryErrorBoundary componentName="Page" onError={onError}>
            <TelemetryErrorBoundary componentName="Section">
              <ThrowingComponent shouldThrow={true} />
            </TelemetryErrorBoundary>
          </TelemetryErrorBoundary>
        </TelemetryErrorBoundary>
      );

      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          componentHierarchy: ['App', 'Page', 'Section'],
        })
      );
    });

    test('should capture component props when configured', () => {
      const props = { userId: 123, theme: 'dark' };
      const onError = jest.fn();

      render(
        <TelemetryErrorBoundary
          componentName="TestComponent"
          captureProps={true}
          componentProps={props}
          onError={onError}
        >
          <ThrowingComponent shouldThrow={true} />
        </TelemetryErrorBoundary>
      );

      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          props: expect.objectContaining(props),
        })
      );
    });

    test('should not capture sensitive props when anonymization is enabled', () => {
      const props = {
        email: 'test@example.com',
        apiKey: 'secret-key-123',
        name: 'John',
      };
      const onError = jest.fn();

      render(
        <TelemetryErrorBoundary
          componentName="TestComponent"
          captureProps={true}
          componentProps={props}
          anonymize={true}
          onError={onError}
        >
          <ThrowingComponent shouldThrow={true} />
        </TelemetryErrorBoundary>
      );

      const capturedProps = (onError.mock.calls[0][1] as any).props;
      expect(capturedProps.email).not.toBe('test@example.com');
      expect(capturedProps.apiKey).not.toBe('secret-key-123');
      expect(capturedProps.name).toBe('John'); // Non-sensitive data preserved
    });
  });

  describe('Error Batching', () => {
    test('should batch multiple errors', async () => {
      collector.configure({
        batchSize: 3,
        batchIntervalMs: 100,
        enabled: true,
      });

      // Generate 5 errors
      for (let i = 0; i < 5; i++) {
        collector.captureError(new Error(`Error ${i}`), { componentName: `Component${i}` });
      }

      // Should send 1 batch immediately (first 3 errors)
      expect(mockIpcRenderer.invoke).toHaveBeenCalledTimes(1);
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'telemetry:report-batch',
        expect.arrayContaining([
          expect.objectContaining({ error: { message: 'Error 0' } }),
          expect.objectContaining({ error: { message: 'Error 1' } }),
          expect.objectContaining({ error: { message: 'Error 2' } }),
        ])
      );

      // Wait for interval batch (remaining 2 errors)
      await waitFor(
        () => {
          expect(mockIpcRenderer.invoke).toHaveBeenCalledTimes(2);
        },
        { timeout: 200 }
      );

      const secondBatch = mockIpcRenderer.invoke.mock.calls[1][1];
      expect(secondBatch).toHaveLength(2);
      expect(secondBatch[0].error.message).toBe('Error 3');
      expect(secondBatch[1].error.message).toBe('Error 4');
    });

    test('should respect batch interval', async () => {
      jest.useFakeTimers();

      collector.configure({
        batchSize: 10,
        batchIntervalMs: 5000,
        enabled: true,
      });

      collector.captureError(new Error('Error 1'), { componentName: 'Component1' });
      collector.captureError(new Error('Error 2'), { componentName: 'Component2' });

      // Should not send immediately
      expect(mockIpcRenderer.invoke).not.toHaveBeenCalled();

      // Advance time to trigger batch
      jest.advanceTimersByTime(5000);
      await Promise.resolve(); // Let async operations complete

      expect(mockIpcRenderer.invoke).toHaveBeenCalledTimes(1);
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        'telemetry:report-batch',
        expect.arrayContaining([
          expect.objectContaining({ error: { message: 'Error 1' } }),
          expect.objectContaining({ error: { message: 'Error 2' } }),
        ])
      );

      jest.useRealTimers();
    });
  });

  describe('Sampling', () => {
    test('should respect sampling rate', () => {
      const randomSpy = jest.spyOn(Math, 'random');

      collector.configure({
        enabled: true,
        samplingRate: 0.5,
      });

      // Should capture when random < samplingRate
      randomSpy.mockReturnValueOnce(0.3);
      const captured1 = collector.captureError(new Error('Error 1'), { componentName: 'Component1' });
      expect(captured1).toBe(true);

      // Should not capture when random >= samplingRate
      randomSpy.mockReturnValueOnce(0.7);
      const captured2 = collector.captureError(new Error('Error 2'), { componentName: 'Component2' });
      expect(captured2).toBe(false);

      randomSpy.mockRestore();
    });

    test('should always capture when sampling rate is 1', () => {
      collector.configure({
        enabled: true,
        samplingRate: 1.0,
      });

      for (let i = 0; i < 10; i++) {
        const captured = collector.captureError(new Error(`Error ${i}`), { componentName: `Component${i}` });
        expect(captured).toBe(true);
      }
    });

    test('should never capture when sampling rate is 0', () => {
      collector.configure({
        enabled: true,
        samplingRate: 0,
      });

      for (let i = 0; i < 10; i++) {
        const captured = collector.captureError(new Error(`Error ${i}`), { componentName: `Component${i}` });
        expect(captured).toBe(false);
      }
    });
  });

  describe('Context Collection', () => {
    test('should collect route context', () => {
      const mockLocation = { pathname: '/dashboard/settings' };
      (window as any).location = mockLocation;

      const context = collector.collectContext();

      expect(context.route).toBe('/dashboard/settings');
    });

    test('should collect user action context', () => {
      collector.setUserAction('click', 'save-button');

      const context = collector.collectContext();

      expect(context.userAction).toBe('click:save-button');

      // Should clear after collection
      const nextContext = collector.collectContext();
      expect(nextContext.userAction).toBeUndefined();
    });

    test('should collect website context', () => {
      collector.setWebsiteContext('website-123');

      const context = collector.collectContext();

      expect(context.websiteId).toBe('website-123');
    });
  });

  describe('Error Boundary Integration', () => {
    test('should provide fallback UI on error', () => {
      render(
        <TelemetryErrorBoundary componentName="TestComponent">
          <ThrowingComponent shouldThrow={true} />
        </TelemetryErrorBoundary>
      );

      expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
      expect(screen.getByText(/TestComponent/)).toBeInTheDocument();
    });

    test('should allow custom fallback UI', () => {
      const CustomFallback = ({ error }: { error: Error }) => <div>Custom error: {error.message}</div>;

      render(
        <TelemetryErrorBoundary componentName="TestComponent" fallback={CustomFallback}>
          <ThrowingComponent shouldThrow={true} errorMessage="Custom error message" />
        </TelemetryErrorBoundary>
      );

      expect(screen.getByText('Custom error: Custom error message')).toBeInTheDocument();
    });

    test('should recover when error is cleared', () => {
      const { rerender } = render(
        <TelemetryErrorBoundary componentName="TestComponent">
          <ThrowingComponent shouldThrow={true} />
        </TelemetryErrorBoundary>
      );

      expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();

      // Re-render without error
      rerender(
        <TelemetryErrorBoundary componentName="TestComponent">
          <ThrowingComponent shouldThrow={false} />
        </TelemetryErrorBoundary>
      );

      expect(screen.getByText('Component rendered successfully')).toBeInTheDocument();
      expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
    });
  });

  describe('Performance', () => {
    test('should handle high error volume without blocking', () => {
      collector.configure({
        enabled: true,
        batchSize: 100,
        batchIntervalMs: 1000,
      });

      const startTime = performance.now();

      // Generate 1000 errors
      for (let i = 0; i < 1000; i++) {
        collector.captureError(new Error(`Error ${i}`), { componentName: `Component${i}` });
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (< 100ms for 1000 errors)
      expect(duration).toBeLessThan(100);

      // Should batch appropriately
      expect(mockIpcRenderer.invoke).toHaveBeenCalledTimes(10); // 1000 / 100 = 10 batches
    });

    test('should truncate large error messages', () => {
      const largeMessage = 'x'.repeat(100000);

      const captured = collector.captureError(new Error(largeMessage), { componentName: 'TestComponent' });

      expect(captured).toBe(true);

      // Get the captured error from the mock call
      const batch = (collector as any).eventBatch;
      expect(batch[0].error.message.length).toBeLessThanOrEqual(10000);
      expect(batch[0].error.message.endsWith('...[truncated]')).toBe(true);
    });

    test('should handle circular references in props', () => {
      const circular: any = { name: 'Test' };
      circular.self = circular;

      const captured = collector.captureError(new Error('Test error'), {
        componentName: 'TestComponent',
        props: circular,
      });

      expect(captured).toBe(true);

      // Should not throw when serializing
      const batch = (collector as any).eventBatch;
      expect(() => JSON.stringify(batch[0])).not.toThrow();
    });
  });
});
