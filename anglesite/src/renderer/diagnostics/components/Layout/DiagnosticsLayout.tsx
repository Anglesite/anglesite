/**
 * @file Main Layout component for Diagnostics UI
 * @description Provides the overall structure and navigation for the diagnostics interface
 */
import React from 'react';
import { FluentCard } from '../../../ui/react/fluent/FluentCard';
import { FluentButton } from '../../../ui/react/fluent/FluentButton';
import { FluentDivider } from '../../../ui/react/fluent/FluentDivider';
import LoadingSpinner from './LoadingSpinner';
import type { LayoutProps } from '../../types/diagnostics';

const DiagnosticsLayout: React.FC<LayoutProps> = ({
  children,
  title = 'Website Diagnostics',
  loading = false,
  error = null,
  onRetry,
}) => {
  const handleRetry = () => {
    if (onRetry) {
      onRetry();
    }
  };

  const handleClose = () => {
    if (window.electronAPI?.diagnostics?.closeWindow) {
      window.electronAPI.diagnostics.closeWindow();
    }
  };

  return (
    <div
      className="diagnostics-layout"
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--colorNeutralBackground1)',
        fontFamily: 'var(--fontFamilyBase)',
      }}
      data-testid="diagnostics-layout"
    >
      {/* Header */}
      <header
        style={{
          padding: '16px 24px',
          backgroundColor: 'var(--colorNeutralBackground2)',
          borderBottom: '1px solid var(--colorNeutralStroke2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: '60px',
        }}
        data-testid="diagnostics-header"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h1
            style={{
              margin: 0,
              fontSize: '20px',
              fontWeight: 600,
              color: 'var(--colorNeutralForeground1)',
            }}
          >
            {title}
          </h1>

          {/* Connection status indicator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              color: 'var(--colorNeutralForeground2)',
            }}
            data-testid="connection-status"
          >
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: error ? 'var(--colorPaletteRedBackground3)' : 'var(--colorPaletteGreenBackground3)',
              }}
              aria-hidden="true"
            />
            <span>{error ? 'Disconnected' : 'Connected'}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {error && onRetry && (
            <FluentButton appearance="neutral" size="small" onClick={handleRetry} data-testid="header-retry-button">
              Retry
            </FluentButton>
          )}

          <FluentButton
            appearance="neutral"
            size="small"
            onClick={handleClose}
            data-testid="close-button"
            title="Close diagnostics window"
          >
            ✕
          </FluentButton>
        </div>
      </header>

      {/* Main Content Area */}
      <main
        style={{
          flex: 1,
          overflow: 'auto',
          position: 'relative',
        }}
        data-testid="diagnostics-main"
      >
        {loading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              minHeight: '300px',
            }}
          >
            <LoadingSpinner size="large" message="Loading diagnostics..." testId="main-loading-spinner" />
          </div>
        ) : error ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              padding: '24px',
            }}
          >
            <FluentCard
              appearance="outline"
              style={{
                padding: '24px',
                textAlign: 'center',
                maxWidth: '500px',
              }}
            >
              <div style={{ marginBottom: '16px' }}>
                <div
                  style={{
                    fontSize: '48px',
                    marginBottom: '16px',
                  }}
                  role="img"
                  aria-label="Error"
                >
                  ⚠️
                </div>
                <h2
                  style={{
                    margin: '0 0 8px 0',
                    fontSize: '18px',
                    color: 'var(--colorPaletteRedForeground1)',
                  }}
                >
                  Unable to Load Diagnostics
                </h2>
                <p
                  style={{
                    margin: '0 0 16px 0',
                    color: 'var(--colorNeutralForeground2)',
                    fontSize: '14px',
                  }}
                >
                  {error}
                </p>
              </div>

              {onRetry && (
                <div>
                  <FluentDivider style={{ margin: '16px 0' }} />
                  <FluentButton appearance="accent" onClick={handleRetry} data-testid="main-retry-button">
                    Try Again
                  </FluentButton>
                </div>
              )}
            </FluentCard>
          </div>
        ) : (
          children
        )}
      </main>

      {/* Footer */}
      <footer
        style={{
          padding: '12px 24px',
          backgroundColor: 'var(--colorNeutralBackground2)',
          borderTop: '1px solid var(--colorNeutralStroke2)',
          fontSize: '12px',
          color: 'var(--colorNeutralForeground2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
        data-testid="diagnostics-footer"
      >
        <span>Anglesite Diagnostics</span>
        <span>Last updated: {new Date().toLocaleTimeString()}</span>
      </footer>
    </div>
  );
};

export default DiagnosticsLayout;
