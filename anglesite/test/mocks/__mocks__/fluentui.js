/**
 * @file Mock for @fluentui/web-components to prevent ESM loading issues in Jest
 */

// Mock the main FluentUI web components module
const mockFluentUI = {
  // Mock common components that might be used
  FluentCard: function () {
    return 'div';
  },
  FluentButton: function () {
    return 'button';
  },
  FluentTextField: function () {
    return 'input';
  },
  FluentSelect: function () {
    return 'select';
  },
  FluentCheckbox: function () {
    return 'input';
  },
  FluentRadio: function () {
    return 'input';
  },
  FluentTextArea: function () {
    return 'textarea';
  },

  // Mock registration functions
  provideFluentDesignSystem: jest.fn(),
  baseLayerLuminance: {},
  accentBaseColor: {},
  neutralBaseColor: {},

  // Mock any other exports that might be imported
  __esModule: true,
  default: {},
};

// Export all mocked components
module.exports = mockFluentUI;
