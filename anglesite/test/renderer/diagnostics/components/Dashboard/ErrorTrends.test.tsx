/**
 * @file Tests for ErrorTrends component
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { jest } from '@jest/globals';
import ErrorTrends from '../../../../../src/renderer/diagnostics/components/Dashboard/ErrorTrends';
import type { HourlyTrend } from '../../../../../src/renderer/diagnostics/types/diagnostics';

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

describe('ErrorTrends', () => {
  const mockTrends: HourlyTrend[] = [
    { hour: '00:00', errorCount: 2 },
    { hour: '01:00', errorCount: 5 },
    { hour: '02:00', errorCount: 3 },
    { hour: '03:00', errorCount: 8 },
    { hour: '04:00', errorCount: 1 },
    { hour: '05:00', errorCount: 4 },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should render trends chart in non-compact mode', () => {
    render(<ErrorTrends hourlyTrends={mockTrends} compact={false} />);

    // Check section title
    expect(screen.getByText('24 Hour Trend')).toBeInTheDocument();

    // Check chart container
    expect(screen.getByTestId('trends-chart')).toBeInTheDocument();

    // Check all trend bars are rendered
    mockTrends.forEach((trend) => {
      expect(screen.getByTestId(`trend-bar-${trend.hour}`)).toBeInTheDocument();
    });

    // Check summary metrics
    expect(screen.getByTestId('total-metric')).toBeInTheDocument();
    expect(screen.getByTestId('average-metric')).toBeInTheDocument();
    expect(screen.getByTestId('peak-metric')).toBeInTheDocument();
    expect(screen.getByTestId('trend-metric')).toBeInTheDocument();
  });

  test('should render trends chart in compact mode', () => {
    render(<ErrorTrends hourlyTrends={mockTrends} compact={true} />);

    // Should show same content but with different styling
    expect(screen.getByText('24 Hour Trend')).toBeInTheDocument();
    expect(screen.getByTestId('trends-chart')).toBeInTheDocument();

    // Should not show time axis labels in compact mode
    expect(screen.queryByText('00:00')).not.toBeInTheDocument();
    expect(screen.queryByText('Now')).not.toBeInTheDocument();
  });

  test('should show loading state', () => {
    render(<ErrorTrends hourlyTrends={[]} loading={true} compact={false} />);

    expect(screen.getByTestId('trends-loading-spinner')).toBeInTheDocument();
    expect(screen.getByText('Loading trends...')).toBeInTheDocument();
    expect(screen.queryByTestId('error-trends')).not.toBeInTheDocument();
  });

  test('should show loading state in compact mode', () => {
    render(<ErrorTrends hourlyTrends={[]} loading={true} compact={true} />);

    const spinner = screen.getByTestId('trends-loading-spinner');
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveAttribute('data-size', 'small');
  });

  test('should show error state', () => {
    const errorMessage = 'Failed to fetch trends';
    render(<ErrorTrends hourlyTrends={[]} loading={false} error={errorMessage} />);

    expect(screen.getByTestId('error-trends-error')).toBeInTheDocument();
    expect(screen.getByText(`Failed to load trends: ${errorMessage}`)).toBeInTheDocument();
    expect(screen.queryByTestId('error-trends')).not.toBeInTheDocument();
  });

  test('should handle empty trends gracefully', () => {
    render(<ErrorTrends hourlyTrends={[]} />);

    expect(screen.getByText('24 Hour Trend')).toBeInTheDocument();
    expect(screen.getByText('No trend data available')).toBeInTheDocument();

    // Should show zero metrics
    expect(screen.getByTestId('total-metric').textContent).toContain('0');
    expect(screen.getByTestId('average-metric').textContent).toContain('0');
    expect(screen.getByTestId('peak-metric').textContent).toContain('0');
  });

  test('should calculate summary metrics correctly', () => {
    render(<ErrorTrends hourlyTrends={mockTrends} />);

    // Total: 2 + 5 + 3 + 8 + 1 + 4 = 23
    expect(screen.getByTestId('total-metric')).toHaveTextContent('23');

    // Average: 23 / 6 = 3.8 (rounded to 3.8)
    expect(screen.getByTestId('average-metric')).toHaveTextContent('3.8');

    // Peak: max of [2, 5, 3, 8, 1, 4] = 8
    expect(screen.getByTestId('peak-metric')).toHaveTextContent('8');
  });

  test('should detect increasing trend correctly', () => {
    const increasingTrends: HourlyTrend[] = [
      { hour: '00:00', errorCount: 1 },
      { hour: '01:00', errorCount: 2 },
      { hour: '02:00', errorCount: 5 },
      { hour: '03:00', errorCount: 8 },
    ];

    render(<ErrorTrends hourlyTrends={increasingTrends} />);

    // Check that trend metric contains the word 'increasing' and has the correct emoji
    const trendMetric = screen.getByTestId('trend-metric');
    expect(trendMetric).toHaveTextContent(/increasing/i);
    expect(screen.getByLabelText('increasing')).toBeInTheDocument();
  });

  test('should detect decreasing trend correctly', () => {
    const decreasingTrends: HourlyTrend[] = [
      { hour: '00:00', errorCount: 8 },
      { hour: '01:00', errorCount: 5 },
      { hour: '02:00', errorCount: 2 },
      { hour: '03:00', errorCount: 1 },
    ];

    render(<ErrorTrends hourlyTrends={decreasingTrends} />);

    // Check that trend metric contains the word 'decreasing' and has the correct emoji
    const trendMetric = screen.getByTestId('trend-metric');
    expect(trendMetric).toHaveTextContent(/decreasing/i);
    expect(screen.getByLabelText('decreasing')).toBeInTheDocument();
  });

  test('should detect stable trend correctly', () => {
    const stableTrends: HourlyTrend[] = [
      { hour: '00:00', errorCount: 3 },
      { hour: '01:00', errorCount: 4 },
      { hour: '02:00', errorCount: 3 },
      { hour: '03:00', errorCount: 4 },
    ];

    render(<ErrorTrends hourlyTrends={stableTrends} />);

    // Check that trend metric contains the word 'stable' and has the correct emoji
    const trendMetric = screen.getByTestId('trend-metric');
    expect(trendMetric).toHaveTextContent(/stable/i);
    expect(screen.getByLabelText('stable')).toBeInTheDocument();
  });

  test('should handle single data point as stable', () => {
    const singleTrend: HourlyTrend[] = [{ hour: '00:00', errorCount: 5 }];

    render(<ErrorTrends hourlyTrends={singleTrend} />);

    // Check that trend metric contains the word 'stable'
    const trendMetric = screen.getByTestId('trend-metric');
    expect(trendMetric).toHaveTextContent(/stable/i);
  });

  test('should render bar heights proportional to error counts', () => {
    render(<ErrorTrends hourlyTrends={mockTrends} />);

    // Get bars and check their heights
    const bar1 = screen.getByTestId('trend-bar-01:00'); // 5 errors
    const bar2 = screen.getByTestId('trend-bar-03:00'); // 8 errors (max)
    const bar3 = screen.getByTestId('trend-bar-04:00'); // 1 error

    // Max error count is 8, so:
    // Bar for 8 errors should have 100% height
    expect(bar2).toHaveStyle({ height: '100%' });

    // Bar for 5 errors should have 62.5% height
    expect(bar1).toHaveStyle({ height: '62.5%' });

    // Bar for 1 error should have 12.5% height, but minimum is 2%
    expect(bar3).toHaveStyle({ height: '12.5%' });
  });

  test('should highlight recent bars with different colors', () => {
    render(<ErrorTrends hourlyTrends={mockTrends} />);

    // Last 3 bars should be highlighted (recent)
    const bar4 = screen.getByTestId('trend-bar-03:00'); // Recent
    const bar5 = screen.getByTestId('trend-bar-04:00'); // Recent
    const bar6 = screen.getByTestId('trend-bar-05:00'); // Recent

    expect(bar4).toHaveStyle({ backgroundColor: 'var(--colorBrandBackground)' });
    expect(bar5).toHaveStyle({ backgroundColor: 'var(--colorBrandBackground)' });
    expect(bar6).toHaveStyle({ backgroundColor: 'var(--colorBrandBackground)' });

    // Earlier bars should use neutral color
    const bar1 = screen.getByTestId('trend-bar-00:00'); // Not recent
    expect(bar1).toHaveStyle({ backgroundColor: 'var(--colorNeutralBackground4)' });
  });

  test('should show time axis labels in non-compact mode', () => {
    render(<ErrorTrends hourlyTrends={mockTrends} compact={false} />);

    expect(screen.getByText('00:00')).toBeInTheDocument();
    expect(screen.getByText('Now')).toBeInTheDocument();
  });

  test('should not show time axis labels in compact mode', () => {
    render(<ErrorTrends hourlyTrends={mockTrends} compact={true} />);

    expect(screen.queryByText('00:00')).not.toBeInTheDocument();
    expect(screen.queryByText('Now')).not.toBeInTheDocument();
  });

  test('should have accessible structure', () => {
    render(<ErrorTrends hourlyTrends={mockTrends} />);

    expect(screen.getByTestId('error-trends')).toBeInTheDocument();

    // Check that trend direction has proper ARIA labels
    const trendElement = screen.getByTestId('trend-metric').querySelector('[role="img"]');
    expect(trendElement).toHaveAttribute('aria-label', expect.any(String));

    // Check that bars have proper titles for tooltips
    mockTrends.forEach((trend) => {
      const bar = screen.getByTestId(`trend-bar-${trend.hour}`);
      expect(bar).toHaveAttribute('title', `${trend.hour}: ${trend.errorCount} errors`);
    });
  });

  test('should calculate bar width correctly based on data count', () => {
    const manyTrends: HourlyTrend[] = Array.from({ length: 24 }, (_, i) => ({
      hour: `${i.toString().padStart(2, '0')}:00`,
      errorCount: i + 1,
    }));

    render(<ErrorTrends hourlyTrends={manyTrends} />);

    // With 24 data points, bar width should be smaller
    const firstBar = screen.getByTestId('trend-bar-00:00');

    // Bar width = max(2, floor((100 - (24-1)*2) / 24)) = max(2, floor(54/24)) = max(2, 2) = 2
    expect(firstBar).toHaveStyle({ width: '2%' });
  });
});
