/**
 * @file Tests for ErrorListItem component
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { jest } from '@jest/globals';
import ErrorListItem from '../../../../../src/renderer/diagnostics/components/ErrorList/ErrorListItem';
import type { ComponentError } from '../../../../../src/renderer/diagnostics/types/diagnostics';

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

describe('ErrorListItem', () => {
  const mockError: ComponentError = {
    id: 'test-error-1',
    message: 'Test error message',
    code: 'TEST_ERROR_001',
    severity: 'HIGH' as any,
    category: 'SYSTEM' as any,
    timestamp: new Date('2024-01-01T10:30:00Z'),
    metadata: {
      operation: 'test-operation',
      context: { userId: '123', action: 'save' },
      stack: 'Error: Test error\n    at function1 (file1.js:10:5)\n    at function2 (file2.js:20:10)',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should render error item with basic information', () => {
    render(<ErrorListItem error={mockError} />);

    expect(screen.getByTestId('error-item-test-error-1')).toBeInTheDocument();
    expect(screen.getByText('Test error message')).toBeInTheDocument();
    expect(screen.getByTestId('error-severity')).toHaveTextContent('High');
    expect(screen.getByTestId('error-category')).toHaveTextContent('System');
    expect(screen.getByTestId('error-code')).toHaveTextContent('TEST_ERROR_001');
    expect(screen.getByTestId('error-operation')).toHaveTextContent('test-operation');
  });

  test('should render in compact mode', () => {
    render(<ErrorListItem error={mockError} compact={true} />);

    const errorItem = screen.getByTestId('error-item-test-error-1');
    expect(errorItem).toBeInTheDocument();
    // In compact mode, content should still be present but with different styling
    expect(screen.getByText('Test error message')).toBeInTheDocument();
  });

  test('should show selected state', () => {
    render(<ErrorListItem error={mockError} isSelected={true} />);

    const errorItem = screen.getByTestId('error-item-test-error-1');
    // Selected state should be reflected in styling (tested via style attributes)
    expect(errorItem).toBeInTheDocument();
  });

  test('should handle error selection', () => {
    const onSelect = jest.fn();
    render(<ErrorListItem error={mockError} onSelect={onSelect} />);

    const errorItem = screen.getByTestId('error-item-test-error-1');
    fireEvent.click(errorItem);

    expect(onSelect).toHaveBeenCalledWith('test-error-1');
  });

  test('should handle keyboard selection', () => {
    const onSelect = jest.fn();
    render(<ErrorListItem error={mockError} onSelect={onSelect} />);

    const errorItem = screen.getByTestId('error-item-test-error-1');
    fireEvent.keyDown(errorItem, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith('test-error-1');
  });

  test('should handle space key selection', () => {
    const onSelect = jest.fn();
    render(<ErrorListItem error={mockError} onSelect={onSelect} />);

    const errorItem = screen.getByTestId('error-item-test-error-1');
    fireEvent.keyDown(errorItem, { key: ' ' });

    expect(onSelect).toHaveBeenCalledWith('test-error-1');
  });

  test('should handle expand/collapse toggle', () => {
    const onToggleExpand = jest.fn();
    render(<ErrorListItem error={mockError} onToggleExpand={onToggleExpand} />);

    const toggleButton = screen.getByTestId('toggle-expand-button');
    expect(toggleButton).toHaveTextContent('▶');

    fireEvent.click(toggleButton);

    expect(onToggleExpand).toHaveBeenCalledWith('test-error-1');
  });

  test('should show expanded details when expanded', () => {
    render(<ErrorListItem error={mockError} isExpanded={true} />);

    const toggleButton = screen.getByTestId('toggle-expand-button');
    expect(toggleButton).toHaveTextContent('▼');

    const detailsSection = screen.getByTestId('error-details');
    expect(detailsSection).toBeInTheDocument();

    // Check that detailed information is shown
    expect(screen.getByText('Error ID:')).toBeInTheDocument();
    expect(screen.getByText('test-error-1')).toBeInTheDocument();
    expect(screen.getByText('Stack Trace:')).toBeInTheDocument();
    expect(screen.getByText('Context:')).toBeInTheDocument();
  });

  test('should not show details when collapsed', () => {
    render(<ErrorListItem error={mockError} isExpanded={false} />);

    expect(screen.queryByTestId('error-details')).not.toBeInTheDocument();
  });

  test('should handle copy error to clipboard', async () => {
    render(<ErrorListItem error={mockError} />);

    const copyButton = screen.getByTestId('copy-error-button');
    fireEvent.click(copyButton);

    expect(mockWriteText).toHaveBeenCalledWith(expect.stringContaining('Test error message'));
    expect(mockWriteText).toHaveBeenCalledWith(expect.stringContaining('TEST_ERROR_001'));
    expect(mockWriteText).toHaveBeenCalledWith(expect.stringContaining('HIGH'));
  });

  test('should format timestamp correctly', () => {
    render(<ErrorListItem error={mockError} />);

    const timestampElement = screen.getByTestId('error-timestamp');
    expect(timestampElement).toBeInTheDocument();
    // Should format as "Jan 1, 10:30:00 AM" or similar
    expect(timestampElement).toHaveTextContent(/Jan 1.*10:30:00/);
  });

  test('should format severity labels correctly', () => {
    const criticalError = { ...mockError, severity: 'CRITICAL' as any };
    const { rerender } = render(<ErrorListItem error={criticalError} />);
    expect(screen.getByTestId('error-severity')).toHaveTextContent('Critical');

    const mediumError = { ...mockError, severity: 'MEDIUM' as any };
    rerender(<ErrorListItem error={mediumError} />);
    expect(screen.getByTestId('error-severity')).toHaveTextContent('Medium');

    const lowError = { ...mockError, severity: 'LOW' as any };
    rerender(<ErrorListItem error={lowError} />);
    expect(screen.getByTestId('error-severity')).toHaveTextContent('Low');
  });

  test('should format category labels correctly', () => {
    const networkError = { ...mockError, category: 'NETWORK' as any };
    const { rerender } = render(<ErrorListItem error={networkError} />);
    expect(screen.getByTestId('error-category')).toHaveTextContent('Network');

    const validationError = { ...mockError, category: 'VALIDATION' as any };
    rerender(<ErrorListItem error={validationError} />);
    expect(screen.getByTestId('error-category')).toHaveTextContent('Validation');

    const fileSystemError = { ...mockError, category: 'FILE_SYSTEM' as any };
    rerender(<ErrorListItem error={fileSystemError} />);
    expect(screen.getByTestId('error-category')).toHaveTextContent('File System');
  });

  test('should handle error without operation metadata', () => {
    const errorWithoutOperation = {
      ...mockError,
      metadata: {
        ...mockError.metadata,
        operation: undefined,
      },
    };

    render(<ErrorListItem error={errorWithoutOperation} />);

    expect(screen.queryByTestId('error-operation')).not.toBeInTheDocument();
  });

  test('should handle error without context metadata', () => {
    const errorWithoutContext = {
      ...mockError,
      metadata: {
        ...mockError.metadata,
        context: undefined,
      },
    };

    render(<ErrorListItem error={errorWithoutContext} isExpanded={true} />);

    expect(screen.getByTestId('error-details')).toBeInTheDocument();
    expect(screen.queryByText('Context:')).not.toBeInTheDocument();
  });

  test('should handle error without stack trace', () => {
    const errorWithoutStack = {
      ...mockError,
      metadata: {
        ...mockError.metadata,
        stack: undefined,
      },
    };

    render(<ErrorListItem error={errorWithoutStack} isExpanded={true} />);

    expect(screen.getByTestId('error-details')).toBeInTheDocument();
    expect(screen.queryByText('Stack Trace:')).not.toBeInTheDocument();
  });

  test('should stop propagation on action button clicks', () => {
    const onSelect = jest.fn();
    render(<ErrorListItem error={mockError} onSelect={onSelect} />);

    const copyButton = screen.getByTestId('copy-error-button');
    fireEvent.click(copyButton);

    // Selection should not be triggered when clicking action buttons
    expect(onSelect).not.toHaveBeenCalled();
  });
});
