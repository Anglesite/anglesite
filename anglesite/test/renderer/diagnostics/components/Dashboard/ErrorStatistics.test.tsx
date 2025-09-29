/**
 * @file Tests for ErrorStatistics component
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { jest } from '@jest/globals';
import ErrorStatistics from '../../../../../src/renderer/diagnostics/components/Dashboard/ErrorStatistics';
import type { ErrorStatistics as ErrorStatisticsType } from '../../../../../src/renderer/diagnostics/types/diagnostics';

// Mock LoadingSpinner
jest.mock('../../../../../src/renderer/diagnostics/components/Layout/LoadingSpinner', () => {
  return function MockLoadingSpinner({ size, message, testId }: any) {
    return (
      <div data-testid={testId} data-size={size}>
        {message}
      </div>
    );
  };
});

describe('ErrorStatistics', () => {
  const mockStatistics: ErrorStatisticsType = {
    total: 20,
    bySeverity: {
      critical: 3,
      error: 8,
      warning: 6,
      info: 3,
    },
    byCategory: {
      validation: 8,
      network: 7,
      rendering: 3,
      authentication: 2,
    },
    hourlyTrends: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should render statistics breakdown in non-compact mode', () => {
    render(<ErrorStatistics statistics={mockStatistics} compact={false} />);

    // Check section titles
    expect(screen.getByText('By Severity')).toBeInTheDocument();
    expect(screen.getByText('By Category')).toBeInTheDocument();

    // Check severity items (sorted by count descending)
    expect(screen.getByTestId('severity-error')).toBeInTheDocument();
    expect(screen.getByTestId('severity-warning')).toBeInTheDocument();
    expect(screen.getByTestId('severity-critical')).toBeInTheDocument();
    expect(screen.getByTestId('severity-info')).toBeInTheDocument();

    // Check category items
    expect(screen.getByTestId('category-validation')).toBeInTheDocument();
    expect(screen.getByTestId('category-network')).toBeInTheDocument();
    expect(screen.getByTestId('category-rendering')).toBeInTheDocument();
    expect(screen.getByTestId('category-authentication')).toBeInTheDocument();

    // Check values are displayed (use getAllByText since numbers appear multiple times)
    expect(screen.getAllByText('8')).toHaveLength(2); // error count and validation count
    expect(screen.getByText('6')).toBeInTheDocument(); // warning count
    expect(screen.getByText('7')).toBeInTheDocument(); // network count
  });

  test('should render statistics breakdown in compact mode', () => {
    render(<ErrorStatistics statistics={mockStatistics} compact={true} />);

    // Should still show the sections but without FluentCard wrapper
    expect(screen.getByText('By Severity')).toBeInTheDocument();
    expect(screen.getByText('By Category')).toBeInTheDocument();

    // Check that main container doesn't have margin/padding styles from FluentCard
    const container = screen.getByTestId('error-statistics').parentElement;
    expect(container).not.toHaveStyle({ margin: '16px' });
  });

  test('should show loading state', () => {
    render(<ErrorStatistics statistics={mockStatistics} loading={true} compact={false} />);

    expect(screen.getByTestId('statistics-loading-spinner')).toBeInTheDocument();
    expect(screen.getByText('Loading statistics...')).toBeInTheDocument();
    expect(screen.queryByTestId('error-statistics')).not.toBeInTheDocument();
  });

  test('should show loading state in compact mode', () => {
    render(<ErrorStatistics statistics={mockStatistics} loading={true} compact={true} />);

    const spinner = screen.getByTestId('statistics-loading-spinner');
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveAttribute('data-size', 'small');
  });

  test('should show error state', () => {
    const errorMessage = 'Failed to fetch statistics';
    render(<ErrorStatistics statistics={mockStatistics} loading={false} error={errorMessage} />);

    expect(screen.getByTestId('error-statistics-error')).toBeInTheDocument();
    expect(screen.getByText(`Failed to load statistics: ${errorMessage}`)).toBeInTheDocument();
    expect(screen.queryByTestId('error-statistics')).not.toBeInTheDocument();
  });

  test('should handle empty data gracefully', () => {
    const emptyStatistics: ErrorStatisticsType = {
      total: 0,
      bySeverity: {},
      byCategory: {},
      hourlyTrends: [],
    };

    render(<ErrorStatistics statistics={emptyStatistics} />);

    // Should show empty state messages
    expect(screen.getAllByText('No errors recorded')).toHaveLength(2);
    expect(screen.getByText('By Severity')).toBeInTheDocument();
    expect(screen.getByText('By Category')).toBeInTheDocument();
  });

  test('should sort items by count in descending order', () => {
    render(<ErrorStatistics statistics={mockStatistics} />);

    // Get all severity items and check order
    const severitySection = screen.getByTestId('severity-error').parentElement;
    const severityItems = severitySection?.querySelectorAll('[data-testid^="severity-"]');

    // Should be ordered: error(8), warning(6), critical(3), info(3)
    expect(severityItems?.[0]).toHaveAttribute('data-testid', 'severity-error');
    expect(severityItems?.[1]).toHaveAttribute('data-testid', 'severity-warning');

    // Get all category items and check order
    const categorySection = screen.getByTestId('category-validation').parentElement;
    const categoryItems = categorySection?.querySelectorAll('[data-testid^="category-"]');

    // Should be ordered: validation(8), network(7), rendering(3), authentication(2)
    expect(categoryItems?.[0]).toHaveAttribute('data-testid', 'category-validation');
    expect(categoryItems?.[1]).toHaveAttribute('data-testid', 'category-network');
  });

  test('should show percentages in non-compact mode', () => {
    render(<ErrorStatistics statistics={mockStatistics} compact={false} />);

    // Error has 8/20 = 40% (appears in severity section)
    // Validation has 8/20 = 40% (appears in category section)
    expect(screen.getAllByText('40.0%')).toHaveLength(2);

    // Warning has 6/20 = 30%
    expect(screen.getByText('30.0%')).toBeInTheDocument();

    // Network has 7/20 = 35%
    expect(screen.getByText('35.0%')).toBeInTheDocument();
  });

  test('should hide percentages in compact mode', () => {
    render(<ErrorStatistics statistics={mockStatistics} compact={true} />);

    // Should not show percentage values in compact mode
    expect(screen.queryByText('40.0%')).not.toBeInTheDocument();
    expect(screen.queryByText('30.0%')).not.toBeInTheDocument();
  });

  test('should apply correct colors for severity bars', () => {
    render(<ErrorStatistics statistics={mockStatistics} />);

    const criticalBar = screen.getByTestId('severity-critical').querySelector('[aria-hidden="true"]');
    expect(criticalBar).toHaveStyle({
      backgroundColor: 'var(--colorPaletteRedBackground3)',
    });

    const errorBar = screen.getByTestId('severity-error').querySelector('[aria-hidden="true"]');
    expect(errorBar).toHaveStyle({
      backgroundColor: 'var(--colorPaletteRedBackground2)',
    });

    const warningBar = screen.getByTestId('severity-warning').querySelector('[aria-hidden="true"]');
    expect(warningBar).toHaveStyle({
      backgroundColor: 'var(--colorPaletteYellowBackground2)',
    });

    const infoBar = screen.getByTestId('severity-info').querySelector('[aria-hidden="true"]');
    expect(infoBar).toHaveStyle({
      backgroundColor: 'var(--colorPaletteBlueBackground2)',
    });
  });

  test('should calculate bar widths correctly', () => {
    render(<ErrorStatistics statistics={mockStatistics} />);

    // Error has the highest count (8), so should have 100% width
    const errorBar = screen.getByTestId('severity-error').querySelector('[aria-hidden="true"]');
    expect(errorBar).toHaveStyle({ width: '100%' });

    // Warning has 6 out of max 8, so should have 75% width
    const warningBar = screen.getByTestId('severity-warning').querySelector('[aria-hidden="true"]');
    expect(warningBar).toHaveStyle({ width: '75%' });
  });

  test('should have accessible structure', () => {
    render(<ErrorStatistics statistics={mockStatistics} />);

    // Check for proper ARIA attributes on progress bars
    const container = screen.getByTestId('error-statistics');
    const barsWithAriaHidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(barsWithAriaHidden.length).toBeGreaterThan(0);

    // Check that the main container has the correct test ID
    expect(screen.getByTestId('error-statistics')).toBeInTheDocument();
  });

  test('should handle single item gracefully', () => {
    const singleItemStats: ErrorStatisticsType = {
      total: 5,
      bySeverity: {
        error: 5,
      },
      byCategory: {
        validation: 5,
      },
      hourlyTrends: [],
    };

    render(<ErrorStatistics statistics={singleItemStats} />);

    expect(screen.getByTestId('severity-error')).toBeInTheDocument();
    expect(screen.getByTestId('category-validation')).toBeInTheDocument();

    // Should show 100% for the single item
    expect(screen.getAllByText('100.0%')).toHaveLength(2); // One for severity, one for category
  });
});
