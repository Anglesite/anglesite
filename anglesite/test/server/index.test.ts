/**
 * @file Tests for server module exports
 */
import * as serverModule from '../../app/server/index';

describe('Server Module Exports', () => {
  it('should export eleventy functions', () => {
    expect(typeof serverModule.getCurrentLiveServerUrl).toBe('function');
    expect(typeof serverModule.isLiveServerReady).toBe('function');
    expect(typeof serverModule.setLiveServerUrl).toBe('function');
    expect(typeof serverModule.setCurrentWebsiteName).toBe('function');
    expect(typeof serverModule.getCurrentWebsiteName).toBe('function');
    expect(typeof serverModule.getHostnameFromTestDomain).toBe('function');
  });

  it('should export https-proxy functions', () => {
    expect(typeof serverModule.createHttpsProxy).toBe('function');
    expect(typeof serverModule.stopHttpsProxy).toBe('function');
    expect(typeof serverModule.restartHttpsProxy).toBe('function');
  });
});
