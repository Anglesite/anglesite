import React from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { Main } from './Main';

export const App: React.FC = () => {
  return (
    <div className="app">
      <Header />
      <div className="app-body">
        <Sidebar />
        <Main />
      </div>
    </div>
  );
};

// Enable HMR for this component (webpack only)
declare let module: any;
if (typeof module !== 'undefined' && module.hot) {
  module.hot.accept();
}
