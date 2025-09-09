import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';
import { AppProvider } from './context/AppContext';

console.log('React app starting...');

// Fluent UI will be lazy loaded when first needed

const container = document.getElementById('react-root');
if (!container) {
  console.error('React root element not found!');
  throw new Error('React root element not found');
}

console.log('React root element found, creating app...');

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);

console.log('React app rendered!');
