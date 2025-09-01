/**
 * @file Tests for template-loader.ts
 */
import * as fs from 'fs';
import * as path from 'path';

// Mock electron before importing template-loader
jest.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

import { loadTemplate, loadTemplateAsDataUrl } from '../../src/main/ui/template-loader';

// Mock fs module
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock path module
jest.mock('path');
const mockPath = path as jest.Mocked<typeof path>;

describe('template-loader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadTemplate', () => {
    it('should load template file successfully', () => {
      const templateName = 'test-template';
      const templatePath = '/app/ui/templates/test-template.html';
      const templateContent = '<html><title>{{title}}</title><body><h1>{{heading}}</h1></body></html>';

      mockPath.join.mockReturnValue(templatePath);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(templateContent);

      const variables = { title: 'Test Title', heading: 'Test Heading' };
      const result = loadTemplate(templateName, variables);

      expect(mockPath.join).toHaveBeenCalledWith(expect.any(String), 'templates', 'test-template.html');
      expect(mockFs.existsSync).toHaveBeenCalledWith(templatePath);
      expect(mockFs.readFileSync).toHaveBeenCalledWith(templatePath, 'utf8');
      expect(result).toBe('<html><title>Test Title</title><body><h1>Test Heading</h1></body></html>');
    });

    it('should load template without variables', () => {
      const templateName = 'simple-template';
      const templatePath = '/app/ui/templates/simple-template.html';
      const templateContent = '<html><title>Static Title</title></html>';

      mockPath.join.mockReturnValue(templatePath);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(templateContent);

      const result = loadTemplate(templateName);

      expect(result).toBe('<html><title>Static Title</title></html>');
    });

    it('should replace multiple occurrences of the same variable', () => {
      const templateName = 'multi-var-template';
      const templatePath = '/app/ui/templates/multi-var-template.html';
      const templateContent =
        '<html><title>{{name}}</title><body><h1>{{name}}</h1><p>Welcome to {{name}}</p></body></html>';

      mockPath.join.mockReturnValue(templatePath);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(templateContent);

      const variables = { name: 'My App' };
      const result = loadTemplate(templateName, variables);

      expect(result).toBe('<html><title>My App</title><body><h1>My App</h1><p>Welcome to My App</p></body></html>');
    });

    it('should leave unreplaced variables in template', () => {
      const templateName = 'partial-template';
      const templatePath = '/app/ui/templates/partial-template.html';
      const templateContent = '<html><title>{{title}}</title><body><h1>{{heading}}</h1></body></html>';

      mockPath.join.mockReturnValue(templatePath);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(templateContent);

      const variables = { title: 'Test Title' }; // Only provide one variable
      const result = loadTemplate(templateName, variables);

      expect(result).toBe('<html><title>Test Title</title><body><h1>{{heading}}</h1></body></html>');
    });

    it('should handle empty variables object', () => {
      const templateName = 'no-vars-template';
      const templatePath = '/app/ui/templates/no-vars-template.html';
      const templateContent = '<html><title>{{title}}</title></html>';

      mockPath.join.mockReturnValue(templatePath);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(templateContent);

      const result = loadTemplate(templateName, {});

      expect(result).toBe('<html><title>{{title}}</title></html>');
    });

    it('should throw error when template file does not exist', () => {
      const templateName = 'missing-template';
      const templatePath = '/app/ui/templates/missing-template.html';

      mockPath.join.mockReturnValue(templatePath);
      mockFs.existsSync.mockReturnValue(false);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      expect(() => loadTemplate(templateName)).toThrow(
        'Template file not found: /app/ui/templates/missing-template.html'
      );

      consoleSpy.mockRestore();
    });

    it('should throw error when file read fails', () => {
      const templateName = 'read-error-template';
      const templatePath = '/app/ui/templates/read-error-template.html';
      const readError = new Error('Permission denied');

      mockPath.join.mockReturnValue(templatePath);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw readError;
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      expect(() => loadTemplate(templateName)).toThrow('Permission denied');

      consoleSpy.mockRestore();
    });

    it('should handle special characters in variables', () => {
      const templateName = 'special-chars-template';
      const templatePath = '/app/ui/templates/special-chars-template.html';
      const templateContent = '<html><title>{{title}}</title><meta content="{{description}}"></html>';

      mockPath.join.mockReturnValue(templatePath);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(templateContent);

      const variables = {
        title: 'Test & <Special> "Characters"',
        description: 'A test with special chars: &<>"\'`',
      };
      const result = loadTemplate(templateName, variables);

      expect(result).toBe(
        '<html><title>Test & <Special> "Characters"</title><meta content="A test with special chars: &<>"\'`"></html>'
      );
    });
  });

  describe('loadTemplateAsDataUrl', () => {
    it('should return proper data URL', () => {
      const templateName = 'data-url-template';
      const templatePath = '/app/ui/templates/data-url-template.html';
      const templateContent = '<html><title>{{title}}</title></html>';

      mockPath.join.mockReturnValue(templatePath);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(templateContent);

      const variables = { title: 'Data URL Test' };
      const result = loadTemplateAsDataUrl(templateName, variables);

      const expectedHtml = '<html><title>Data URL Test</title></html>';
      const expectedDataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(expectedHtml)}`;

      expect(result).toBe(expectedDataUrl);
    });

    it('should return proper data URL without variables', () => {
      const templateName = 'simple-data-url-template';
      const templatePath = '/app/ui/templates/simple-data-url-template.html';
      const templateContent = '<html><title>Static</title></html>';

      mockPath.join.mockReturnValue(templatePath);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(templateContent);

      const result = loadTemplateAsDataUrl(templateName);

      const expectedDataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(templateContent)}`;

      expect(result).toBe(expectedDataUrl);
    });

    it('should properly encode special characters in data URL', () => {
      const templateName = 'special-encoding-template';
      const templatePath = '/app/ui/templates/special-encoding-template.html';
      const templateContent = '<html><title>{{title}}</title></html>';

      mockPath.join.mockReturnValue(templatePath);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(templateContent);

      const variables = { title: 'Test & <Special> Characters 🚀' };
      const result = loadTemplateAsDataUrl(templateName, variables);

      const expectedHtml = '<html><title>Test & <Special> Characters 🚀</title></html>';
      const expectedDataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(expectedHtml)}`;

      expect(result).toBe(expectedDataUrl);
      expect(result).toContain('Test%20%26%20%3CSpecial%3E%20Characters%20%F0%9F%9A%80');
    });

    it('should handle loadTemplate errors', () => {
      const templateName = 'error-template';
      const templatePath = '/app/ui/templates/error-template.html';

      mockPath.join.mockReturnValue(templatePath);
      mockFs.existsSync.mockReturnValue(false);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      expect(() => loadTemplateAsDataUrl(templateName)).toThrow(
        'Template file not found: /app/ui/templates/error-template.html'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('edge cases', () => {
    it('should handle empty template content', () => {
      const templateName = 'empty-template';
      const templatePath = '/app/ui/templates/empty-template.html';
      const templateContent = '';

      mockPath.join.mockReturnValue(templatePath);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(templateContent);

      const result = loadTemplate(templateName);

      expect(result).toBe('');
    });

    it('should handle template names with special characters', () => {
      const templateName = 'template-with-dashes_and_underscores';
      const templatePath = '/app/ui/templates/template-with-dashes_and_underscores.html';
      const templateContent = '<html></html>';

      mockPath.join.mockReturnValue(templatePath);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(templateContent);

      const result = loadTemplate(templateName);

      expect(mockPath.join).toHaveBeenCalledWith(
        expect.any(String),
        'templates',
        'template-with-dashes_and_underscores.html'
      );
      expect(result).toBe('<html></html>');
    });

    it('should handle variables with empty string values', () => {
      const templateName = 'empty-var-template';
      const templatePath = '/app/ui/templates/empty-var-template.html';
      const templateContent = '<html><title>{{title}}</title><h1>{{heading}}</h1></html>';

      mockPath.join.mockReturnValue(templatePath);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(templateContent);

      const variables = { title: '', heading: 'Not Empty' };
      const result = loadTemplate(templateName, variables);

      expect(result).toBe('<html><title></title><h1>Not Empty</h1></html>');
    });

    it('should verify template replacement behavior', () => {
      const templateName = 'malformed-template';
      const templatePath = '/app/ui/templates/malformed-template.html';
      const templateContent = '<html><title>{title}</title><h1>{{title}</h1><p>{{title</p></html>';

      mockPath.join.mockReturnValue(templatePath);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(templateContent);

      const variables = { title: 'Test Title' };
      const result = loadTemplate(templateName, variables);

      // Just test that the template loading process works with various patterns
      expect(result).toContain('{title}'); // Single braces not replaced
      expect(result).toContain('{{title'); // Incomplete pattern exists
      expect(typeof result).toBe('string'); // Function returns a string
      expect(result.length).toBeGreaterThan(0); // Result is not empty
    });
  });
});
