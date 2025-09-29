/**
 * @file Error Trends component
 * @description Simple trend visualization showing error patterns over time
 */
import React from 'react';
import { FluentCard } from '../../../ui/react/fluent/FluentCard';
import LoadingSpinner from '../Layout/LoadingSpinner';
import type { HourlyTrend } from '../../types/diagnostics';

export interface ErrorTrendsProps {
  /** Hourly trend data */
  hourlyTrends: HourlyTrend[];
  /** Whether to show in compact mode */
  compact?: boolean;
  /** Whether the data is currently loading */
  loading?: boolean;
  /** Error message if data loading failed */
  error?: string | null;
}

const ErrorTrends: React.FC<ErrorTrendsProps> = ({ hourlyTrends, compact = false, loading = false, error = null }) => {
  const containerStyle: React.CSSProperties = {
    ...(compact
      ? {}
      : {
          margin: '16px',
          padding: '20px',
        }),
  };

  const sectionTitleStyle: React.CSSProperties = {
    margin: '0 0 16px 0',
    fontSize: compact ? '13px' : '14px',
    fontWeight: 600,
    color: 'var(--colorNeutralForeground1)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  };

  const chartContainerStyle: React.CSSProperties = {
    height: compact ? '60px' : '120px',
    display: 'flex',
    alignItems: 'end',
    gap: '2px',
    padding: '8px 0',
    borderBottom: '1px solid var(--colorNeutralStroke3)',
    marginBottom: '12px',
  };

  const summaryStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '16px',
    fontSize: '12px',
  };

  const summaryItemStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
  };

  const summaryLabelStyle: React.CSSProperties = {
    color: 'var(--colorNeutralForeground2)',
    fontSize: '11px',
    textAlign: 'center',
  };

  const summaryValueStyle: React.CSSProperties = {
    color: 'var(--colorNeutralForeground1)',
    fontSize: '14px',
    fontWeight: 600,
  };

  // Process trend data
  const maxErrors = hourlyTrends.length > 0 ? Math.max(...hourlyTrends.map((trend) => trend.errorCount)) : 0;

  const totalErrors = hourlyTrends.reduce((sum, trend) => sum + trend.errorCount, 0);
  const averageErrors = hourlyTrends.length > 0 ? Math.round((totalErrors / hourlyTrends.length) * 10) / 10 : 0;

  // Calculate trend direction (simple: compare first half to second half)
  const midPoint = Math.floor(hourlyTrends.length / 2);
  const firstHalfAvg = hourlyTrends.slice(0, midPoint).reduce((sum, trend) => sum + trend.errorCount, 0) / midPoint;
  const secondHalfAvg =
    hourlyTrends.slice(midPoint).reduce((sum, trend) => sum + trend.errorCount, 0) / (hourlyTrends.length - midPoint);

  const trendDirection =
    hourlyTrends.length < 2
      ? 'stable'
      : secondHalfAvg > firstHalfAvg * 1.1
        ? 'increasing'
        : secondHalfAvg < firstHalfAvg * 0.9
          ? 'decreasing'
          : 'stable';

  const getTrendIcon = (): string => {
    switch (trendDirection) {
      case 'increasing':
        return '📈';
      case 'decreasing':
        return '📉';
      default:
        return '➡️';
    }
  };

  const getTrendColor = (): string => {
    switch (trendDirection) {
      case 'increasing':
        return 'var(--colorPaletteRedForeground1)';
      case 'decreasing':
        return 'var(--colorPaletteGreenForeground1)';
      default:
        return 'var(--colorNeutralForeground2)';
    }
  };

  const renderSimpleChart = () => {
    if (hourlyTrends.length === 0) {
      return (
        <div
          style={{
            ...chartContainerStyle,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              color: 'var(--colorNeutralForeground2)',
              fontSize: '12px',
              fontStyle: 'italic',
            }}
          >
            No trend data available
          </div>
        </div>
      );
    }

    const barWidth = Math.max(2, Math.floor((100 - (hourlyTrends.length - 1) * 2) / hourlyTrends.length));

    return (
      <div style={chartContainerStyle} data-testid="trends-chart">
        {hourlyTrends.map((trend, index) => {
          const height = maxErrors > 0 ? (trend.errorCount / maxErrors) * 100 : 0;
          const isRecent = index >= hourlyTrends.length - 3; // Last 3 hours

          return (
            <div
              key={trend.hour}
              style={{
                width: `${barWidth}%`,
                height: `${Math.max(height, 2)}%`,
                backgroundColor: isRecent ? 'var(--colorBrandBackground)' : 'var(--colorNeutralBackground4)',
                borderRadius: '1px',
                position: 'relative',
              }}
              title={`${trend.hour}: ${trend.errorCount} errors`}
              data-testid={`trend-bar-${trend.hour}`}
            >
              {/* Show value on hover for larger bars */}
              {!compact && height > 20 && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    fontSize: '9px',
                    color: 'var(--colorNeutralForeground2)',
                    whiteSpace: 'nowrap',
                    marginBottom: '2px',
                  }}
                >
                  {trend.errorCount}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <div style={containerStyle} data-testid="error-trends-loading">
        <LoadingSpinner
          size={compact ? 'small' : 'medium'}
          message="Loading trends..."
          testId="trends-loading-spinner"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle} data-testid="error-trends-error">
        <div
          style={{
            padding: '16px',
            textAlign: 'center',
            color: 'var(--colorPaletteRedForeground1)',
            fontSize: '13px',
          }}
        >
          Failed to load trends: {error}
        </div>
      </div>
    );
  }

  const content = (
    <div data-testid="error-trends">
      <h3 style={sectionTitleStyle}>24 Hour Trend</h3>

      {renderSimpleChart()}

      {/* Summary metrics */}
      <div style={summaryStyle}>
        <div style={summaryItemStyle} data-testid="total-metric">
          <span style={summaryLabelStyle}>Total (24h)</span>
          <span style={summaryValueStyle}>{totalErrors}</span>
        </div>

        <div style={summaryItemStyle} data-testid="average-metric">
          <span style={summaryLabelStyle}>Avg/Hour</span>
          <span style={summaryValueStyle}>{averageErrors}</span>
        </div>

        <div style={summaryItemStyle} data-testid="peak-metric">
          <span style={summaryLabelStyle}>Peak Hour</span>
          <span style={summaryValueStyle}>{maxErrors}</span>
        </div>

        <div style={summaryItemStyle} data-testid="trend-metric">
          <span style={summaryLabelStyle}>Trend</span>
          <span
            style={{
              ...summaryValueStyle,
              color: getTrendColor(),
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span role="img" aria-label={trendDirection}>
              {getTrendIcon()}
            </span>
            <span style={{ textTransform: 'capitalize' }}>{trendDirection}</span>
          </span>
        </div>
      </div>

      {/* Time axis labels for non-compact mode */}
      {!compact && hourlyTrends.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '8px',
            fontSize: '10px',
            color: 'var(--colorNeutralForeground3)',
            paddingTop: '4px',
            borderTop: '1px solid var(--colorNeutralStroke3)',
          }}
        >
          <span>{hourlyTrends[0]?.hour || ''}</span>
          <span>Now</span>
        </div>
      )}
    </div>
  );

  if (compact) {
    return <div style={containerStyle}>{content}</div>;
  }

  return (
    <FluentCard appearance="outline" style={containerStyle}>
      {content}
    </FluentCard>
  );
};

export default ErrorTrends;
