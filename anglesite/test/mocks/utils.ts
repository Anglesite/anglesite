// test/mocks/utils.ts

export const setupConsoleSpies = () => {
  const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  return { consoleSpy, consoleErrorSpy };
};

export const restoreConsoleSpies = (consoleSpy: jest.SpyInstance, consoleErrorSpy: jest.SpyInstance) => {
  consoleSpy.mockRestore();
  consoleErrorSpy.mockRestore();
};
