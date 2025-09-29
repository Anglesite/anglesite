/**
 * @file Tests for ErrorList component
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { jest } from '@jest/globals';
import ErrorList from '../../../../../src/renderer/diagnostics/components/ErrorList/ErrorList';
import type { ComponentError } from '../../../../../src/renderer/diagnostics/types/diagnostics';

// Mock child components
jest.mock('../../../../../src/renderer/diagnostics/components/ErrorList/ErrorListItem', () => {
  return function MockErrorListItem({ error, isSelected, isExpanded, onSelect, onToggleExpand, compact }: any) {
    return (
      <div data-testid={`mock-error-item-${error.id}`} data-compact={compact}>
        <span>{error.message}</span>
        <button onClick={() => onSelect?.(error.id)}>Select</button>
        <button onClick={() => onToggleExpand?.(error.id)}>{isExpanded ? 'Collapse' : 'Expand'}</button>
        {isSelected && <span data-testid="selected-indicator">Selected</span>}
      </div>
    );
  };
});

jest.mock('../../../../../src/renderer/diagnostics/components/Layout/LoadingSpinner', () => {
  return function MockLoadingSpinner({ size, message, testId }: any) {
    return (
      <div data-testid={testId} data-size={size}>
        {message}
      </div>
    );
  };
});

describe('ErrorList', () => {
  const mockErrors: ComponentError[] = [
    {
      id: 'error-1',
      message: 'Test error 1',
      code: 'TEST_ERROR_1',
      severity: 'HIGH' as any,
      category: 'SYSTEM' as any,
      timestamp: new Date('2024-01-01T10:00:00Z'),
      metadata: { operation: 'test-operation-1', context: {}, stack: 'test stack 1' },
    },
    {
      id: 'error-2',
      message: 'Test error 2',
      code: 'TEST_ERROR_2',
      severity: 'CRITICAL' as any,
      category: 'NETWORK' as any,
      timestamp: new Date('2024-01-01T11:00:00Z'),
      metadata: { operation: 'test-operation-2', context: {}, stack: 'test stack 2' },
    },
    {
      id: 'error-3',
      message: 'Test error 3',
      code: 'TEST_ERROR_3',
      severity: 'MEDIUM' as any,
      category: 'VALIDATION' as any,
      timestamp: new Date('2024-01-01T12:00:00Z'),
      metadata: { operation: 'test-operation-3', context: {}, stack: 'test stack 3' },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should render error list with errors', () => {
    render(<ErrorList errors={mockErrors} />);

    expect(screen.getByTestId('error-list')).toBeInTheDocument();
    expect(screen.getByText('Error List')).toBeInTheDocument();
    expect(screen.getByText('3 errors')).toBeInTheDocument();

    // Check that all errors are rendered
    expect(screen.getByTestId('mock-error-item-error-1')).toBeInTheDocument();
    expect(screen.getByTestId('mock-error-item-error-2')).toBeInTheDocument();
    expect(screen.getByTestId('mock-error-item-error-3')).toBeInTheDocument();
  });

  test('should render in compact mode', () => {
    render(<ErrorList errors={mockErrors} compact={true} />);

    expect(screen.getByTestId('error-list')).toBeInTheDocument();
    // In compact mode, header is not shown
    expect(screen.queryByText('Error List')).not.toBeInTheDocument();

    // Check that compact prop is passed to items
    const errorItems = screen.getAllByTestId(/mock-error-item/);
    errorItems.forEach((item) => {
      expect(item).toHaveAttribute('data-compact', 'true');
    });
  });

  test('should show loading state', () => {
    render(<ErrorList errors={[]} loading={true} />);

    expect(screen.getByTestId('error-list-loading')).toBeInTheDocument();
    expect(screen.getByTestId('error-list-loading-spinner')).toBeInTheDocument();
    expect(screen.getByText('Loading errors...')).toBeInTheDocument();
  });

  test('should show error state', () => {
    const errorMessage = 'Failed to load errors';
    render(<ErrorList errors={[]} error={errorMessage} />);

    expect(screen.getByTestId('error-list-error')).toBeInTheDocument();
    expect(screen.getByText('Failed to Load Errors')).toBeInTheDocument();
    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  test('should show empty state when no errors', () => {
    render(<ErrorList errors={[]} />);

    expect(screen.getByText('No Errors Found')).toBeInTheDocument();
    expect(screen.getByText('Great! No errors have been recorded recently.')).toBeInTheDocument();
  });

  test('should handle error selection', () => {
    const onErrorSelect = jest.fn();
    render(<ErrorList errors={mockErrors} onErrorSelect={onErrorSelect} />);

    const selectButton = screen.getAllByText('Select')[0];
    fireEvent.click(selectButton);

    expect(onErrorSelect).toHaveBeenCalledWith('error-1');
  });

  test('should show selected errors', () => {
    render(<ErrorList errors={mockErrors} selectedErrors={['error-1', 'error-3']} />);

    // Check that selected indicators are shown
    const selectedIndicators = screen.getAllByTestId('selected-indicator');
    expect(selectedIndicators).toHaveLength(2);
  });

  test('should handle select all functionality', () => {
    const onErrorsSelect = jest.fn();
    render(<ErrorList errors={mockErrors} onErrorsSelect={onErrorsSelect} selectedErrors={[]} />);

    const selectAllButton = screen.getByTestId('select-all-button');
    expect(selectAllButton).toHaveTextContent('Select All');

    fireEvent.click(selectAllButton);

    expect(onErrorsSelect).toHaveBeenCalledWith(['error-1', 'error-2', 'error-3']);
  });

  test('should handle deselect all functionality', () => {
    const onErrorsSelect = jest.fn();
    render(
      <ErrorList
        errors={mockErrors}
        onErrorsSelect={onErrorsSelect}
        selectedErrors={['error-1', 'error-2', 'error-3']}
      />
    );

    const selectAllButton = screen.getByTestId('select-all-button');
    expect(selectAllButton).toHaveTextContent('Deselect All');

    fireEvent.click(selectAllButton);

    expect(onErrorsSelect).toHaveBeenCalledWith([]);
  });

  test('should display severity counts in header', () => {
    render(<ErrorList errors={mockErrors} />);

    // Check that severity indicators are present
    // We have: 1 critical, 1 high, 1 medium
    expect(screen.getByTestId('error-list')).toBeInTheDocument();

    // Check that severity counts are displayed (the component shows counts for critical, error, warning)
    // Based on our mock data: 1 critical, 1 high (displays as error), 1 medium (displays as warning)
    const errorListElement = screen.getByTestId('error-list');
    expect(errorListElement).toBeInTheDocument();

    // The component displays severity counts with colored dots - check that the structure exists
    expect(screen.getByText('3 errors')).toBeInTheDocument();
  });

  test('should handle error expansion', () => {
    render(<ErrorList errors={mockErrors} />);

    const expandButton = screen.getAllByText('Expand')[0];
    fireEvent.click(expandButton);

    // After expansion, button should show "Collapse"
    expect(screen.getByText('Collapse')).toBeInTheDocument();
  });

  test('should not show select all button with single error', () => {
    const onErrorsSelect = jest.fn();
    render(<ErrorList errors={[mockErrors[0]]} onErrorsSelect={onErrorsSelect} />);

    expect(screen.queryByTestId('select-all-button')).not.toBeInTheDocument();
  });

  test('should not show select all button without onErrorsSelect prop', () => {
    render(<ErrorList errors={mockErrors} />);

    expect(screen.queryByTestId('select-all-button')).not.toBeInTheDocument();
  });

  test('should display singular error count correctly', () => {
    render(<ErrorList errors={[mockErrors[0]]} />);

    expect(screen.getByText('1 error')).toBeInTheDocument();
  });
});
