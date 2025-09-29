/**
 * @file Tests for ErrorFilters component
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { jest } from '@jest/globals';
import ErrorFilters from '../../../../../src/renderer/diagnostics/components/Filters/ErrorFilters';
import type {
  FilterState,
  ErrorSeverity,
  ErrorCategory,
} from '../../../../../src/renderer/diagnostics/types/diagnostics';

describe('ErrorFilters', () => {
  const defaultFilter: FilterState = {
    severity: [],
    category: [],
    dateRange: { start: null, end: null },
    searchText: '',
    isActive: false,
  };

  const mockOnFilterChange = jest.fn();
  const mockOnFilterClear = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should render filter component', () => {
    render(
      <ErrorFilters filter={defaultFilter} onFilterChange={mockOnFilterChange} onFilterClear={mockOnFilterClear} />
    );

    expect(screen.getByTestId('error-filters')).toBeInTheDocument();
    expect(screen.getByTestId('filters-header')).toBeInTheDocument();
    expect(screen.getByText('Filters')).toBeInTheDocument();
  });

  test('should handle search input changes', () => {
    render(
      <ErrorFilters filter={defaultFilter} onFilterChange={mockOnFilterChange} onFilterClear={mockOnFilterClear} />
    );

    const searchInput = screen.getByTestId('search-input');
    fireEvent.change(searchInput, { target: { value: 'test search' } });

    expect(mockOnFilterChange).toHaveBeenCalledWith({ searchText: 'test search' });
  });

  test('should handle severity filter changes', () => {
    render(
      <ErrorFilters filter={defaultFilter} onFilterChange={mockOnFilterChange} onFilterClear={mockOnFilterClear} />
    );

    const criticalCheckbox = screen.getByTestId('severity-filter-critical');
    fireEvent.click(criticalCheckbox);

    expect(mockOnFilterChange).toHaveBeenCalledWith({ severity: ['CRITICAL'] });
  });

  test('should handle category filter changes', () => {
    render(
      <ErrorFilters filter={defaultFilter} onFilterChange={mockOnFilterChange} onFilterClear={mockOnFilterClear} />
    );

    const systemCheckbox = screen.getByTestId('category-filter-system');
    fireEvent.click(systemCheckbox);

    expect(mockOnFilterChange).toHaveBeenCalledWith({ category: ['SYSTEM'] });
  });

  test('should handle date range changes', () => {
    render(
      <ErrorFilters filter={defaultFilter} onFilterChange={mockOnFilterChange} onFilterClear={mockOnFilterClear} />
    );

    const startDateInput = screen.getByTestId('date-range-start');
    fireEvent.change(startDateInput, { target: { value: '2024-01-01T10:00' } });

    expect(mockOnFilterChange).toHaveBeenCalledWith({
      dateRange: { start: new Date('2024-01-01T10:00'), end: null },
    });
  });

  test('should show active filter count', () => {
    const activeFilter: FilterState = {
      severity: ['CRITICAL' as ErrorSeverity],
      category: ['SYSTEM' as ErrorCategory],
      dateRange: { start: null, end: null },
      searchText: 'test',
      isActive: true,
    };

    render(
      <ErrorFilters filter={activeFilter} onFilterChange={mockOnFilterChange} onFilterClear={mockOnFilterClear} />
    );

    // Should show badge with count of 3 (severity + category + search)
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  test('should handle clear filters', () => {
    const activeFilter: FilterState = {
      severity: ['CRITICAL' as ErrorSeverity],
      category: ['SYSTEM' as ErrorCategory],
      dateRange: { start: null, end: null },
      searchText: 'test',
      isActive: true,
    };

    render(
      <ErrorFilters filter={activeFilter} onFilterChange={mockOnFilterChange} onFilterClear={mockOnFilterClear} />
    );

    const clearButton = screen.getByTestId('clear-filters-button');
    fireEvent.click(clearButton);

    expect(mockOnFilterClear).toHaveBeenCalled();
  });

  test('should render in compact mode', () => {
    render(
      <ErrorFilters
        filter={defaultFilter}
        onFilterChange={mockOnFilterChange}
        onFilterClear={mockOnFilterClear}
        compact={true}
      />
    );

    const toggleButton = screen.getByTestId('toggle-filters-button');
    expect(toggleButton).toBeInTheDocument();
    expect(toggleButton).toHaveTextContent('▼'); // Collapsed by default in compact mode
  });

  test('should handle expand/collapse in compact mode', () => {
    render(
      <ErrorFilters
        filter={defaultFilter}
        onFilterChange={mockOnFilterChange}
        onFilterClear={mockOnFilterClear}
        compact={true}
      />
    );

    const toggleButton = screen.getByTestId('toggle-filters-button');
    expect(toggleButton).toHaveTextContent('▼');

    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveTextContent('▲');
  });

  test('should show filter summary when filters are active', () => {
    const activeFilter: FilterState = {
      severity: ['CRITICAL' as ErrorSeverity, 'HIGH' as ErrorSeverity],
      category: ['SYSTEM' as ErrorCategory],
      dateRange: {
        start: new Date('2024-01-01'),
        end: new Date('2024-01-31'),
      },
      searchText: 'test error',
      isActive: true,
    };

    render(
      <ErrorFilters filter={activeFilter} onFilterChange={mockOnFilterChange} onFilterClear={mockOnFilterClear} />
    );

    expect(screen.getByText('Active Filters (4)')).toBeInTheDocument();
    expect(screen.getByText('• Search: "test error"')).toBeInTheDocument();
    expect(screen.getByText('• Severity: Critical, High')).toBeInTheDocument();
    expect(screen.getByText('• Category: System')).toBeInTheDocument();
    expect(screen.getByText(/• Date Range:/)).toBeInTheDocument();
  });

  test('should format category labels correctly', () => {
    render(
      <ErrorFilters
        filter={defaultFilter}
        onFilterChange={mockOnFilterChange}
        onFilterClear={mockOnFilterClear}
        availableCategories={['FILE_SYSTEM' as ErrorCategory, 'BUSINESS_LOGIC' as ErrorCategory]}
      />
    );

    expect(screen.getByText('File System')).toBeInTheDocument();
    expect(screen.getByText('Business Logic')).toBeInTheDocument();
  });

  test('should show checked state for selected filters', () => {
    const activeFilter: FilterState = {
      severity: ['CRITICAL' as ErrorSeverity],
      category: ['SYSTEM' as ErrorCategory],
      dateRange: { start: null, end: null },
      searchText: '',
      isActive: true,
    };

    render(
      <ErrorFilters filter={activeFilter} onFilterChange={mockOnFilterChange} onFilterClear={mockOnFilterClear} />
    );

    const criticalCheckbox = screen.getByTestId('severity-filter-critical') as HTMLInputElement;
    const systemCheckbox = screen.getByTestId('category-filter-system') as HTMLInputElement;

    expect(criticalCheckbox.checked).toBe(true);
    expect(systemCheckbox.checked).toBe(true);
  });

  test('should handle unchecking filters', () => {
    const activeFilter: FilterState = {
      severity: ['CRITICAL' as ErrorSeverity, 'HIGH' as ErrorSeverity],
      category: [],
      dateRange: { start: null, end: null },
      searchText: '',
      isActive: true,
    };

    render(
      <ErrorFilters filter={activeFilter} onFilterChange={mockOnFilterChange} onFilterClear={mockOnFilterClear} />
    );

    const criticalCheckbox = screen.getByTestId('severity-filter-critical');
    fireEvent.click(criticalCheckbox);

    // Should remove CRITICAL but keep HIGH
    expect(mockOnFilterChange).toHaveBeenCalledWith({ severity: ['HIGH'] });
  });

  test('should handle clearing date range', () => {
    const activeFilter: FilterState = {
      severity: [],
      category: [],
      dateRange: {
        start: new Date('2024-01-01'),
        end: new Date('2024-01-31'),
      },
      searchText: '',
      isActive: true,
    };

    render(
      <ErrorFilters filter={activeFilter} onFilterChange={mockOnFilterChange} onFilterClear={mockOnFilterClear} />
    );

    const startDateInput = screen.getByTestId('date-range-start');
    fireEvent.change(startDateInput, { target: { value: '' } });

    expect(mockOnFilterChange).toHaveBeenCalledWith({
      dateRange: { start: null, end: new Date('2024-01-31') },
    });
  });
});
