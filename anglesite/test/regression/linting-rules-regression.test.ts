/**
 * @file Regression test for ESLint rule enforcement
 * @description Tests that verify common linting violations are properly detected and prevented
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

describe('Linting Rules Regression Tests', () => {
  const tempDir = path.join(__dirname, '../temp');
  const tempFile = path.join(tempDir, 'test-linting.tsx');

  beforeAll(() => {
    // Create temp directory for test files
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up temp files
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should detect @typescript-eslint/no-explicit-any violations', () => {
    // Create a test file with 'any' types
    const testContent = `
import React from 'react';

interface TestProps {
  onSave?: (data: any) => void;  // Should trigger error
}

export const TestComponent: React.FC<TestProps> = ({ onSave }) => {
  const handleSubmit = async (data: any) => {  // Should trigger error
    onSave?.(data);
  };

  return <div>Test</div>;
};
`;

    fs.writeFileSync(tempFile, testContent);

    expect(() => {
      execSync(`npx eslint ${tempFile}`, {
        cwd: path.resolve(__dirname, '../..'),
        stdio: 'pipe',
      });
    }).toThrow(); // ESLint should fail due to 'any' types
  });

  it('should detect @typescript-eslint/no-unused-vars violations', () => {
    // Create a test file with unused variables
    const testContent = `
import React from 'react';
import * as unusedModule from 'fs';  // Should trigger error

export const TestComponent: React.FC = () => {
  try {
    console.log('test');
  } catch (err) {  // Should trigger error for unused 'err'
    console.log('Error occurred');
  }

  return <div>Test</div>;
};
`;

    fs.writeFileSync(tempFile, testContent);

    expect(() => {
      execSync(`npx eslint ${tempFile}`, {
        cwd: path.resolve(__dirname, '../..'),
        stdio: 'pipe',
      });
    }).toThrow(); // ESLint should fail due to unused variables
  });

  it('should detect no-undef violations', () => {
    // Create a test file with undefined globals
    const testContent = `
export function setPlatform(platform: NodeJS.Platform) {  // Should trigger error
  process.platform = platform;
}
`;

    fs.writeFileSync(tempFile, testContent);

    expect(() => {
      execSync(`npx eslint ${tempFile}`, {
        cwd: path.resolve(__dirname, '../..'),
        stdio: 'pipe',
      });
    }).toThrow(); // ESLint should fail due to undefined NodeJS
  });

  it('should pass when proper types are used', () => {
    // Create a test file with correct typing and proper formatting
    const testContent = `import React from 'react';

interface FormData {
  name: string;
  description: string;
}

interface TestProps {
  onSave?: (data: FormData) => void;
}

export const TestComponent: React.FC<TestProps> = ({ onSave }) => {
  const handleSubmit = async (data: FormData) => {
    onSave?.(data);
  };

  const handleClick = () => {
    handleSubmit({ name: 'test', description: 'test description' });
  };

  return <button onClick={handleClick}>Test</button>;
};
`;

    fs.writeFileSync(tempFile, testContent);

    expect(() => {
      execSync(`npx eslint ${tempFile}`, {
        cwd: path.resolve(__dirname, '../..'),
        stdio: 'pipe',
      });
    }).not.toThrow(); // ESLint should pass with proper types
  });
});
