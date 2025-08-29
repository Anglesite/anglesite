// Mock for @11ty/eleventy-dev-server
class MockEleventyDevServer {
  constructor() {
    const jestFn = (returnValue) => {
      const fn = (...args) => {
        if (typeof returnValue === 'function') {
          return returnValue(...args);
        }
        return returnValue;
      };
      fn.mockImplementation = () => fn;
      fn.mockReturnValue = () => fn;
      fn.mockResolvedValue = () => fn;
      return fn;
    };

    this.watcher = {
      on: jestFn(),
      close: jestFn(),
    };
  }

  async serve() {
    return Promise.resolve();
  }

  async close() {
    return Promise.resolve();
  }

  watchFiles() {
    return this;
  }
}

module.exports = MockEleventyDevServer;
