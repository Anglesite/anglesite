// Mock for bagit-fs
function MockBagItFs() {
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

  return {
    createWriteStream: jestFn(() => ({
      on: jestFn(),
      write: jestFn(),
      end: jestFn(),
    })),
    mkdir: jestFn((path, callback) => callback && callback()),
    finalize: jestFn((callback) => callback && callback()),
  };
}

module.exports = MockBagItFs;
