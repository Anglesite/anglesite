/**
 * @file Tests for ErrorDashboard component
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { jest } from '@jest/globals';
import ErrorDashboard from '../../../../../src/renderer/diagnostics/components/Dashboard/ErrorDashboard';
import type { ErrorStatistics } from '../../../../../src/renderer/diagnostics/types/diagnostics';

// Mock child components to focus on ErrorDashboard logic
jest.mock('../../../../../src/renderer/diagnostics/components/Dashboard/ErrorStatistics', () => {
  return function MockErrorStatistics({ statistics, loading, error, compact }: any) {
    if (loading) return <div data-testid="mock-statistics-loading">Loading Statistics...</div>;
    if (error) return <div data-testid="mock-statistics-error">Statistics Error: {error}</div>;
    return (
      <div data-testid="mock-statistics" data-compact={compact}>
        Mock Statistics: {statistics.total} total
      </div>
    );
  };
});

jest.mock('../../../../../src/renderer/diagnostics/components/Dashboard/ErrorTrends', () => {
  return function MockErrorTrends({ hourlyTrends, loading, error, compact }: any) {
    if (loading) return <div data-testid="mock-trends-loading">Loading Trends...</div>;
    if (error) return <div data-testid="mock-trends-error">Trends Error: {error}</div>;
    return (
      <div data-testid="mock-trends" data-compact={compact}>
        Mock Trends: {hourlyTrends.length} data points
      </div>
    );
  };
});

describe('ErrorDashboard', () => {
  const mockStatistics: ErrorStatistics = {
    total: 15,
    bySeverity: {
      error: 8,
      warning: 5,
      info: 2,
    },
    byCategory: {
      validation: 7,
      network: 5,
      rendering: 3,
    },
    hourlyTrends: [
      { hour: '00:00', errorCount: 2 },
      { hour: '01:00', errorCount: 3 },
      { hour: '02:00', errorCount: 1 },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should render dashboard with statistics', () => {
    render(<ErrorDashboard statistics={mockStatistics} />);

    // Check header
    expect(screen.getByText('Error Overview')).toBeInTheDocument();
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();

    // Check key metrics
    expect(screen.getByTestId('total-errors-metric')).toBeInTheDocument();
    expect(screen.getByText('Total Errors')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();

    // Check severity metric
    expect(screen.getByTestId('severity-breakdown-metric')).toBeInTheDocument();
    expect(screen.getByText('Most Common Severity')).toBeInTheDocument();
    expect(screen.getByText('8 error')).toBeInTheDocument(); // Highest severity count

    // Check category metric
    expect(screen.getByTestId('category-breakdown-metric')).toBeInTheDocument();
    expect(screen.getByText('Most Common Category')).toBeInTheDocument();
    expect(screen.getByText('7 validation')).toBeInTheDocument(); // Highest category count
  });

  test('should render child components with correct props', () => {
    render(<ErrorDashboard statistics={mockStatistics} loading={false} error={null} />);

    // Check ErrorStatistics component
    const statisticsComponent = screen.getByTestId('mock-statistics');
    expect(statisticsComponent).toBeInTheDocument();
    expect(statisticsComponent).toHaveAttribute('data-compact', 'true');
    expect(screen.getByText('Mock Statistics: 15 total')).toBeInTheDocument();

    // Check ErrorTrends component
    const trendsComponent = screen.getByTestId('mock-trends');
    expect(trendsComponent).toBeInTheDocument();
    expect(trendsComponent).toHaveAttribute('data-compact', 'true');
    expect(screen.getByText('Mock Trends: 3 data points')).toBeInTheDocument();
  });

  test('should show loading state for child components', () => {
    render(<ErrorDashboard statistics={mockStatistics} loading={true} error={null} />);

    expect(screen.getByTestId('mock-statistics-loading')).toBeInTheDocument();
    expect(screen.getByTestId('mock-trends-loading')).toBeInTheDocument();
  });

  test('should show error state for child components', () => {
    const errorMessage = 'Failed to load data';
    render(<ErrorDashboard statistics={mockStatistics} loading={false} error={errorMessage} />);

    expect(screen.getByTestId('mock-statistics-error')).toBeInTheDocument();
    expect(screen.getByText(`Statistics Error: ${errorMessage}`)).toBeInTheDocument();

    expect(screen.getByTestId('mock-trends-error')).toBeInTheDocument();
    expect(screen.getByText(`Trends Error: ${errorMessage}`)).toBeInTheDocument();
  });

  test('should handle empty severity data', () => {
    const emptyStats: ErrorStatistics = {
      total: 0,
      bySeverity: {},
      byCategory: {},
      hourlyTrends: [],
    };

    render(<ErrorDashboard statistics={emptyStats} />);

    expect(screen.getByText('None')).toBeInTheDocument(); // For both severity and category
  });

  test('should apply correct status colors based on total errors', () => {
    // Test zero errors (green)
    const zeroStats: ErrorStatistics = {
      total: 0,
      bySeverity: {},
      byCategory: {},
      hourlyTrends: [],
    };

    const { rerender } = render(<ErrorDashboard statistics={zeroStats} />);
    let totalErrorsValue = screen.getByTestId('total-errors-metric').querySelector('span:last-child');
    expect(totalErrorsValue).toHaveStyle({ color: 'var(--colorPaletteGreenForeground1)' });

    // Test few errors (yellow)
    const fewStats: ErrorStatistics = {
      total: 3,
      bySeverity: {},
      byCategory: {},
      hourlyTrends: [],
    };

    rerender(<ErrorDashboard statistics={fewStats} />);
    totalErrorsValue = screen.getByTestId('total-errors-metric').querySelector('span:last-child');
    expect(totalErrorsValue).toHaveStyle({ color: 'var(--colorPaletteYellowForeground1)' });

    // Test many errors (red)
    const manyStats: ErrorStatistics = {
      total: 10,
      bySeverity: {},
      byCategory: {},
      hourlyTrends: [],
    };

    rerender(<ErrorDashboard statistics={manyStats} />);
    totalErrorsValue = screen.getByTestId('total-errors-metric').querySelector('span:last-child');
    expect(totalErrorsValue).toHaveStyle({ color: 'var(--colorPaletteRedForeground1)' });
  });

  test('should have accessible structure', () => {
    render(<ErrorDashboard statistics={mockStatistics} />);

    const dashboard = screen.getByTestId('error-dashboard');
    expect(dashboard).toBeInTheDocument();

    // Check for semantic structure
    expect(screen.getByRole('heading', { level: 2, name: 'Error Overview' })).toBeInTheDocument();

    // Check for proper test IDs for metrics
    expect(screen.getByTestId('total-errors-metric')).toBeInTheDocument();
    expect(screen.getByTestId('severity-breakdown-metric')).toBeInTheDocument();
    expect(screen.getByTestId('category-breakdown-metric')).toBeInTheDocument();
  });

  test('should handle single category/severity correctly', () => {
    const singleStats: ErrorStatistics = {
      total: 5,
      bySeverity: {
        error: 5,
      },
      byCategory: {
        validation: 5,
      },
      hourlyTrends: [],
    };

    render(<ErrorDashboard statistics={singleStats} />);

    expect(screen.getByText('5 error')).toBeInTheDocument();
    expect(screen.getByText('5 validation')).toBeInTheDocument();
  });
});
