/**
 * @file Tests for ErrorNotification component
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { jest } from '@jest/globals';
import ErrorNotification from '../../../../../src/renderer/diagnostics/components/Notifications/ErrorNotification';
import type { ComponentError } from '../../../../../src/renderer/diagnostics/types/diagnostics';
import { ErrorSeverity } from '../../../../../src/renderer/diagnostics/types/diagnostics';

// Mock clipboard API
const mockWriteText = jest.fn();
Object.defineProperty(window, 'electronAPI', {
  value: {
    clipboard: {
      writeText: mockWriteText,
    },
  },
  writable: true,
});

// Mock navigator clipboard as fallback
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: jest.fn(),
  },
  writable: true,
});

describe('ErrorNotification', () => {
  const mockError: ComponentError = {
    id: 'test-error-1',
    message: 'Critical system error occurred',
    code: 'SYS_CRITICAL_001',
    severity: 'CRITICAL' as any,
    category: 'SYSTEM' as any,
    timestamp: new Date('2024-01-01T10:30:00Z'),
    metadata: {
      operation: 'database-connection',
      context: { userId: '123', database: 'main' },
      stack: 'Error: Connection failed\n    at connect (db.js:45:12)',
    },
  };

  const mockOnDismiss = jest.fn();
  const mockOnViewDetails = jest.fn();
  const mockOnCopy = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('should render visible notification', () => {
    render(
      <ErrorNotification
        error={mockError}
        isVisible={true}
        onDismiss={mockOnDismiss}
        onViewDetails={mockOnViewDetails}
        onCopy={mockOnCopy}
      />
    );

    expect(screen.getByTestId(`error-notification-${mockError.id}`)).toBeInTheDocument();
    expect(screen.getByText('Critical Error')).toBeInTheDocument();
    expect(screen.getByText(mockError.message)).toBeInTheDocument();
    expect(screen.getByText(`Code: ${mockError.code}`)).toBeInTheDocument();
    expect(screen.getByText('Operation: database-connection')).toBeInTheDocument();
  });

  test('should not render when not visible', () => {
    render(<ErrorNotification error={mockError} isVisible={false} onDismiss={mockOnDismiss} />);

    expect(screen.queryByTestId(`error-notification-${mockError.id}`)).not.toBeInTheDocument();
  });

  test('should handle dismiss action', () => {
    render(<ErrorNotification error={mockError} isVisible={true} onDismiss={mockOnDismiss} />);

    const dismissButton = screen.getByTestId('dismiss-notification');
    fireEvent.click(dismissButton);

    expect(mockOnDismiss).toHaveBeenCalledWith(mockError.id);
  });

  test('should handle view details action', () => {
    render(
      <ErrorNotification
        error={mockError}
        isVisible={true}
        onDismiss={mockOnDismiss}
        onViewDetails={mockOnViewDetails}
      />
    );

    const viewDetailsButton = screen.getByTestId('view-error-details');
    fireEvent.click(viewDetailsButton);

    expect(mockOnViewDetails).toHaveBeenCalledWith(mockError.id);
  });

  test('should handle copy action with electron API', async () => {
    render(<ErrorNotification error={mockError} isVisible={true} onDismiss={mockOnDismiss} onCopy={mockOnCopy} />);

    const copyButton = screen.getByTestId('copy-error-notification');
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith(expect.stringContaining(mockError.message));
      expect(mockWriteText).toHaveBeenCalledWith(expect.stringContaining(mockError.code));
      expect(mockWriteText).toHaveBeenCalledWith(expect.stringContaining('CRITICAL'));
      expect(mockOnCopy).toHaveBeenCalledWith(mockError.id);
    });
  });

  test('should handle copy action with navigator clipboard fallback', async () => {
    // Remove electron API temporarily
    const originalElectronAPI = window.electronAPI;
    Object.defineProperty(window, 'electronAPI', {
      value: undefined,
      writable: true,
    });

    render(<ErrorNotification error={mockError} isVisible={true} onDismiss={mockOnDismiss} onCopy={mockOnCopy} />);

    const copyButton = screen.getByTestId('copy-error-notification');
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining(mockError.message));
    });

    // Restore electron API
    Object.defineProperty(window, 'electronAPI', {
      value: originalElectronAPI,
      writable: true,
    });
  });

  test('should auto-dismiss after delay', () => {
    const autoDismissDelay = 5000;

    render(
      <ErrorNotification
        error={mockError}
        isVisible={true}
        onDismiss={mockOnDismiss}
        autoDismissDelay={autoDismissDelay}
      />
    );

    // Fast-forward time
    jest.advanceTimersByTime(autoDismissDelay);

    expect(mockOnDismiss).toHaveBeenCalledWith(mockError.id);
  });

  test('should not auto-dismiss when delay is 0', () => {
    render(<ErrorNotification error={mockError} isVisible={true} onDismiss={mockOnDismiss} autoDismissDelay={0} />);

    // Fast-forward time significantly
    jest.advanceTimersByTime(60000);

    expect(mockOnDismiss).not.toHaveBeenCalled();
  });

  test('should display correct severity styling for different severities', () => {
    const severities: Array<ComponentError['severity']> = [
      ErrorSeverity.CRITICAL,
      ErrorSeverity.HIGH,
      ErrorSeverity.MEDIUM,
      ErrorSeverity.LOW,
    ];

    severities.forEach((severity) => {
      const error = { ...mockError, severity };
      const { rerender } = render(<ErrorNotification error={error} isVisible={true} onDismiss={mockOnDismiss} />);

      const expectedText = severity.charAt(0).toUpperCase() + severity.slice(1).toLowerCase() + ' Error';
      expect(screen.getByText(expectedText)).toBeInTheDocument();

      // Check for appropriate emoji
      const expectedEmojis = {
        CRITICAL: '🔴',
        HIGH: '🟠',
        MEDIUM: '🔵',
        LOW: '🟢',
      };
      expect(screen.getByText(expectedEmojis[severity])).toBeInTheDocument();

      rerender(<ErrorNotification error={error} isVisible={false} onDismiss={mockOnDismiss} />);
    });
  });

  test('should format timestamp correctly', () => {
    render(<ErrorNotification error={mockError} isVisible={true} onDismiss={mockOnDismiss} />);

    // Should show relative time like "Just now", "5 minutes ago", etc.
    // Since we're using fake timers, it should show "Just now"
    expect(screen.getByText(/Time: /)).toBeInTheDocument();
  });

  test('should handle error without operation metadata', () => {
    const errorWithoutOperation = {
      ...mockError,
      metadata: {
        ...mockError.metadata,
        operation: undefined,
      },
    };

    render(<ErrorNotification error={errorWithoutOperation} isVisible={true} onDismiss={mockOnDismiss} />);

    expect(screen.queryByText(/Operation:/)).not.toBeInTheDocument();
  });

  test('should not show view details button when callback is not provided', () => {
    render(<ErrorNotification error={mockError} isVisible={true} onDismiss={mockOnDismiss} />);

    expect(screen.queryByTestId('view-error-details')).not.toBeInTheDocument();
  });

  test('should have proper accessibility attributes', () => {
    render(<ErrorNotification error={mockError} isVisible={true} onDismiss={mockOnDismiss} />);

    const notification = screen.getByTestId(`error-notification-${mockError.id}`);
    expect(notification).toHaveAttribute('role', 'alert');
    expect(notification).toHaveAttribute('aria-live', 'assertive');
  });

  test('should handle dismiss button action', () => {
    render(<ErrorNotification error={mockError} isVisible={true} onDismiss={mockOnDismiss} />);

    const dismissButton = screen.getByTestId('dismiss-error-notification');
    fireEvent.click(dismissButton);

    expect(mockOnDismiss).toHaveBeenCalledWith(mockError.id);
  });

  test('should show proper button states and interactions', () => {
    render(
      <ErrorNotification
        error={mockError}
        isVisible={true}
        onDismiss={mockOnDismiss}
        onViewDetails={mockOnViewDetails}
      />
    );

    // Check all buttons are present and have correct labels
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText('Dismiss')).toBeInTheDocument();

    // Check button tooltips/titles
    expect(screen.getByTitle('Copy error details to clipboard')).toBeInTheDocument();
    expect(screen.getByTitle('View full error details')).toBeInTheDocument();
    expect(screen.getByTitle('Dismiss this notification')).toBeInTheDocument();
  });

  test('should handle copy error gracefully', async () => {
    // Mock clipboard to throw error
    mockWriteText.mockRejectedValue(new Error('Clipboard access denied'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(<ErrorNotification error={mockError} isVisible={true} onDismiss={mockOnDismiss} onCopy={mockOnCopy} />);

    const copyButton = screen.getByTestId('copy-error-notification');
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to copy error:', expect.any(Error));
    });

    // Should not call onCopy callback when copy fails
    expect(mockOnCopy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
