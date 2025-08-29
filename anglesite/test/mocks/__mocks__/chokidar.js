/**
 * Mock for chokidar module to prevent native dependency issues in tests
 */

// Mock FSWatcher class
class MockFSWatcher {
  constructor() {
    this.listeners = new Map();
  }

  add() {
    return this;
  }

  unwatch() {
    return this;
  }

  close() {
    return Promise.resolve();
  }

  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);
    return this;
  }

  off(event, listener) {
    if (this.listeners.has(event)) {
      const listeners = this.listeners.get(event);
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
    return this;
  }

  emit(event, ...args) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach((listener) => listener(...args));
    }
  }
}

// Mock chokidar.watch function
const mockWatch = jest.fn(() => new MockFSWatcher());

module.exports = {
  watch: mockWatch,
  FSWatcher: MockFSWatcher,
  default: { watch: mockWatch, FSWatcher: MockFSWatcher },
};
