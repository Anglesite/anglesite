/**
 * @file Diagnostics React application entry point
 * @description Initializes and mounts the React diagnostics interface
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import DiagnosticsApp from './DiagnosticsApp';

// Global error handler for unhandled React errors
const handleGlobalError = (event: ErrorEvent) => {
  console.error('Unhandled error in diagnostics:', event.error);

  // Report to main process if available
  if (window.electronAPI?.send) {
    window.electronAPI.send('renderer-error', {
      component: 'DiagnosticsGlobal',
      error: {
        message: event.error?.message || 'Unknown global error',
        stack: event.error?.stack || 'No stack trace available',
        name: event.error?.name || 'Error',
      },
      errorInfo: {
        componentStack: 'Global error handler',
      },
    });
  }
};

// Global unhandled promise rejection handler
const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
  console.error('Unhandled promise rejection in diagnostics:', event.reason);

  // Report to main process if available
  if (window.electronAPI?.send) {
    window.electronAPI.send('renderer-error', {
      component: 'DiagnosticsPromise',
      error: {
        message: event.reason?.message || 'Unhandled promise rejection',
        stack: event.reason?.stack || 'No stack trace available',
        name: event.reason?.name || 'PromiseRejection',
      },
      errorInfo: {
        componentStack: 'Promise rejection handler',
      },
    });
  }

  // Prevent default browser behavior
  event.preventDefault();
};

// Install global error handlers
window.addEventListener('error', handleGlobalError);
window.addEventListener('unhandledrejection', handleUnhandledRejection);

// Wait for DOM to be ready
const initializeApp = () => {
  const rootElement = document.getElementById('diagnostics-root');

  if (!rootElement) {
    console.error('Could not find diagnostics-root element');
    return;
  }

  // Hide the loading indicator
  const loadingIndicator = document.getElementById('loading-indicator');
  if (loadingIndicator) {
    loadingIndicator.style.display = 'none';
  }

  // Create React root and render app
  const root = createRoot(rootElement);

  root.render(
    <React.StrictMode>
      <DiagnosticsApp />
    </React.StrictMode>
  );

  console.log('Diagnostics React app initialized');
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

// Cleanup on window unload
window.addEventListener('beforeunload', () => {
  window.removeEventListener('error', handleGlobalError);
  window.removeEventListener('unhandledrejection', handleUnhandledRejection);
});
