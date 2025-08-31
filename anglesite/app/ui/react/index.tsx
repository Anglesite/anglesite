import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';
import { AppProvider } from './context/AppContext';

// Fluent UI will be lazy loaded when first needed

const container = document.getElementById('react-root');
if (!container) {
  throw new Error('React root element not found');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);
