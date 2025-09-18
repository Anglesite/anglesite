import React, { Suspense, lazy } from 'react';
import { Header } from './Header';
import { ErrorBoundary } from './ErrorBoundary';

// Lazy load non-critical components for better initial load performance
const Sidebar = lazy(() => import('./Sidebar').then((module) => ({ default: module.Sidebar })));
const Main = lazy(() => import('./Main').then((module) => ({ default: module.Main })));

// Loading fallback component
const LoadingFallback: React.FC<{ componentName: string }> = ({ componentName }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      color: 'var(--text-secondary)',
    }}
  >
    <div
      style={{
        width: '16px',
        height: '16px',
        border: '2px solid var(--accent-fill-rest)',
        borderTopColor: 'transparent',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
        marginRight: '8px',
      }}
    />
    Loading {componentName}...
    <style>{`
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `}</style>
  </div>
);

export const App: React.FC = () => {
  return (
    <div className="app">
      <Header />
      <div className="app-body">
        <ErrorBoundary componentName="Sidebar" fallback={<div>Failed to load sidebar</div>}>
          <Suspense fallback={<LoadingFallback componentName="sidebar" />}>
            <Sidebar />
          </Suspense>
        </ErrorBoundary>
        <ErrorBoundary componentName="Main" fallback={<div>Failed to load main content</div>}>
          <Suspense fallback={<LoadingFallback componentName="main content" />}>
            <Main />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
};

// Enable HMR for this component (webpack only)
declare let module: { hot?: { accept(): void } };
if (typeof module !== 'undefined' && module.hot) {
  module.hot.accept();
}
