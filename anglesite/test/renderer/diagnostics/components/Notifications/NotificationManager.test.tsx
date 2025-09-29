/**
 * @file Tests for NotificationManager component
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { jest } from '@jest/globals';
import NotificationManager from '../../../../../src/renderer/diagnostics/components/Notifications/NotificationManager';
import type { ComponentError } from '../../../../../src/renderer/diagnostics/types/diagnostics';

// Mock ErrorNotification component
jest.mock('../../../../../src/renderer/diagnostics/components/Notifications/ErrorNotification', () => {
  return function MockErrorNotification({ error, isVisible, onDismiss, onViewDetails, onCopy, autoDismissDelay }: any) {
    return (
      <div data-testid={`mock-notification-${error.id}`} data-visible={isVisible}>
        <span>{error.message}</span>
        <span data-testid="severity">{error.severity}</span>
        <button onClick={() => onDismiss(error.id)}>Dismiss</button>
        {onViewDetails && <button onClick={() => onViewDetails(error.id)}>View Details</button>}
        <button onClick={() => onCopy(error.id)}>Copy</button>
        <span data-testid="auto-dismiss">{autoDismissDelay}</span>
      </div>
    );
  };
});

describe('NotificationManager', () => {
  const mockErrors: ComponentError[] = [
    {
      id: 'error-1',
      message: 'Critical database error',
      code: 'DB_CRITICAL_001',
      severity: 'CRITICAL' as any,
      category: 'SYSTEM' as any,
      timestamp: new Date('2024-01-01T10:00:00Z'),
      metadata: { operation: 'db-query', context: {}, stack: 'stack 1' },
    },
    {
      id: 'error-2',
      message: 'High priority network error',
      code: 'NET_HIGH_001',
      severity: 'HIGH' as any,
      category: 'NETWORK' as any,
      timestamp: new Date('2024-01-01T10:05:00Z'),
      metadata: { operation: 'api-call', context: {}, stack: 'stack 2' },
    },
    {
      id: 'error-3',
      message: 'Medium validation error',
      code: 'VAL_MEDIUM_001',
      severity: 'MEDIUM' as any,
      category: 'VALIDATION' as any,
      timestamp: new Date('2024-01-01T10:10:00Z'),
      metadata: { operation: 'input-validation', context: {}, stack: 'stack 3' },
    },
    {
      id: 'error-4',
      message: 'Another critical error',
      code: 'SYS_CRITICAL_002',
      severity: 'CRITICAL' as any,
      category: 'SYSTEM' as any,
      timestamp: new Date('2024-01-01T10:15:00Z'),
      metadata: { operation: 'system-check', context: {}, stack: 'stack 4' },
    },
  ];

  const mockOnNotificationDismiss = jest.fn();
  const mockOnViewErrorDetails = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('should not render when disabled', () => {
    render(
      <NotificationManager errors={mockErrors} enabled={false} onNotificationDismiss={mockOnNotificationDismiss} />
    );

    expect(screen.queryByTestId('notification-manager')).not.toBeInTheDocument();
  });

  test('should not render when no errors match severity filter', () => {
    render(
      <NotificationManager
        errors={mockErrors}
        severityFilter={['LOW']}
        onNotificationDismiss={mockOnNotificationDismiss}
      />
    );

    expect(screen.queryByTestId('notification-manager')).not.toBeInTheDocument();
  });

  test('should render notifications for matching severity levels', () => {
    render(
      <NotificationManager
        errors={mockErrors}
        severityFilter={['CRITICAL', 'HIGH']}
        onNotificationDismiss={mockOnNotificationDismiss}
      />
    );

    expect(screen.getByTestId('notification-manager')).toBeInTheDocument();

    // Should show critical and high errors only
    expect(screen.getByTestId('mock-notification-error-1')).toBeInTheDocument();
    expect(screen.getByTestId('mock-notification-error-2')).toBeInTheDocument();
    expect(screen.getByTestId('mock-notification-error-4')).toBeInTheDocument();

    // Should not show medium error
    expect(screen.queryByTestId('mock-notification-error-3')).not.toBeInTheDocument();
  });

  test('should limit notifications to maxVisible', () => {
    const maxVisible = 2;

    render(
      <NotificationManager
        errors={mockErrors}
        maxVisible={maxVisible}
        severityFilter={['CRITICAL', 'HIGH']}
        onNotificationDismiss={mockOnNotificationDismiss}
      />
    );

    const notifications = screen.getAllByTestId(/mock-notification-/);
    expect(notifications).toHaveLength(maxVisible);

    // Should show the 2 most recent errors (error-4 and error-2, since error-1 is older)
    expect(screen.getByTestId('mock-notification-error-4')).toBeInTheDocument();
    expect(screen.getByTestId('mock-notification-error-2')).toBeInTheDocument();
  });

  test('should pass correct props to ErrorNotification', () => {
    const autoDismissDelay = 8000;

    render(
      <NotificationManager
        errors={[mockErrors[0]]}
        autoDismissDelay={autoDismissDelay}
        onNotificationDismiss={mockOnNotificationDismiss}
        onViewErrorDetails={mockOnViewErrorDetails}
      />
    );

    const notification = screen.getByTestId('mock-notification-error-1');
    expect(notification).toHaveAttribute('data-visible', 'true');
    expect(screen.getByTestId('auto-dismiss')).toHaveTextContent(autoDismissDelay.toString());
  });

  test('should handle notification dismissal', () => {
    render(<NotificationManager errors={[mockErrors[0]]} onNotificationDismiss={mockOnNotificationDismiss} />);

    const dismissButton = screen.getByText('Dismiss');
    fireEvent.click(dismissButton);

    expect(mockOnNotificationDismiss).toHaveBeenCalledWith('error-1');
  });

  test('should handle view details action', () => {
    render(
      <NotificationManager
        errors={[mockErrors[0]]}
        onNotificationDismiss={mockOnNotificationDismiss}
        onViewErrorDetails={mockOnViewErrorDetails}
      />
    );

    const viewDetailsButton = screen.getByText('View Details');
    fireEvent.click(viewDetailsButton);

    expect(mockOnViewErrorDetails).toHaveBeenCalledWith('error-1');
  });

  test('should not show view details button when callback not provided', () => {
    render(<NotificationManager errors={[mockErrors[0]]} onNotificationDismiss={mockOnNotificationDismiss} />);

    expect(screen.queryByText('View Details')).not.toBeInTheDocument();
  });

  test('should track dismissed errors and not show them again', async () => {
    const { rerender } = render(
      <NotificationManager errors={[mockErrors[0]]} onNotificationDismiss={mockOnNotificationDismiss} />
    );

    // Dismiss the error
    const dismissButton = screen.getByText('Dismiss');
    fireEvent.click(dismissButton);

    // Re-render with same errors - should not show dismissed error
    rerender(<NotificationManager errors={[mockErrors[0]]} onNotificationDismiss={mockOnNotificationDismiss} />);

    expect(screen.queryByTestId('mock-notification-error-1')).not.toBeInTheDocument();
  });

  test('should show new errors after dismissal', () => {
    const { rerender } = render(
      <NotificationManager errors={[mockErrors[0]]} onNotificationDismiss={mockOnNotificationDismiss} />
    );

    // Dismiss the error
    const dismissButton = screen.getByText('Dismiss');
    fireEvent.click(dismissButton);

    // Add a new error
    rerender(
      <NotificationManager errors={[mockErrors[0], mockErrors[1]]} onNotificationDismiss={mockOnNotificationDismiss} />
    );

    // Should show the new error but not the dismissed one
    expect(screen.queryByTestId('mock-notification-error-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('mock-notification-error-2')).toBeInTheDocument();
  });

  test('should sort notifications by timestamp (newest first)', () => {
    render(
      <NotificationManager
        errors={mockErrors}
        maxVisible={3}
        severityFilter={['CRITICAL', 'HIGH']}
        onNotificationDismiss={mockOnNotificationDismiss}
      />
    );

    const notifications = screen.getAllByTestId(/mock-notification-/);

    // Should show error-4 (newest), error-2, error-1 (oldest)
    expect(notifications[0]).toHaveAttribute('data-testid', 'mock-notification-error-4');
    expect(notifications[1]).toHaveAttribute('data-testid', 'mock-notification-error-2');
    expect(notifications[2]).toHaveAttribute('data-testid', 'mock-notification-error-1');
  });

  test('should handle copy action', () => {
    render(<NotificationManager errors={[mockErrors[0]]} onNotificationDismiss={mockOnNotificationDismiss} />);

    const copyButton = screen.getByText('Copy');
    fireEvent.click(copyButton);

    // Should not call any callbacks, but should handle the copy internally
    expect(mockOnNotificationDismiss).not.toHaveBeenCalled();
  });

  test('should clean up dismissed IDs periodically', () => {
    render(<NotificationManager errors={[mockErrors[0]]} onNotificationDismiss={mockOnNotificationDismiss} />);

    // Dismiss an error
    const dismissButton = screen.getByText('Dismiss');
    fireEvent.click(dismissButton);

    // Fast-forward time by 5 minutes (cleanup interval)
    jest.advanceTimersByTime(5 * 60 * 1000);

    // Component should still be working (this is more of a memory leak test)
    expect(screen.queryByTestId('notification-manager')).not.toBeInTheDocument();
  });

  test('should handle rapid error additions', () => {
    const { rerender } = render(
      <NotificationManager errors={[]} maxVisible={2} onNotificationDismiss={mockOnNotificationDismiss} />
    );

    // Add errors rapidly
    rerender(
      <NotificationManager errors={[mockErrors[0]]} maxVisible={2} onNotificationDismiss={mockOnNotificationDismiss} />
    );

    rerender(
      <NotificationManager
        errors={[mockErrors[0], mockErrors[1]]}
        maxVisible={2}
        onNotificationDismiss={mockOnNotificationDismiss}
      />
    );

    rerender(
      <NotificationManager
        errors={[mockErrors[0], mockErrors[1], mockErrors[3]]}
        maxVisible={2}
        onNotificationDismiss={mockOnNotificationDismiss}
      />
    );

    // Should show only the 2 most recent
    const notifications = screen.getAllByTestId(/mock-notification-/);
    expect(notifications).toHaveLength(2);
    expect(screen.getByTestId('mock-notification-error-4')).toBeInTheDocument();
    expect(screen.getByTestId('mock-notification-error-2')).toBeInTheDocument();
  });

  test('should handle errors with same timestamp', () => {
    const sameTimestampErrors = mockErrors.map((error, index) => ({
      ...error,
      id: `same-time-${index}`,
      timestamp: new Date('2024-01-01T10:00:00Z'),
    }));

    render(
      <NotificationManager
        errors={sameTimestampErrors}
        maxVisible={2}
        onNotificationDismiss={mockOnNotificationDismiss}
      />
    );

    const notifications = screen.getAllByTestId(/mock-notification-/);
    expect(notifications).toHaveLength(2);
  });
});
