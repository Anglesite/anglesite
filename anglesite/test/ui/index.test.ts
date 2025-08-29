/**
 * @file Tests for UI module exports
 */

// Mock the modules being exported
jest.mock('../../app/ui/window-manager', () => ({
  createWindow: jest.fn(),
  showPreview: jest.fn(),
  hidePreview: jest.fn(),
}));

jest.mock('../../app/ui/menu', () => ({
  updateApplicationMenu: jest.fn(),
  createApplicationMenu: jest.fn(),
}));

describe('UI Index', () => {
  it('should export window-manager functions', () => {
    const uiIndex = require('../../app/ui/index');

    expect(typeof uiIndex.createWindow).toBe('function');
    expect(typeof uiIndex.showPreview).toBe('function');
    expect(typeof uiIndex.hidePreview).toBe('function');
  });

  it('should export menu functions', () => {
    const uiIndex = require('../../app/ui/index');

    expect(typeof uiIndex.updateApplicationMenu).toBe('function');
    expect(typeof uiIndex.createApplicationMenu).toBe('function');
  });
});
