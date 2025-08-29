/**
 * Mock for glob module to prevent native dependency issues in tests
 */

// Mock glob function
const mockGlob = jest.fn().mockResolvedValue([]);
mockGlob.sync = jest.fn().mockReturnValue([]);
mockGlob.globSync = jest.fn().mockReturnValue([]);

// Export both named and default exports to match glob module structure
module.exports = {
  glob: mockGlob,
  globSync: mockGlob.sync,
  default: mockGlob,
};

// Also support ES6 imports
module.exports.glob = mockGlob;
