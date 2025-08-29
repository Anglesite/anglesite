// test/mocks/index.ts

// Re-export all electron mocks
export * from './electron';

// Re-export all app module mocks
export * from './app-modules';

// Re-export all Node.js built-in module mocks
export * from './node-modules';

// Re-export all third-party module mocks
export * from './third-party';

// Re-export utility mocks
export * from './utils';

// Master reset function that resets all mocks
export const resetAllMocks = () => {
  const { resetElectronMocks } = require('./electron');
  const { resetAppModulesMocks } = require('./app-modules');
  const { resetNodeModuleMocks } = require('./node-modules');
  const { resetThirdPartyMocks } = require('./third-party');

  resetElectronMocks();
  resetAppModulesMocks();
  resetNodeModuleMocks();
  resetThirdPartyMocks();
};
