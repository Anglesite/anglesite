/**
 * Coverage Command Integration Tests
 * Regression tests to ensure npm run test:coverage works correctly
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

describe('Coverage Command Integration', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const coverageDir = path.join(projectRoot, 'coverage');

  // Clean up coverage directory before and after tests
  beforeEach(() => {
    if (fs.existsSync(coverageDir)) {
      fs.rmSync(coverageDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(coverageDir)) {
      fs.rmSync(coverageDir, { recursive: true, force: true });
    }
  });

  it('should run coverage command without failing tests', async () => {
    // Run the coverage command
    const result = await runCoverageCommand();

    // Should not fail due to test failures
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('FAIL');
    expect(result.stdout).toContain('All files');

    // Should generate coverage directory and files
    expect(fs.existsSync(coverageDir)).toBe(true);
    expect(fs.existsSync(path.join(coverageDir, 'lcov.info'))).toBe(true);
    expect(fs.existsSync(path.join(coverageDir, 'lcov-report'))).toBe(true);
  }, 60000); // Allow 60 seconds for full coverage run

  it('should pass coverage thresholds', async () => {
    const result = await runCoverageCommand();

    // Should not fail due to coverage threshold failures
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('coverage threshold');
    expect(result.stderr).not.toContain('not met');
  }, 60000);

  it('should generate coverage reports in expected formats', async () => {
    const result = await runCoverageCommand();

    expect(result.exitCode).toBe(0);

    // Check all expected coverage report formats are generated
    expect(fs.existsSync(path.join(coverageDir, 'lcov.info'))).toBe(true);
    expect(fs.existsSync(path.join(coverageDir, 'lcov-report', 'index.html'))).toBe(true);

    // Verify coverage summary is in stdout
    expect(result.stdout).toMatch(/All files.*\|.*\|.*\|.*\|/);
    expect(result.stdout).toContain('plugins');
  }, 60000);

  it('should collect coverage from configured source paths', async () => {
    const result = await runCoverageCommand();

    expect(result.exitCode).toBe(0);

    // Coverage should include plugins directory
    expect(result.stdout).toContain('plugins/');

    // Should not include excluded patterns
    expect(result.stdout).not.toContain('node_modules');
    expect(result.stdout).not.toContain('dist/');
    expect(result.stdout).not.toContain('coverage/');
  }, 60000);

  // Helper function to run coverage command
  async function runCoverageCommand(): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn('npm', ['run', 'test:coverage'], {
        cwd: projectRoot,
        stdio: ['inherit', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test' },
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          exitCode: code || 0,
          stdout,
          stderr,
        });
      });
    });
  }
});
