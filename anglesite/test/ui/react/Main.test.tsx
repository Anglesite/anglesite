/**
 * @file Tests for Main component code splitting implementation
 * @description Focused tests for lazy loading and error boundary behavior
 */

// Wrap in a function to avoid global scope pollution and bypass Jest mocking
const getReactTestModules = () => {
  // Use jest.requireActual to completely bypass Jest's module mocking
  const fs = jest.requireActual('fs');
  const path = jest.requireActual('path');
  return { fs, path };
};

const { fs: realFs, path: realPath } = getReactTestModules();

// Find the anglesite project root - more robust for monorepo setups
function findProjectRoot() {
  // First try using a relative path from test location
  const relativeRoot = realPath.resolve(__dirname, '../../..');
  const relativePackageJsonPath = realPath.join(relativeRoot, 'package.json');

  if (realFs.existsSync(relativePackageJsonPath)) {
    try {
      const packageJson = JSON.parse(realFs.readFileSync(relativePackageJsonPath, 'utf8'));
      if (packageJson.name === '@dwk/anglesite') {
        return relativeRoot;
      }
    } catch {
      // Continue with directory traversal
    }
  }

  // Fallback: traverse up the directory tree
  let currentDir = __dirname;
  while (currentDir !== realPath.dirname(currentDir)) {
    const packageJsonPath = realPath.join(currentDir, 'package.json');
    if (realFs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(realFs.readFileSync(packageJsonPath, 'utf8'));
        if (packageJson.name === '@dwk/anglesite') {
          return currentDir;
        }
      } catch {
        // Continue searching
      }
    }
    currentDir = realPath.dirname(currentDir);
  }

  // Final fallback
  return relativeRoot;
}

// Simple test approach - test the actual implementation without complex mocking
describe('Main Component Code Splitting', () => {
  // Test that the component file exists and has the right structure
  it('should have lazy loading implementation', () => {
    // Get a fresh fs module to avoid any cached mocks
    const freshFs = jest.requireActual('fs');
    const freshPath = jest.requireActual('path');

    const projectRoot = findProjectRoot();
    const mainPath = freshPath.join(projectRoot, 'src/renderer/ui/react/components/Main.tsx');

    expect(freshFs.existsSync(mainPath)).toBe(true);

    const mainContent = freshFs.readFileSync(mainPath, 'utf8');

    // Check for lazy loading patterns
    expect(mainContent).toMatch(/lazy\(/);
    expect(mainContent).toMatch(/import\s*\(/);
    expect(mainContent).toMatch(/webpackChunkName/);
    expect(mainContent).toMatch(/<Suspense/);
  });

  it('should have Error Boundary for lazy components', () => {
    // Get a fresh fs module to avoid any cached mocks
    const freshFs = jest.requireActual('fs');
    const freshPath = jest.requireActual('path');

    const projectRoot = findProjectRoot();
    const mainPath = freshPath.join(projectRoot, 'src/renderer/ui/react/components/Main.tsx');
    const mainContent = freshFs.readFileSync(mainPath, 'utf8');

    // Check for Error Boundary import and usage
    expect(mainContent).toMatch(/import.*ErrorBoundary.*from.*ErrorBoundary/);
    expect(mainContent).toMatch(/<ErrorBoundary/);
    expect(mainContent).toMatch(/<\/ErrorBoundary>/);

    // Verify ErrorBoundary exists as separate file
    const errorBoundaryPath = freshPath.join(projectRoot, 'src/renderer/ui/react/components/ErrorBoundary.tsx');

    expect(freshFs.existsSync(errorBoundaryPath)).toBe(true);
  });

  it('should have conditional lazy loading', () => {
    // Get a fresh fs module to avoid any cached mocks
    const freshFs = jest.requireActual('fs');
    const freshPath = jest.requireActual('path');

    const projectRoot = findProjectRoot();
    const mainPath = freshPath.join(projectRoot, 'src/renderer/ui/react/components/Main.tsx');
    const mainContent = freshFs.readFileSync(mainPath, 'utf8');

    // Check that lazy import is done conditionally
    expect(mainContent).toMatch(/case\s+['"]website-config['"]/);
    expect(mainContent).toMatch(/const\s+WebsiteConfigEditor\s*=/);
  });

  it('should have proper fallback UI for loading states', () => {
    // Get a fresh fs module to avoid any cached mocks
    const freshFs = jest.requireActual('fs');
    const freshPath = jest.requireActual('path');

    const projectRoot = findProjectRoot();
    const mainPath = freshPath.join(projectRoot, 'src/renderer/ui/react/components/Main.tsx');
    const mainContent = freshFs.readFileSync(mainPath, 'utf8');

    // Check for loading and error fallbacks
    expect(mainContent).toMatch(/Loading configuration editor/);
    expect(mainContent).toMatch(/Failed to load configuration editor/);
  });

  it('should export Main component properly', () => {
    // Get a fresh fs module to avoid any cached mocks
    const freshFs = jest.requireActual('fs');
    const freshPath = jest.requireActual('path');

    const projectRoot = findProjectRoot();
    const mainPath = freshPath.join(projectRoot, 'src/renderer/ui/react/components/Main.tsx');
    const mainContent = freshFs.readFileSync(mainPath, 'utf8');

    // Check for proper export
    expect(mainContent).toMatch(/export.*Main/);
  });
});
