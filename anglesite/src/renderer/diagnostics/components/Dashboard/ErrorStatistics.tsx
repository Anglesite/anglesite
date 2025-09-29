/**
 * @file Error Statistics component
 * @description Displays detailed error breakdowns by severity and category
 */
import React from 'react';
import { FluentCard } from '../../../ui/react/fluent/FluentCard';
import LoadingSpinner from '../Layout/LoadingSpinner';
import type { ErrorStatistics as ErrorStatisticsType } from '../../../types/diagnostics.d';

export interface ErrorStatisticsProps {
  /** Statistics data to display */
  statistics: ErrorStatisticsType;
  /** Whether to show in compact mode */
  compact?: boolean;
  /** Whether the data is currently loading */
  loading?: boolean;
  /** Error message if data loading failed */
  error?: string | null;
}

const ErrorStatistics: React.FC<ErrorStatisticsProps> = ({
  statistics,
  compact = false,
  loading = false,
  error = null,
}) => {
  const containerStyle: React.CSSProperties = {
    ...(compact
      ? {}
      : {
          margin: '16px',
          padding: '20px',
        }),
  };

  const sectionStyle: React.CSSProperties = {
    marginBottom: compact ? '16px' : '24px',
  };

  const sectionTitleStyle: React.CSSProperties = {
    margin: '0 0 12px 0',
    fontSize: compact ? '13px' : '14px',
    fontWeight: 600,
    color: 'var(--colorNeutralForeground1)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  };

  const breakdownStyle: React.CSSProperties = {
    display: 'grid',
    gap: '6px',
  };

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
    fontSize: compact ? '12px' : '13px',
  };

  const labelStyle: React.CSSProperties = {
    color: 'var(--colorNeutralForeground2)',
    textTransform: 'capitalize',
  };

  const valueStyle: React.CSSProperties = {
    fontWeight: 500,
    color: 'var(--colorNeutralForeground1)',
  };

  const barContainerStyle: React.CSSProperties = {
    width: compact ? '60px' : '80px',
    height: '4px',
    backgroundColor: 'var(--colorNeutralBackground3)',
    borderRadius: '2px',
    overflow: 'hidden',
    marginLeft: '8px',
  };

  const getBarColor = (category: string, type: 'severity' | 'category'): string => {
    if (type === 'severity') {
      switch (category.toLowerCase()) {
        case 'critical':
          return 'var(--colorPaletteRedBackground3)';
        case 'error':
          return 'var(--colorPaletteRedBackground2)';
        case 'warning':
          return 'var(--colorPaletteYellowBackground2)';
        case 'info':
          return 'var(--colorPaletteBlueBackground2)';
        default:
          return 'var(--colorNeutralBackground3)';
      }
    } else {
      // Rotate through colors for categories
      const colors = [
        'var(--colorPaletteBluBackground2)',
        'var(--colorPaletteGreenBackground2)',
        'var(--colorPalettePurpleBackground2)',
        'var(--colorPaletteYellowBackground2)',
        'var(--colorPaletteTealBackground2)',
      ];
      const hash = category.split('').reduce((a, b) => {
        a = (a << 5) - a + b.charCodeAt(0);
        return a & a;
      }, 0);
      return colors[Math.abs(hash) % colors.length];
    }
  };

  const renderBreakdown = (data: Record<string, number>, type: 'severity' | 'category', title: string) => {
    const entries = Object.entries(data);
    const maxValue = Math.max(...entries.map(([, count]) => count));
    const total = entries.reduce((sum, [, count]) => sum + count, 0);

    if (entries.length === 0) {
      return (
        <div style={sectionStyle}>
          <h3 style={sectionTitleStyle}>{title}</h3>
          <div
            style={{
              padding: '12px',
              textAlign: 'center',
              color: 'var(--colorNeutralForeground2)',
              fontSize: '12px',
              fontStyle: 'italic',
            }}
          >
            No errors recorded
          </div>
        </div>
      );
    }

    return (
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>{title}</h3>
        <div style={breakdownStyle}>
          {entries
            .sort(([, a], [, b]) => b - a) // Sort by count descending
            .map(([category, count]) => {
              const percentage = total > 0 ? (count / total) * 100 : 0;
              const barWidth = maxValue > 0 ? (count / maxValue) * 100 : 0;

              return (
                <div key={category} style={itemStyle} data-testid={`${type}-${category}`}>
                  <span style={labelStyle}>{category}</span>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={valueStyle}>{count}</span>
                    <div style={barContainerStyle}>
                      <div
                        style={{
                          width: `${barWidth}%`,
                          height: '100%',
                          backgroundColor: getBarColor(category, type),
                          transition: 'width 0.3s ease',
                        }}
                        aria-hidden="true"
                      />
                    </div>
                    {!compact && (
                      <span
                        style={{
                          fontSize: '10px',
                          color: 'var(--colorNeutralForeground3)',
                          marginLeft: '6px',
                          minWidth: '30px',
                          textAlign: 'right',
                        }}
                      >
                        {percentage.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div style={containerStyle} data-testid="error-statistics-loading">
        <LoadingSpinner
          size={compact ? 'small' : 'medium'}
          message="Loading statistics..."
          testId="statistics-loading-spinner"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle} data-testid="error-statistics-error">
        <div
          style={{
            padding: '16px',
            textAlign: 'center',
            color: 'var(--colorPaletteRedForeground1)',
            fontSize: '13px',
          }}
        >
          Failed to load statistics: {error}
        </div>
      </div>
    );
  }

  const content = (
    <div data-testid="error-statistics">
      {renderBreakdown(statistics.bySeverity, 'severity', 'By Severity')}
      {renderBreakdown(statistics.byCategory, 'category', 'By Category')}
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

export default ErrorStatistics;
