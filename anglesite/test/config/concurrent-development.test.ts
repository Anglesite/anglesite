// ABOUTME: Tests concurrent development script configuration and functionality
// ABOUTME: Validates package.json scripts for parallel development workflows

import fs from 'fs';
import path from 'path';

describe('Concurrent Development Configuration', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const packageJsonPath = path.join(projectRoot, 'package.json');
  let packageJson: { scripts: Record<string, string>; devDependencies: Record<string, string> };

  beforeAll(() => {
    const packageContent = fs.readFileSync(packageJsonPath, 'utf8');
    packageJson = JSON.parse(packageContent);
  });

  describe('Package Dependencies', () => {
    it('should have concurrently as devDependency', () => {
      expect(packageJson.devDependencies).toHaveProperty('concurrently');
      expect(packageJson.devDependencies.concurrently).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('Concurrent Development Scripts', () => {
    it('should have build:parallel script', () => {
      expect(packageJson.scripts['build:parallel']).toBeDefined();
      expect(packageJson.scripts['build:parallel']).toContain('concurrently');
      expect(packageJson.scripts['build:parallel']).toContain('build:app');
      expect(packageJson.scripts['build:parallel']).toContain('build:icons');
      expect(packageJson.scripts['build:parallel']).toContain('build:react:dev');
    });

    it('should have dev:full script', () => {
      expect(packageJson.scripts['dev:full']).toBeDefined();
      expect(packageJson.scripts['dev:full']).toContain('concurrently');
      expect(packageJson.scripts['dev:full']).toContain('-k');
      expect(packageJson.scripts['dev:full']).toContain('dev:react');
      expect(packageJson.scripts['dev:full']).toContain('start:dev');
      expect(packageJson.scripts['dev:full']).toContain('--names');
      expect(packageJson.scripts['dev:full']).toContain('--prefix-colors');
    });

    it('should have dev:watch script', () => {
      expect(packageJson.scripts['dev:watch']).toBeDefined();
      expect(packageJson.scripts['dev:watch']).toContain('concurrently');
      expect(packageJson.scripts['dev:watch']).toContain('-k');
      expect(packageJson.scripts['dev:watch']).toContain('dev:react');
      expect(packageJson.scripts['dev:watch']).toContain('test:unit');
      expect(packageJson.scripts['dev:watch']).toContain('--watch');
    });

    it('should have dev:complete script', () => {
      expect(packageJson.scripts['dev:complete']).toBeDefined();
      expect(packageJson.scripts['dev:complete']).toContain('concurrently');
      expect(packageJson.scripts['dev:complete']).toContain('-k');
      expect(packageJson.scripts['dev:complete']).toContain('dev:react:debug');
      expect(packageJson.scripts['dev:complete']).toContain('test:unit');
      expect(packageJson.scripts['dev:complete']).toContain('analyze:bundle:server');
    });

    it('should have test:parallel script', () => {
      expect(packageJson.scripts['test:parallel']).toBeDefined();
      expect(packageJson.scripts['test:parallel']).toContain('concurrently');
      expect(packageJson.scripts['test:parallel']).toContain('test:unit');
      expect(packageJson.scripts['test:parallel']).toContain('lint:parallel');
      expect(packageJson.scripts['test:parallel']).toContain('--kill-others-on-fail');
    });

    it('should have lint:parallel script', () => {
      expect(packageJson.scripts['lint:parallel']).toBeDefined();
      expect(packageJson.scripts['lint:parallel']).toContain('concurrently');
      expect(packageJson.scripts['lint:parallel']).toContain('eslint');
      expect(packageJson.scripts['lint:parallel']).toContain('markdownlint');
      expect(packageJson.scripts['lint:parallel']).toContain('htmlhint');
    });
  });

  describe('Script Configuration', () => {
    it('should use kill-others flag for development scripts', () => {
      const devScripts = ['dev:full', 'dev:watch', 'dev:complete'];
      devScripts.forEach((script) => {
        expect(packageJson.scripts[script]).toContain('-k');
      });
    });

    it('should have color-coded output for parallel scripts', () => {
      const coloredScripts = ['dev:full', 'dev:watch', 'dev:complete', 'test:parallel', 'lint:parallel'];
      coloredScripts.forEach((script) => {
        if (packageJson.scripts[script].includes('--names')) {
          expect(packageJson.scripts[script]).toContain('--prefix-colors');
        }
      });
    });

    it('should use appropriate names for processes', () => {
      expect(packageJson.scripts['dev:full']).toContain('webpack,electron');
      expect(packageJson.scripts['dev:watch']).toContain('webpack,tests');
      expect(packageJson.scripts['dev:complete']).toContain('webpack,tests,analyzer');
      expect(packageJson.scripts['test:parallel']).toContain('tests,lint');
      expect(packageJson.scripts['lint:parallel']).toContain('eslint,markdown,html');
    });
  });

  describe('Documentation', () => {
    it('should have concurrent development documentation', () => {
      const docsPath = path.join(projectRoot, 'docs', 'concurrent-development.md');
      expect(fs.existsSync(docsPath)).toBe(true);

      const docsContent = fs.readFileSync(docsPath, 'utf8');
      expect(docsContent).toContain('Concurrent Development Scripts');
      expect(docsContent).toContain('concurrently');
      expect(docsContent).toContain('dev:full');
      expect(docsContent).toContain('build:parallel');
    });
  });
});
