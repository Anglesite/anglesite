import React from 'react';
import { FluentButton, FluentDivider } from '../fluent';

export const Header: React.FC = () => {
  return (
    <header
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-secondary, #f5f5f5)',
        borderBottom: '1px solid var(--border-primary, #e1e1e1)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: '20px',
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          Anglesite (HMR Active!) 🔥
        </h1>
        <div
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
          }}
        >
          <FluentButton
            appearance="subtle"
            size="small"
            title="Open Settings"
            onClick={() => console.log('Settings clicked')}
          >
            ⚙️ Settings
          </FluentButton>
          <FluentDivider orientation="vertical" style={{ height: '20px' }} />
          <FluentButton appearance="subtle" size="small" title="View Help" onClick={() => console.log('Help clicked')}>
            ❓ Help
          </FluentButton>
        </div>
      </div>
    </header>
  );
};
