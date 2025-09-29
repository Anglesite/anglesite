/**
 * @file Error Filters component
 * @description Provides filtering and search functionality for errors
 */
import React, { useState, useCallback } from 'react';
import { FluentCard } from '../../../ui/react/fluent/FluentCard';
import { FluentTextField } from '../../../ui/react/fluent/FluentTextField';
import { FluentButton } from '../../../ui/react/fluent/FluentButton';
import { FluentCheckbox } from '../../../ui/react/fluent/FluentCheckbox';
import { FluentDivider } from '../../../ui/react/fluent/FluentDivider';
import type { FilterState, ErrorSeverity, ErrorCategory } from '../../types/diagnostics';

export interface ErrorFiltersProps {
  /** Current filter state */
  filter: FilterState;
  /** Callback when filter changes */
  onFilterChange: (filter: Partial<FilterState>) => void;
  /** Callback to clear all filters */
  onFilterClear: () => void;
  /** Available error categories for filtering */
  availableCategories?: ErrorCategory[];
  /** Whether to show in compact mode */
  compact?: boolean;
  /** Additional CSS class name */
  className?: string;
}

const ErrorFilters: React.FC<ErrorFiltersProps> = ({
  filter,
  onFilterChange,
  onFilterClear,
  availableCategories = [
    'SYSTEM' as ErrorCategory,
    'NETWORK' as ErrorCategory,
    'FILE_SYSTEM' as ErrorCategory,
    'VALIDATION' as ErrorCategory,
    'BUSINESS_LOGIC' as ErrorCategory,
    'SECURITY' as ErrorCategory,
    'UI_COMPONENT' as ErrorCategory,
  ],
  compact = false,
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = useState(!compact);

  const handleSearchChange = useCallback(
    (value: string) => {
      onFilterChange({ searchText: value });
    },
    [onFilterChange]
  );

  const handleSeverityChange = useCallback(
    (severity: ErrorSeverity, checked: boolean) => {
      const newSeverities = checked ? [...filter.severity, severity] : filter.severity.filter((s) => s !== severity);

      onFilterChange({ severity: newSeverities });
    },
    [filter.severity, onFilterChange]
  );

  const handleCategoryChange = useCallback(
    (category: ErrorCategory, checked: boolean) => {
      const newCategories = checked ? [...filter.category, category] : filter.category.filter((c) => c !== category);

      onFilterChange({ category: newCategories });
    },
    [filter.category, onFilterChange]
  );

  const handleDateRangeChange = useCallback(
    (type: 'start' | 'end', date: string) => {
      const dateValue = date ? new Date(date) : null;
      const newDateRange = {
        ...filter.dateRange,
        [type]: dateValue,
      };

      onFilterChange({ dateRange: newDateRange });
    },
    [filter.dateRange, onFilterChange]
  );

  const handleClearFilters = useCallback(() => {
    onFilterClear();
  }, [onFilterClear]);

  const getActiveFilterCount = (): number => {
    let count = 0;
    if (filter.searchText) count++;
    if (filter.severity.length > 0) count++;
    if (filter.category.length > 0) count++;
    if (filter.dateRange.start || filter.dateRange.end) count++;
    return count;
  };

  const formatCategoryLabel = (category: ErrorCategory): string => {
    return category
      .toString()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  const formatSeverityLabel = (severity: ErrorSeverity): string => {
    return severity.toString().charAt(0).toUpperCase() + severity.toString().slice(1).toLowerCase();
  };

  const containerStyle: React.CSSProperties = {
    ...(compact
      ? {}
      : {
          margin: '16px',
          padding: 0,
        }),
    backgroundColor: 'var(--colorNeutralBackground1)',
    border: '1px solid var(--colorNeutralStroke2)',
    borderRadius: '6px',
    overflow: 'hidden',
  };

  const headerStyle: React.CSSProperties = {
    padding: '12px 16px',
    backgroundColor: 'var(--colorNeutralBackground2)',
    borderBottom: isExpanded ? '1px solid var(--colorNeutralStroke2)' : 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: compact ? 'pointer' : 'default',
  };

  const titleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: compact ? '13px' : '14px',
    fontWeight: 600,
    color: 'var(--colorNeutralForeground1)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };

  const contentStyle: React.CSSProperties = {
    padding: isExpanded ? '16px' : '0',
    maxHeight: isExpanded ? 'none' : '0',
    overflow: 'hidden',
    transition: 'all 0.3s ease',
  };

  const sectionStyle: React.CSSProperties = {
    marginBottom: '16px',
  };

  const sectionTitleStyle: React.CSSProperties = {
    margin: '0 0 8px 0',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--colorNeutralForeground2)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  };

  const checkboxGroupStyle: React.CSSProperties = {
    display: 'grid',
    gap: '6px',
    gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fit, minmax(140px, 1fr))',
  };

  const dateInputStyle: React.CSSProperties = {
    display: 'grid',
    gap: '8px',
    gridTemplateColumns: '1fr 1fr',
  };

  const activeFilterCount = getActiveFilterCount();

  return (
    <div className={className} style={containerStyle} data-testid="error-filters">
      {/* Header */}
      <div
        style={headerStyle}
        onClick={compact ? () => setIsExpanded(!isExpanded) : undefined}
        data-testid="filters-header"
      >
        <h3 style={titleStyle}>
          <span>Filters</span>
          {activeFilterCount > 0 && (
            <span
              style={{
                backgroundColor: 'var(--colorBrandBackground)',
                color: 'var(--colorNeutralForegroundInverted)',
                fontSize: '10px',
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: '10px',
                minWidth: '16px',
                textAlign: 'center',
              }}
            >
              {activeFilterCount}
            </span>
          )}
        </h3>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {activeFilterCount > 0 && (
            <FluentButton
              appearance="neutral"
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleClearFilters();
              }}
              title="Clear all filters"
              data-testid="clear-filters-button"
            >
              Clear
            </FluentButton>
          )}

          {compact && (
            <FluentButton
              appearance="neutral"
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              data-testid="toggle-filters-button"
            >
              {isExpanded ? '▲' : '▼'}
            </FluentButton>
          )}
        </div>
      </div>

      {/* Filter Content */}
      <div style={contentStyle}>
        {/* Search */}
        <div style={sectionStyle}>
          <h4 style={sectionTitleStyle}>Search</h4>
          <FluentTextField
            value={filter.searchText}
            placeholder="Search error messages, codes, or operations..."
            onChange={(e) => handleSearchChange((e.target as HTMLInputElement).value)}
            data-testid="search-input"
            style={{ width: '100%' }}
          />
        </div>

        <FluentDivider />

        {/* Severity Filters */}
        <div style={sectionStyle}>
          <h4 style={sectionTitleStyle}>Severity</h4>
          <div style={checkboxGroupStyle}>
            {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((severity) => (
              <FluentCheckbox
                key={severity}
                checked={filter.severity.includes(severity as ErrorSeverity)}
                onChange={(checked) => handleSeverityChange(severity as ErrorSeverity, checked)}
                data-testid={`severity-filter-${severity.toLowerCase()}`}
              >
                {formatSeverityLabel(severity as ErrorSeverity)}
              </FluentCheckbox>
            ))}
          </div>
        </div>

        <FluentDivider />

        {/* Category Filters */}
        <div style={sectionStyle}>
          <h4 style={sectionTitleStyle}>Category</h4>
          <div style={checkboxGroupStyle}>
            {availableCategories.map((category) => (
              <FluentCheckbox
                key={category}
                checked={filter.category.includes(category)}
                onChange={(checked) => handleCategoryChange(category, checked)}
                data-testid={`category-filter-${category.toLowerCase().replace('_', '-')}`}
              >
                {formatCategoryLabel(category)}
              </FluentCheckbox>
            ))}
          </div>
        </div>

        <FluentDivider />

        {/* Date Range */}
        <div style={sectionStyle}>
          <h4 style={sectionTitleStyle}>Date Range</h4>
          <div style={dateInputStyle}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '11px',
                  color: 'var(--colorNeutralForeground2)',
                  marginBottom: '4px',
                }}
              >
                From
              </label>
              <input
                type="datetime-local"
                value={filter.dateRange.start?.toISOString().slice(0, 16) || ''}
                onChange={(e) => handleDateRangeChange('start', e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid var(--colorNeutralStroke2)',
                  borderRadius: '3px',
                  backgroundColor: 'var(--colorNeutralBackground1)',
                  color: 'var(--colorNeutralForeground1)',
                  fontSize: '12px',
                }}
                data-testid="date-range-start"
              />
            </div>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '11px',
                  color: 'var(--colorNeutralForeground2)',
                  marginBottom: '4px',
                }}
              >
                To
              </label>
              <input
                type="datetime-local"
                value={filter.dateRange.end?.toISOString().slice(0, 16) || ''}
                onChange={(e) => handleDateRangeChange('end', e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid var(--colorNeutralStroke2)',
                  borderRadius: '3px',
                  backgroundColor: 'var(--colorNeutralBackground1)',
                  color: 'var(--colorNeutralForeground1)',
                  fontSize: '12px',
                }}
                data-testid="date-range-end"
              />
            </div>
          </div>
        </div>

        {/* Filter Summary */}
        {activeFilterCount > 0 && (
          <>
            <FluentDivider />
            <div
              style={{
                padding: '12px',
                backgroundColor: 'var(--colorNeutralBackground2)',
                borderRadius: '4px',
                fontSize: '12px',
                color: 'var(--colorNeutralForeground2)',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>Active Filters ({activeFilterCount})</div>
              {filter.searchText && <div>• Search: "{filter.searchText}"</div>}
              {filter.severity.length > 0 && (
                <div>• Severity: {filter.severity.map(formatSeverityLabel).join(', ')}</div>
              )}
              {filter.category.length > 0 && (
                <div>• Category: {filter.category.map(formatCategoryLabel).join(', ')}</div>
              )}
              {(filter.dateRange.start || filter.dateRange.end) && (
                <div>
                  • Date Range: {filter.dateRange.start?.toLocaleDateString() || 'Any'} -{' '}
                  {filter.dateRange.end?.toLocaleDateString() || 'Any'}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ErrorFilters;
