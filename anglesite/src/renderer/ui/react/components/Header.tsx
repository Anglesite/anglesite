import React from 'react';

export const Header: React.FC = () => {
  return (
    <header className="header">
      <div className="header-content">
        <h1>Anglesite (HMR Active!) 🔥</h1>
        <div className="header-actions">{/* Future: File menu, settings, etc. */}</div>
      </div>
    </header>
  );
};
