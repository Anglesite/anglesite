/**
 * @file Regression test for webpack clean race condition
 *
 * Bug: Webpack's clean: true option has a race condition that causes ENOTEMPTY errors
 * when trying to remove directories that still contain files being deleted.
 *
 * Fix: Disabled webpack clean and use pre-build script (bin/clean-react-dist.js)
 * to properly clean the dist directory before webpack runs.
 *
 * This test ensures:
 * 1. webpack clean option is disabled in config
 * 2. prebuild:react script exists and runs the clean script
 * 3. The clean script properly removes the dist directory
 */

import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

describe('Webpack Clean Race Condition Regression', () => {
  const projectRoot = path.join(__dirname, '..', '..');
  const assetsConfigPath = path.join(projectRoot, 'assets.config.js');
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const cleanScriptPath = path.join(projectRoot, 'bin', 'clean-react-dist.js');

  it('should have webpack clean disabled in assets config', () => {
    const assetsConfig = require(assetsConfigPath);
    expect(assetsConfig.output.clean).toBe(false);
  });

  it('should have prebuild:react script configured', () => {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    expect(packageJson.scripts['prebuild:react']).toBeDefined();
    expect(packageJson.scripts['prebuild:react']).toContain('clean-react-dist.js');
  });

  it('should have clean-react-dist.js script that removes dist directory', () => {
    expect(fs.existsSync(cleanScriptPath)).toBe(true);

    const scriptContent = fs.readFileSync(cleanScriptPath, 'utf-8');
    expect(scriptContent).toContain('fs.rmSync');
    expect(scriptContent).toContain('recursive: true');
    expect(scriptContent).toContain('force: true');
  });

  it('should successfully clean dist directory without errors', () => {
    const distDir = path.join(projectRoot, 'dist', 'src', 'renderer', 'ui', 'react');

    // Create a test directory structure
    fs.mkdirSync(path.join(distDir, 'test-dir', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(distDir, 'test-dir', 'nested', 'test.js'), 'test');

    // Run the clean script
    const result = execSync(`node "${cleanScriptPath}"`, { encoding: 'utf-8' });

    // Verify it succeeded
    expect(result).toContain('Cleaned React dist directory');

    // Verify directory is removed
    expect(fs.existsSync(distDir)).toBe(false);
  });
});
