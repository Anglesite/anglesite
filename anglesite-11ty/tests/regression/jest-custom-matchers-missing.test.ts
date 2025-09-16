/**
 * @file Regression test for custom Jest matchers now working
 * @description Verifies that custom matchers are now available in anglesite-11ty tests after the fix
 */

describe('Jest Custom Matchers Working After Fix', () => {
  test('should have toBeValidWebsiteConfig matcher available and working', () => {
    const config = { title: 'Test Website' };

    // The matcher should be available and should give validation feedback
    expect(() => {
      (expect(config) as any).toBeValidWebsiteConfig();
    }).toThrow(/valid website configuration/); // Should throw validation error, not "is not a function"
  });

  test('should have toHaveValidRSLStructure matcher available and working', () => {
    const rslConfig = { enabled: true };

    // The matcher should be available and should give validation feedback
    expect(() => {
      (expect(rslConfig) as any).toHaveValidRSLStructure();
    }).toThrow(/valid RSL structure/); // Should throw validation error, not "is not a function"
  });

  test('should demonstrate that custom matchers are now registered', () => {
    // Verify that expect.extend exists and contains our custom matchers
    expect(expect.extend).toBeDefined();
    expect(typeof expect.extend).toBe('function');

    // Our custom matchers should now be available
    expect((expect as any).toBeValidWebsiteConfig).toBeDefined();
    expect((expect as any).toHaveValidRSLStructure).toBeDefined();
    expect(typeof (expect as any).toBeValidWebsiteConfig).toBe('function');
    expect(typeof (expect as any).toHaveValidRSLStructure).toBe('function');
  });
});
