/**
 * @file useErrorFilters hook
 * @description Custom hook for managing error filtering logic and state
 */
import { useState, useMemo, useCallback } from 'react';
import type { ComponentError, FilterState, ErrorSeverity, ErrorCategory } from '../types/diagnostics';

export interface UseErrorFiltersOptions {
  /** Initial filter state */
  initialFilter?: Partial<FilterState>;
  /** Whether to perform case-sensitive search */
  caseSensitive?: boolean;
}

export interface UseErrorFiltersReturn {
  /** Current filter state */
  filter: FilterState;
  /** Set the complete filter state */
  setFilter: (filter: FilterState) => void;
  /** Update partial filter state */
  updateFilter: (update: Partial<FilterState>) => void;
  /** Clear all filters */
  clearFilter: () => void;
  /** Set search text */
  setSearchText: (text: string) => void;
  /** Set severity filters */
  setSeverityFilter: (severities: ErrorSeverity[]) => void;
  /** Set category filters */
  setCategoryFilter: (categories: ErrorCategory[]) => void;
  /** Set date range */
  setDateRange: (start: Date | null, end: Date | null) => void;
  /** Filter errors based on current filter state */
  filterErrors: (errors: ComponentError[]) => ComponentError[];
  /** Get filter statistics */
  getFilterStats: (errors: ComponentError[]) => {
    total: number;
    filtered: number;
    hidden: number;
    percentage: number;
  };
}

const defaultFilter: FilterState = {
  severity: [],
  category: [],
  dateRange: { start: null, end: null },
  searchText: '',
  isActive: false,
};

export const useErrorFilters = (options: UseErrorFiltersOptions = {}): UseErrorFiltersReturn => {
  const { initialFilter = {}, caseSensitive = false } = options;

  const [filter, setFilterState] = useState<FilterState>({
    ...defaultFilter,
    ...initialFilter,
  });

  // Update filter state and calculate isActive
  const setFilter = useCallback((newFilter: FilterState) => {
    const isActive =
      newFilter.searchText.length > 0 ||
      newFilter.severity.length > 0 ||
      newFilter.category.length > 0 ||
      newFilter.dateRange.start !== null ||
      newFilter.dateRange.end !== null;

    setFilterState({
      ...newFilter,
      isActive,
    });
  }, []);

  const updateFilter = useCallback(
    (update: Partial<FilterState>) => {
      setFilter({
        ...filter,
        ...update,
      });
    },
    [filter, setFilter]
  );

  const clearFilter = useCallback(() => {
    setFilter(defaultFilter);
  }, [setFilter]);

  const setSearchText = useCallback(
    (text: string) => {
      updateFilter({ searchText: text });
    },
    [updateFilter]
  );

  const setSeverityFilter = useCallback(
    (severities: ErrorSeverity[]) => {
      updateFilter({ severity: severities });
    },
    [updateFilter]
  );

  const setCategoryFilter = useCallback(
    (categories: ErrorCategory[]) => {
      updateFilter({ category: categories });
    },
    [updateFilter]
  );

  const setDateRange = useCallback(
    (start: Date | null, end: Date | null) => {
      updateFilter({ dateRange: { start, end } });
    },
    [updateFilter]
  );

  // Memoized filtering function
  const filterErrors = useCallback(
    (errors: ComponentError[]): ComponentError[] => {
      if (!filter.isActive) {
        return errors;
      }

      return errors.filter((error) => {
        // Text search filter
        if (filter.searchText) {
          const searchText = caseSensitive ? filter.searchText : filter.searchText.toLowerCase();
          const searchableText = caseSensitive
            ? `${error.message} ${error.code} ${error.metadata.operation || ''}`
            : `${error.message} ${error.code} ${error.metadata.operation || ''}`.toLowerCase();

          if (!searchableText.includes(searchText)) {
            return false;
          }
        }

        // Severity filter
        if (filter.severity.length > 0) {
          if (!filter.severity.includes(error.severity)) {
            return false;
          }
        }

        // Category filter
        if (filter.category.length > 0) {
          if (!filter.category.includes(error.category)) {
            return false;
          }
        }

        // Date range filter
        if (filter.dateRange.start || filter.dateRange.end) {
          const errorTime = error.timestamp.getTime();

          if (filter.dateRange.start && errorTime < filter.dateRange.start.getTime()) {
            return false;
          }

          if (filter.dateRange.end && errorTime > filter.dateRange.end.getTime()) {
            return false;
          }
        }

        return true;
      });
    },
    [filter, caseSensitive]
  );

  // Filter statistics
  const getFilterStats = useCallback(
    (errors: ComponentError[]) => {
      const total = errors.length;
      const filtered = filterErrors(errors).length;
      const hidden = total - filtered;
      const percentage = total > 0 ? Math.round((filtered / total) * 100) : 0;

      return {
        total,
        filtered,
        hidden,
        percentage,
      };
    },
    [filterErrors]
  );

  // Memoized available filter values from errors
  const getAvailableFilterValues = useMemo(() => {
    return (errors: ComponentError[]) => {
      const severities = new Set<ErrorSeverity>();
      const categories = new Set<ErrorCategory>();
      let minDate: Date | null = null;
      let maxDate: Date | null = null;

      errors.forEach((error) => {
        severities.add(error.severity);
        categories.add(error.category);

        if (!minDate || error.timestamp < minDate) {
          minDate = error.timestamp;
        }
        if (!maxDate || error.timestamp > maxDate) {
          maxDate = error.timestamp;
        }
      });

      return {
        severities: Array.from(severities).sort(),
        categories: Array.from(categories).sort(),
        dateRange: { min: minDate, max: maxDate },
      };
    };
  }, []);

  return {
    filter,
    setFilter,
    updateFilter,
    clearFilter,
    setSearchText,
    setSeverityFilter,
    setCategoryFilter,
    setDateRange,
    filterErrors,
    getFilterStats,
  };
};
