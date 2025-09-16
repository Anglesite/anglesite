// test/mocks/node-modules.ts

import type * as fs from 'fs';

// Get the real fs module for fallback behavior
const realFs = jest.requireActual<typeof fs>('fs');

// Mock fs module with spy functions that default to real behavior
export const mockFs = {
  existsSync: jest.fn().mockImplementation(realFs.existsSync),
  mkdirSync: jest.fn().mockImplementation(realFs.mkdirSync),
  writeFileSync: jest.fn().mockImplementation(realFs.writeFileSync),
  readFileSync: jest.fn().mockImplementation(realFs.readFileSync),
  readdirSync: jest.fn().mockImplementation(realFs.readdirSync),
  unlinkSync: jest.fn().mockImplementation(realFs.unlinkSync),
  copyFileSync: jest.fn().mockImplementation(realFs.copyFileSync),
  rmSync: jest.fn().mockImplementation(realFs.rmSync),
  statSync: jest.fn().mockImplementation(realFs.statSync),
  renameSync: jest.fn().mockImplementation(realFs.renameSync),
  promises: {
    readFile: jest.fn().mockImplementation(realFs.promises.readFile),
    writeFile: jest.fn().mockImplementation(realFs.promises.writeFile),
    mkdir: jest.fn().mockImplementation(realFs.promises.mkdir),
    rm: jest.fn().mockImplementation(realFs.promises.rm),
    stat: jest.fn().mockImplementation(realFs.promises.stat),
  },
};

jest.mock('fs', () => mockFs);

// Mock path module
export const mockPath = {
  join: jest.fn((...args: string[]) => args.join('/')),
  resolve: jest.fn((...args: string[]) => args.join('/')),
  dirname: jest.fn((p: string) => p.split('/').slice(0, -1).join('/')),
  basename: jest.fn((p: string) => p.split('/').pop()),
  extname: jest.fn((p: string) => {
    const parts = p.split('.');
    return parts.length > 1 ? `.${parts.pop()}` : '';
  }),
  normalize: jest.fn((p: string) => p),
  isAbsolute: jest.fn((p: string) => p.startsWith('/')),
  relative: jest.fn((from: string, to: string) => to),
  parse: jest.fn(),
  format: jest.fn(),
  sep: '/',
  delimiter: ':',
  win32: {},
  posix: {},
};

jest.mock('path', () => mockPath);

// Mock child_process module
export const mockExecSync = jest.fn();
export const mockExec = jest.fn(
  (command: string, callback?: (error: Error | null, stdout: string, stderr: string) => void) => {
    if (callback && typeof callback === 'function') {
      callback(null, 'mock output', '');
    }
    return {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn(),
      kill: jest.fn(),
    };
  }
);
export const mockSpawn = jest.fn(() => ({
  stdout: { on: jest.fn() },
  stderr: { on: jest.fn() },
  on: jest.fn(),
  kill: jest.fn(),
  pid: 12345,
}));

jest.mock('child_process', () => ({
  execSync: mockExecSync,
  exec: mockExec,
  spawn: mockSpawn,
}));

// Mock os module
export const mockOs = {
  platform: jest.fn(() => 'darwin'),
  homedir: jest.fn(() => '/Users/testuser'),
  tmpdir: jest.fn(() => '/tmp'),
  hostname: jest.fn(() => 'test-host'),
  type: jest.fn(() => 'Darwin'),
  release: jest.fn(() => '23.0.0'),
  arch: jest.fn(() => 'x64'),
  cpus: jest.fn(() => []),
  networkInterfaces: jest.fn(() => ({})),
  userInfo: jest.fn(() => ({
    username: 'testuser',
    uid: 1000,
    gid: 1000,
    shell: '/bin/bash',
    homedir: '/Users/testuser',
  })),
};

jest.mock('os', () => mockOs);

// Reset functions for all Node module mocks
export const resetNodeModuleMocks = () => {
  // Reset fs mocks
  mockFs.existsSync.mockClear();
  mockFs.mkdirSync.mockClear();
  mockFs.writeFileSync.mockClear();
  mockFs.readFileSync.mockClear();
  mockFs.readdirSync.mockClear();
  mockFs.unlinkSync.mockClear();
  mockFs.copyFileSync.mockClear();
  mockFs.rmSync.mockClear();
  mockFs.statSync.mockClear();
  mockFs.renameSync.mockClear();
  mockFs.promises.readFile.mockClear();
  mockFs.promises.writeFile.mockClear();
  mockFs.promises.mkdir.mockClear();
  mockFs.promises.rm.mockClear();
  mockFs.promises.stat.mockClear();

  // Reset path mocks
  mockPath.join.mockClear();
  mockPath.resolve.mockClear();
  mockPath.dirname.mockClear();
  mockPath.basename.mockClear();
  mockPath.extname.mockClear();
  mockPath.normalize.mockClear();
  mockPath.isAbsolute.mockClear();
  mockPath.relative.mockClear();
  mockPath.parse.mockClear();
  mockPath.format.mockClear();

  // Reset child_process mocks
  mockExecSync.mockClear();
  mockExec.mockClear();
  mockSpawn.mockClear();

  // Reset os mocks
  mockOs.platform.mockClear();
  mockOs.homedir.mockClear();
  mockOs.tmpdir.mockClear();
  mockOs.hostname.mockClear();
  mockOs.type.mockClear();
  mockOs.release.mockClear();
  mockOs.arch.mockClear();
  mockOs.cpus.mockClear();
  mockOs.networkInterfaces.mockClear();
  mockOs.userInfo.mockClear();
};

// Helper to create mock Dirent objects for fs.readdirSync
export const createMockDirent = (name: string, isDirectory: boolean): fs.Dirent<Buffer> => {
  return {
    name: Buffer.from(name),
    parentPath: '/mock/path',
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isDirectory: () => isDirectory,
    isFIFO: () => false,
    isFile: () => !isDirectory,
    isSocket: () => false,
    isSymbolicLink: () => false,
    path: '/mock/path',
  };
};

// Helper to setup common fs mock patterns
export const setupFsMocks = {
  fileExists: (exists = true) => {
    mockFs.existsSync.mockReturnValue(exists);
  },
  directoryWithFiles: (files: string[]) => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(files.map((name) => createMockDirent(name, false)));
  },
  directoryWithDirs: (dirs: string[]) => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(dirs.map((name) => createMockDirent(name, true)));
  },
  readFile: (content: string) => {
    mockFs.readFileSync.mockReturnValue(content);
  },
  writeSuccess: () => {
    mockFs.writeFileSync.mockImplementation();
  },
};
