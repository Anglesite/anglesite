/**
 * @file Error Dashboard component
 * @description Main dashboard displaying error statistics and overview metrics
 */
import React from 'react';
import { FluentCard } from '../../../ui/react/fluent/FluentCard';
import { FluentDivider } from '../../../ui/react/fluent/FluentDivider';
import ErrorStatistics from './ErrorStatistics';
import ErrorTrends from './ErrorTrends';
import type { ErrorStatistics as ErrorStatisticsType } from '../../../types/diagnostics.d';

export interface ErrorDashboardProps {
  /** Statistics data to display */
  statistics: ErrorStatisticsType;
  /** Whether the data is currently loading */
  loading?: boolean;
  /** Error message if data loading failed */
  error?: string | null;
  /** Callback when refresh is requested */
  onRefresh?: () => void;
}

const ErrorDashboard: React.FC<ErrorDashboardProps> = ({ statistics, loading = false, error = null, onRefresh }) => {
  const cardStyle: React.CSSProperties = {
    margin: '16px',
    padding: 0,
    overflow: 'hidden',
  };

  const headerStyle: React.CSSProperties = {
    padding: '16px 20px 12px',
    backgroundColor: 'var(--colorNeutralBackground2)',
    borderBottom: '1px solid var(--colorNeutralStroke2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  };

  const titleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: '16px',
    fontWeight: 600,
    color: 'var(--colorNeutralForeground1)',
  };

  const contentStyle: React.CSSProperties = {
    padding: '0',
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '0',
  };

  const metricStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    borderBottom: '1px solid var(--colorNeutralStroke3)',
  };

  const lastMetricStyle: React.CSSProperties = {
    ...metricStyle,
    borderBottom: 'none',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '13px',
    color: 'var(--colorNeutralForeground2)',
  };

  const valueStyle: React.CSSProperties = {
    fontSize: '18px',
    fontWeight: 600,
    color: 'var(--colorNeutralForeground1)',
  };

  const getStatusColor = (total: number): string => {
    if (total === 0) return 'var(--colorPaletteGreenForeground1)';
    if (total < 5) return 'var(--colorPaletteYellowForeground1)';
    return 'var(--colorPaletteRedForeground1)';
  };

  const getSeverityDisplay = () => {
    const severities = Object.entries(statistics.bySeverity);
    if (severities.length === 0) return 'None';

    const highest = severities.reduce((prev, current) => (prev[1] > current[1] ? prev : current));

    return `${highest[1]} ${highest[0]}`;
  };

  const getCategoryDisplay = () => {
    const categories = Object.entries(statistics.byCategory);
    if (categories.length === 0) return 'None';

    const highest = categories.reduce((prev, current) => (prev[1] > current[1] ? prev : current));

    return `${highest[1]} ${highest[0]}`;
  };

  return (
    <FluentCard appearance="outline" style={cardStyle} data-testid="error-dashboard">
      {/* Header */}
      <div style={headerStyle}>
        <h2 style={titleStyle}>Error Overview</h2>
        <div
          style={{
            fontSize: '12px',
            color: 'var(--colorNeutralForeground2)',
          }}
        >
          Last updated: {new Date().toLocaleTimeString()}
        </div>
      </div>

      {/* Content */}
      <div style={contentStyle}>
        {/* Key Metrics */}
        <div style={metricStyle} data-testid="total-errors-metric">
          <span style={labelStyle}>Total Errors</span>
          <span
            style={{
              ...valueStyle,
              color: getStatusColor(statistics.total),
            }}
          >
            {statistics.total}
          </span>
        </div>

        <div style={metricStyle} data-testid="severity-breakdown-metric">
          <span style={labelStyle}>Most Common Severity</span>
          <span style={valueStyle}>{getSeverityDisplay()}</span>
        </div>

        <div style={lastMetricStyle} data-testid="category-breakdown-metric">
          <span style={labelStyle}>Most Common Category</span>
          <span style={valueStyle}>{getCategoryDisplay()}</span>
        </div>

        <FluentDivider />

        {/* Detailed Statistics */}
        <div style={{ padding: '16px 20px 0' }}>
          <ErrorStatistics statistics={statistics} loading={loading} error={error} compact={true} />
        </div>

        <FluentDivider />

        {/* Trends */}
        <div style={{ padding: '16px 20px 20px' }}>
          <ErrorTrends
            hourlyTrends={statistics.hourlyTrends.map((trend) => ({
              hour: trend.timestamp.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              }),
              errorCount: trend.count,
            }))}
            loading={loading}
            error={error}
            compact={true}
          />
        </div>
      </div>
    </FluentCard>
  );
};

export default ErrorDashboard;
