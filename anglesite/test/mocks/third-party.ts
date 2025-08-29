// test/mocks/third-party.ts

// Mock hostile module for DNS management
export const mockHostile = {
  set: jest.fn(),
  remove: jest.fn(),
  get: jest.fn(() => []),
  removeMatching: jest.fn(),
};

jest.mock('hostile', () => mockHostile);

// Mock mkcert module
export const mockCreateCA = jest.fn();
export const mockCreateCert = jest.fn();

jest.mock('mkcert', () => ({
  createCA: mockCreateCA,
  createCert: mockCreateCert,
}));

// Mock archiver module for BagIt exports
export const mockArchiver = {
  create: jest.fn(() => ({
    pipe: jest.fn(),
    directory: jest.fn(),
    file: jest.fn(),
    append: jest.fn(),
    finalize: jest.fn(() => Promise.resolve()),
    on: jest.fn(),
  })),
};

jest.mock('archiver', () => mockArchiver);

// Mock http-proxy module (conditional)
export const mockHttpProxy = {
  createProxyServer: jest.fn(() => ({
    on: jest.fn(),
    web: jest.fn(),
    ws: jest.fn(),
    close: jest.fn(),
  })),
};

try {
  require.resolve('http-proxy');
  jest.mock('http-proxy', () => mockHttpProxy);
} catch {
  // Module not found, skip mocking
}

// Mock live-server module (conditional)
export const mockLiveServer = {
  start: jest.fn(),
  shutdown: jest.fn(),
};

try {
  require.resolve('live-server');
  jest.mock('live-server', () => mockLiveServer);
} catch {
  // Module not found, skip mocking
}

// Mock @11ty/eleventy
export const mockEleventyClass = jest.fn().mockImplementation(() => ({
  init: jest.fn(),
  write: jest.fn(),
  watch: jest.fn(),
  serve: jest.fn(),
  setConfigPathOverride: jest.fn(),
  setRunMode: jest.fn(),
}));

jest.mock('@11ty/eleventy', () => mockEleventyClass);

// Mock @11ty/eleventy-dev-server
export const mockEleventyDevServerClass = jest.fn().mockImplementation(() => ({
  serve: jest.fn(),
  close: jest.fn(),
  watchFiles: jest.fn(),
  watcher: {
    on: jest.fn(),
    close: jest.fn(),
  },
}));

jest.mock('@11ty/eleventy-dev-server', () => mockEleventyDevServerClass);

// Mock bagit-fs
export const mockBagItFs = jest.fn(() => ({
  createWriteStream: jest.fn(() => ({
    on: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  })),
  mkdir: jest.fn((path, callback) => callback && callback()),
  finalize: jest.fn((callback) => callback && callback()),
}));

jest.mock('bagit-fs', () => mockBagItFs);

// Reset all third-party mocks
export const resetThirdPartyMocks = () => {
  // Reset hostile mocks
  mockHostile.set.mockClear();
  mockHostile.remove.mockClear();
  mockHostile.get.mockClear();
  mockHostile.removeMatching.mockClear();

  // Reset mkcert mocks
  mockCreateCA.mockClear();
  mockCreateCert.mockClear();

  // Reset archiver mocks
  mockArchiver.create.mockClear();

  // Reset http-proxy mocks
  mockHttpProxy.createProxyServer.mockClear();

  // Reset live-server mocks
  mockLiveServer.start.mockClear();
  mockLiveServer.shutdown.mockClear();

  // Reset eleventy mocks
  mockEleventyClass.mockClear();
  mockEleventyDevServerClass.mockClear();

  // Reset bagit-fs mocks
  mockBagItFs.mockClear();
};
