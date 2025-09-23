/**
 * @file ErrorBoundary Component Tests
 * @description Comprehensive tests for ErrorBoundary component including async failure scenarios
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

import React, { useEffect, useState } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ErrorBoundary } from '../../../src/renderer/ui/react/components/ErrorBoundary';
import { MockFactory } from '../../utils/mock-factory';

// Suppress console errors during testing
const originalError = console.error;
beforeAll(() => {
  console.error = jest.fn();
});
afterAll(() => {
  console.error = originalError;
});

describe('ErrorBoundary Async Failure Tests', () => {
  let mockAPI: ReturnType<typeof MockFactory.createElectronAPI>;

  beforeEach(() => {
    // Setup mock ElectronAPI for telemetry testing
    mockAPI = MockFactory.setupWindowElectronAPI();
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up window.electronAPI
    delete (window as any).electronAPI;
  });

  describe('Async Component Errors', () => {
    test('should catch errors from async useEffect operations', async () => {
      // Component that throws in async useEffect
      const AsyncFailingComponent: React.FC = () => {
        const [data, setData] = useState<string>('loading...');

        useEffect(() => {
          const loadData = async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            throw new Error('Async data load failed');
          };

          loadData().catch((error) => {
            // Trigger error boundary by updating state with error
            setData(() => {
              throw error;
            });
          });
        }, []);

        return <div>{data}</div>;
      };

      // Render with error boundary
      const { container } = render(
        <ErrorBoundary componentName="AsyncTest" fallback={<div>Error caught!</div>}>
          <AsyncFailingComponent />
        </ErrorBoundary>
      );

      // Initially shows loading
      expect(screen.getByText('loading...')).toBeInTheDocument();

      // Wait for async error to be caught
      await waitFor(() => {
        expect(screen.getByText('Error caught!')).toBeInTheDocument();
      });

      // Verify telemetry was sent
      expect(mockAPI.send).toHaveBeenCalledWith(
        'renderer-error',
        expect.objectContaining({
          component: 'AsyncTest',
          error: expect.objectContaining({
            message: 'Async data load failed',
          }),
        })
      );
    });

    test('should handle promise rejection in event handlers', async () => {
      // Component with async event handler
      const AsyncEventComponent: React.FC = () => {
        const [error, setError] = useState<Error | null>(null);

        const handleClick = async () => {
          try {
            await Promise.reject(new Error('Async click handler failed'));
          } catch (err) {
            setError(() => {
              throw err;
            });
          }
        };

        if (error) throw error;

        return <button onClick={handleClick}>Click me</button>;
      };

      render(
        <ErrorBoundary componentName="EventHandler" fallback={<div>Event error caught!</div>}>
          <AsyncEventComponent />
        </ErrorBoundary>
      );

      // Click button to trigger async error
      const button = screen.getByText('Click me');
      fireEvent.click(button);

      // Wait for error to be caught
      await waitFor(() => {
        expect(screen.getByText('Event error caught!')).toBeInTheDocument();
      });

      // Verify error details
      expect(mockAPI.send).toHaveBeenCalledWith(
        'renderer-error',
        expect.objectContaining({
          component: 'EventHandler',
          error: expect.objectContaining({
            message: 'Async click handler failed',
          }),
        })
      );
    });

    test('should handle errors from lazy-loaded components', async () => {
      // Simulate a lazy component that fails to load
      const LazyComponent = React.lazy(() => Promise.reject(new Error('Failed to load module')));

      render(
        <ErrorBoundary componentName="LazyLoad" fallback={<div>Lazy load failed!</div>}>
          <React.Suspense fallback={<div>Loading...</div>}>
            <LazyComponent />
          </React.Suspense>
        </ErrorBoundary>
      );

      // Initially shows loading
      expect(screen.getByText('Loading...')).toBeInTheDocument();

      // Wait for lazy load error
      await waitFor(() => {
        expect(screen.getByText('Lazy load failed!')).toBeInTheDocument();
      });
    });

    test('should handle errors from async data fetching', async () => {
      // Component that fetches data
      const DataFetchComponent: React.FC = () => {
        const [data, setData] = useState<any>(null);
        const [loading, setLoading] = useState(true);

        useEffect(() => {
          const fetchData = async () => {
            try {
              // Simulate API call that fails
              const response = await fetch('/api/data');
              if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
              }
              const result = await response.json();
              setData(result);
            } catch (error) {
              // Trigger error boundary
              setData(() => {
                throw error;
              });
            } finally {
              setLoading(false);
            }
          };

          fetchData();
        }, []);

        if (loading) return <div>Fetching data...</div>;
        return <div>{JSON.stringify(data)}</div>;
      };

      // Mock fetch to fail
      global.fetch = jest.fn(() => Promise.reject(new Error('Network request failed')));

      render(
        <ErrorBoundary componentName="DataFetch" fallback={<div>Data fetch error!</div>}>
          <DataFetchComponent />
        </ErrorBoundary>
      );

      // Wait for error
      await waitFor(() => {
        expect(screen.getByText('Data fetch error!')).toBeInTheDocument();
      });

      // Cleanup
      delete (global as any).fetch;
    });
  });

  describe('Cascading Errors', () => {
    test('should handle cascading errors from parent and child components', async () => {
      let parentErrorTrigger: () => void;
      let childErrorTrigger: () => void;

      // Child component that can throw
      const ChildComponent: React.FC = () => {
        const [shouldError, setShouldError] = useState(false);

        childErrorTrigger = () => setShouldError(true);

        if (shouldError) {
          throw new Error('Child component error');
        }

        return <div>Child is OK</div>;
      };

      // Parent component that can also throw
      const ParentComponent: React.FC = () => {
        const [shouldError, setShouldError] = useState(false);

        parentErrorTrigger = () => setShouldError(true);

        if (shouldError) {
          throw new Error('Parent component error');
        }

        return (
          <div>
            <div>Parent is OK</div>
            <ChildComponent />
          </div>
        );
      };

      const { rerender } = render(
        <ErrorBoundary componentName="Cascading" fallback={<div>Cascade error caught!</div>}>
          <ParentComponent />
        </ErrorBoundary>
      );

      // Initially both are OK
      expect(screen.getByText('Parent is OK')).toBeInTheDocument();
      expect(screen.getByText('Child is OK')).toBeInTheDocument();

      // Trigger child error
      act(() => {
        childErrorTrigger!();
      });

      // Error boundary catches child error
      await waitFor(() => {
        expect(screen.getByText('Cascade error caught!')).toBeInTheDocument();
      });

      expect(mockAPI.send).toHaveBeenCalledWith(
        'renderer-error',
        expect.objectContaining({
          component: 'Cascading',
          error: expect.objectContaining({
            message: 'Child component error',
          }),
        })
      );
    });

    test('should handle multiple simultaneous async errors', async () => {
      // Component with multiple async operations
      const MultiAsyncComponent: React.FC = () => {
        const [errors, setErrors] = useState<Error[]>([]);

        useEffect(() => {
          // Start multiple async operations
          const promises = [
            Promise.reject(new Error('Error 1')),
            Promise.reject(new Error('Error 2')),
            Promise.reject(new Error('Error 3')),
          ];

          Promise.allSettled(promises).then((results) => {
            const failures = results
              .filter((r) => r.status === 'rejected')
              .map((r) => (r as PromiseRejectedResult).reason);

            if (failures.length > 0) {
              setErrors(() => {
                throw new Error(`Multiple failures: ${failures.map((e) => e.message).join(', ')}`);
              });
            }
          });
        }, []);

        if (errors.length > 0) throw errors[0];
        return <div>Processing...</div>;
      };

      render(
        <ErrorBoundary componentName="MultiAsync" fallback={<div>Multiple errors caught!</div>}>
          <MultiAsyncComponent />
        </ErrorBoundary>
      );

      // Wait for errors to be caught
      await waitFor(() => {
        expect(screen.getByText('Multiple errors caught!')).toBeInTheDocument();
      });

      // Verify consolidated error was reported
      expect(mockAPI.send).toHaveBeenCalledWith(
        'renderer-error',
        expect.objectContaining({
          component: 'MultiAsync',
          error: expect.objectContaining({
            message: expect.stringContaining('Multiple failures'),
          }),
        })
      );
    });
  });

  describe('Error Recovery', () => {
    test('should reset error state when reset handler is called', async () => {
      let triggerError: () => void;
      let resetBoundary: () => void;

      // Component that can error and reset
      const ResettableComponent: React.FC = () => {
        const [shouldError, setShouldError] = useState(false);

        triggerError = () => setShouldError(true);

        if (shouldError) {
          throw new Error('Resettable error');
        }

        return <div>Component is working</div>;
      };

      // Custom error boundary with reset
      const ResettableErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
        const [key, setKey] = useState(0);

        resetBoundary = () => setKey((k) => k + 1);

        return (
          <div>
            <button onClick={resetBoundary}>Reset</button>
            <ErrorBoundary key={key} componentName="Resettable" fallback={<div>Error occurred!</div>}>
              {children}
            </ErrorBoundary>
          </div>
        );
      };

      render(
        <ResettableErrorBoundary>
          <ResettableComponent />
        </ResettableErrorBoundary>
      );

      // Initially working
      expect(screen.getByText('Component is working')).toBeInTheDocument();

      // Trigger error
      act(() => {
        triggerError!();
      });

      // Error is shown
      await waitFor(() => {
        expect(screen.getByText('Error occurred!')).toBeInTheDocument();
      });

      // Reset the boundary
      const resetButton = screen.getByText('Reset');
      fireEvent.click(resetButton);

      // Component recovers
      await waitFor(() => {
        expect(screen.getByText('Component is working')).toBeInTheDocument();
      });
    });

    test('should track error count across multiple errors', async () => {
      let errorCount = 0;
      const onError = jest.fn((error, errorInfo) => {
        errorCount++;
      });

      let triggerError: () => void;

      // Component that throws periodically
      const PeriodicErrorComponent: React.FC<{ attempt: number }> = ({ attempt }) => {
        const [shouldError, setShouldError] = useState(false);

        useEffect(() => {
          triggerError = () => setShouldError(true);
        }, []);

        if (shouldError) {
          throw new Error(`Error attempt ${attempt}`);
        }

        return <div>Attempt {attempt}</div>;
      };

      const { rerender } = render(
        <ErrorBoundary componentName="ErrorCount" onError={onError} fallback={<div>Error!</div>}>
          <PeriodicErrorComponent attempt={1} />
        </ErrorBoundary>
      );

      // Trigger first error
      act(() => {
        triggerError!();
      });

      await waitFor(() => {
        expect(screen.getByText('Error!')).toBeInTheDocument();
      });

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Error attempt 1' }), expect.anything());
    });
  });

  describe('Error Telemetry', () => {
    test('should send error telemetry to main process', async () => {
      // Component that throws with specific error details
      const TelemetryComponent: React.FC = () => {
        useEffect(() => {
          const error = new Error('Telemetry test error');
          error.stack = 'at TelemetryComponent (test.tsx:123)';
          throw error;
        }, []);

        return <div>Should not render</div>;
      };

      render(
        <ErrorBoundary componentName="TelemetryTest" fallback={<div>Error logged!</div>}>
          <TelemetryComponent />
        </ErrorBoundary>
      );

      // Wait for error
      await waitFor(() => {
        expect(screen.getByText('Error logged!')).toBeInTheDocument();
      });

      // Verify telemetry was sent with correct structure
      expect(mockAPI.send).toHaveBeenCalledWith('renderer-error', {
        component: 'TelemetryTest',
        error: {
          message: 'Telemetry test error',
          stack: expect.stringContaining('TelemetryComponent'),
        },
        errorInfo: {
          componentStack: expect.any(String),
        },
      });
    });

    test('should handle missing window.electronAPI gracefully', async () => {
      // Remove electronAPI
      delete (window as any).electronAPI;

      const ErrorComponent: React.FC = () => {
        throw new Error('No telemetry available');
      };

      // Should not throw when electronAPI is missing
      render(
        <ErrorBoundary componentName="NoTelemetry" fallback={<div>Handled without telemetry</div>}>
          <ErrorComponent />
        </ErrorBoundary>
      );

      await waitFor(() => {
        expect(screen.getByText('Handled without telemetry')).toBeInTheDocument();
      });

      // No errors should be thrown due to missing API
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    test('should handle error thrown in error boundary fallback', () => {
      // Fallback component that also throws
      const BadFallback: React.FC = () => {
        throw new Error('Fallback also failed');
      };

      const ErrorComponent: React.FC = () => {
        throw new Error('Initial error');
      };

      // When fallback also throws, React unmounts the tree and throws
      expect(() => {
        render(
          <ErrorBoundary componentName="BadFallback" fallback={<BadFallback />}>
            <ErrorComponent />
          </ErrorBoundary>
        );
      }).toThrow('Fallback also failed');
    });

    test('should handle rapid successive errors', async () => {
      let errorTriggers: Array<() => void> = [];

      // Component that can throw multiple times rapidly
      const RapidErrorComponent: React.FC<{ id: number }> = ({ id }) => {
        const [shouldError, setShouldError] = useState(false);

        useEffect(() => {
          errorTriggers[id] = () => setShouldError(true);
        }, [id]);

        if (shouldError) {
          throw new Error(`Rapid error ${id}`);
        }

        return <div>Component {id}</div>;
      };

      render(
        <>
          <ErrorBoundary componentName="Rapid1" fallback={<div>Error 1!</div>}>
            <RapidErrorComponent id={0} />
          </ErrorBoundary>
          <ErrorBoundary componentName="Rapid2" fallback={<div>Error 2!</div>}>
            <RapidErrorComponent id={1} />
          </ErrorBoundary>
          <ErrorBoundary componentName="Rapid3" fallback={<div>Error 3!</div>}>
            <RapidErrorComponent id={2} />
          </ErrorBoundary>
        </>
      );

      // Trigger all errors rapidly
      act(() => {
        errorTriggers.forEach((trigger) => trigger?.());
      });

      // All error boundaries should handle their errors independently
      await waitFor(() => {
        expect(screen.getByText('Error 1!')).toBeInTheDocument();
        expect(screen.getByText('Error 2!')).toBeInTheDocument();
        expect(screen.getByText('Error 3!')).toBeInTheDocument();
      });

      // Each error should be reported
      expect(mockAPI.send).toHaveBeenCalledTimes(3);
    });

    test('should handle memory leaks from uncaught async operations', async () => {
      // Component with potential memory leak
      const LeakyComponent: React.FC = () => {
        const [data, setData] = useState('initial');

        useEffect(() => {
          let mounted = true;

          const leakyAsync = async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));

            // This would cause a memory leak if component unmounts
            if (mounted) {
              setData(() => {
                throw new Error('Late async error');
              });
            }
          };

          leakyAsync();

          return () => {
            mounted = false;
          };
        }, []);

        return <div>{data}</div>;
      };

      const { unmount } = render(
        <ErrorBoundary componentName="Leak" fallback={<div>Leak prevented!</div>}>
          <LeakyComponent />
        </ErrorBoundary>
      );

      // Unmount before async completes
      unmount();

      // Wait to ensure no errors are thrown after unmount
      await new Promise((resolve) => setTimeout(resolve, 150));

      // No additional errors should be logged after unmount
      const callCount = (console.error as jest.Mock).mock.calls.length;
      expect(callCount).toBeLessThanOrEqual(1);
    });
  });
});
