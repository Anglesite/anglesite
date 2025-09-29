/**
 * @file Regression test for npm run test timeout issues
 * @description Ensures npm run test completes within reasonable time without hanging
 */

import { execSync } from 'child_process';

describe('npm run test Timeout Regression', () => {
  test('should complete npm run test within reasonable time', async () => {
    const startTime = Date.now();

    try {
      // Run npm test command with timeout
      const result = execSync('npm test', {
        timeout: 60000, // 60 second timeout (was hanging indefinitely before fix)
        encoding: 'utf8',
        stdio: 'pipe',
      });

      const duration = Date.now() - startTime;

      // Should complete within 65 seconds (was hanging indefinitely before)
      expect(duration).toBeLessThan(65000);

      // Should indicate Jest ran (even if some tests fail)
      expect(result).toContain('Test Suites:');
    } catch (error: any) {
      const duration = Date.now() - startTime;

      // If it failed due to test failures, that's OK as long as it didn't timeout
      if (error.status !== 0 && error.stdout) {
        // Jest ran but tests failed - this is acceptable for regression test
        expect(duration).toBeLessThan(65000);
        expect(error.stdout).toContain('Test Suites:');
      } else if (error.signal === 'SIGTERM') {
        // This means it timed out - this is the bug we're trying to fix
        fail(`npm test timed out after ${duration}ms - this is the bug being fixed`);
      } else {
        throw error;
      }
    }
  }, 50000); // Give Jest 50 seconds total

  test('should exclude performance tests by default', () => {
    // Check that performance tests are not included in default test run
    // Use the same environment variables as the npm test script
    const testList = execSync('SKIP_PERFORMANCE_TESTS=true NODE_ENV=test npx jest --listTests', {
      encoding: 'utf8',
      stdio: 'pipe',
    });

    const performanceTestCount = (testList.match(/test\/performance\//g) || []).length;

    // Should exclude performance tests (they cause timeouts)
    expect(performanceTestCount).toBe(0);
  });

  test('should set NODE_ENV=test to prevent service initialization', () => {
    // This test verifies the environment is set correctly
    // We can't easily test service initialization directly in Jest,
    // but we can verify the npm script sets NODE_ENV
    const packageJson = require('../../package.json');
    const testScript = packageJson.scripts.test;

    // The test script should include NODE_ENV=test
    expect(testScript).toContain('NODE_ENV=test');
  });
});
