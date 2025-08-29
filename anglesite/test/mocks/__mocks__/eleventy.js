// Mock for @11ty/eleventy
class MockEleventy {
  constructor() {}

  async write() {
    return Promise.resolve();
  }

  async serve() {
    return Promise.resolve();
  }

  watch() {
    return this;
  }

  setConfigPathOverride() {
    return this;
  }

  setRunMode() {
    return this;
  }
}

module.exports = MockEleventy;
