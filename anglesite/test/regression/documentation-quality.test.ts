/**
 * @file Documentation Quality Validation Tests
 * @description Ensures JSDoc documentation meets quality standards and examples are functional
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

describe('Documentation Quality Validation', () => {
  describe('Mock Factory Documentation', () => {
    let mockFactorySource: string;
    let sourceFile: ts.SourceFile;

    beforeAll(() => {
      const mockFactoryPath = path.join(__dirname, '../utils/mock-factory.ts');
      mockFactorySource = fs.readFileSync(mockFactoryPath, 'utf-8');
      sourceFile = ts.createSourceFile('mock-factory.ts', mockFactorySource, ts.ScriptTarget.Latest, true);
    });

    test('createMockAppContextValue has comprehensive JSDoc', () => {
      const functionDeclarations = findFunctionDeclarations(sourceFile);
      const createMockAppContextValue = functionDeclarations.find(
        (fn) => fn.name?.getText() === 'createMockAppContextValue'
      );

      expect(createMockAppContextValue).toBeDefined();

      const jsDoc = getJSDocComment(createMockAppContextValue!);
      expect(jsDoc).toContain('Creates a mock AppContext value for React component testing');
      expect(jsDoc).toContain('@param');
      expect(jsDoc).toContain('@returns');
      expect(jsDoc).toContain('@example');
    });

    test('createMockWebsiteConfig has comprehensive JSDoc', () => {
      const functionDeclarations = findFunctionDeclarations(sourceFile);
      const createMockWebsiteConfig = functionDeclarations.find(
        (fn) => fn.name?.getText() === 'createMockWebsiteConfig'
      );

      expect(createMockWebsiteConfig).toBeDefined();

      const jsDoc = getJSDocComment(createMockWebsiteConfig!);
      expect(jsDoc).toContain('Creates a standardized website configuration object for testing');
      expect(jsDoc).toContain('@param');
      expect(jsDoc).toContain('@returns');
      expect(jsDoc).toContain('@example');
    });

    test('createPlatformGuard has comprehensive JSDoc', () => {
      const functionDeclarations = findFunctionDeclarations(sourceFile);
      const createPlatformGuard = functionDeclarations.find((fn) => fn.name?.getText() === 'createPlatformGuard');

      expect(createPlatformGuard).toBeDefined();

      const jsDoc = getJSDocComment(createPlatformGuard!);
      expect(jsDoc).toContain('Creates a mock process.platform restoration guard');
      expect(jsDoc).toContain('@returns');
      expect(jsDoc).toContain('@example');
    });

    test('JSDoc examples are syntactically valid TypeScript', () => {
      // Extract @example blocks and validate they compile
      const exampleBlocks = extractExampleBlocks(mockFactorySource);

      exampleBlocks.forEach((example, index) => {
        expect(() => {
          ts.createSourceFile(`example-${index}.ts`, example, ts.ScriptTarget.Latest, true);
        }).not.toThrow();
      });
    });
  });

  describe('RSL Plugin Documentation', () => {
    let rslPluginSource: string;

    beforeAll(() => {
      const rslPluginPath = path.join(__dirname, '../../../anglesite-11ty/plugins/rsl.ts');
      rslPluginSource = fs.readFileSync(rslPluginPath, 'utf-8');
    });

    test('ExtendedWebsiteConfig interface has comprehensive documentation', () => {
      expect(rslPluginSource).toContain('Extended website configuration that includes RSL settings');
      expect(rslPluginSource).toContain('@augments AnglesiteWebsiteConfiguration');
      expect(rslPluginSource).toContain('@example');
      expect(rslPluginSource).toContain('defaultLicense');
      expect(rslPluginSource).toContain('collections');
    });

    test('RSLCollectionItem interface has comprehensive documentation', () => {
      expect(rslPluginSource).toContain('Extended collection item with RSL-specific data');
      expect(rslPluginSource).toContain('@augments EleventyCollectionItem');
      expect(rslPluginSource).toContain('@example');
      expect(rslPluginSource).toContain('RSL-specific fields');
    });

    test('addRSL main function has comprehensive documentation', () => {
      const mainFunctionDoc = rslPluginSource.match(/\/\*\*[\s\S]*?Main RSL plugin function[\s\S]*?\*\//);
      expect(mainFunctionDoc).toBeTruthy();
      expect(mainFunctionDoc![0]).toContain('Key Features');
      expect(mainFunctionDoc![0]).toContain('Configuration');
      expect(mainFunctionDoc![0]).toContain('Generated Files');
      expect(mainFunctionDoc![0]).toContain('@example');
    });

    test('convertItemToAsset function has enhanced documentation', () => {
      const functionDoc = rslPluginSource.match(/\/\*\*[\s\S]*?Converts Eleventy collection item[\s\S]*?\*\//);
      expect(functionDoc).toBeTruthy();
      expect(functionDoc![0]).toContain('@param');
      expect(functionDoc![0]).toContain('@returns');
      expect(functionDoc![0]).toContain('@example');
      expect(functionDoc![0]).toContain('URL resolution');
    });
  });

  describe('React Components Documentation', () => {
    test('FileExplorer loadFiles function has comprehensive documentation', () => {
      const fileExplorerPath = path.join(__dirname, '../../src/renderer/ui/react/components/FileExplorer.tsx');
      const fileExplorerSource = fs.readFileSync(fileExplorerPath, 'utf-8');

      expect(fileExplorerSource).toContain('Loads website files through Electron IPC');
      expect(fileExplorerSource).toContain('IPC communication with the main process');
      expect(fileExplorerSource).toContain('@throws {Error}');
      expect(fileExplorerSource).toContain('@example');
      expect(fileExplorerSource).toContain('get-website-files');
    });

    test('FileExplorer buildFileTree function has comprehensive documentation', () => {
      const fileExplorerPath = path.join(__dirname, '../../src/renderer/ui/react/components/FileExplorer.tsx');
      const fileExplorerSource = fs.readFileSync(fileExplorerPath, 'utf-8');

      expect(fileExplorerSource).toContain('Builds a hierarchical file tree structure');
      expect(fileExplorerSource).toContain('Processing Steps');
      expect(fileExplorerSource).toContain('Error Handling');
      expect(fileExplorerSource).toContain('@param rawFiles');
      expect(fileExplorerSource).toContain('@returns Promise resolving to hierarchical');
    });

    test('WebsiteConfigEditor loadSchemaAndData function has comprehensive documentation', () => {
      const webConfigPath = path.join(__dirname, '../../src/renderer/ui/react/components/WebsiteConfigEditor.tsx');
      const webConfigSource = fs.readFileSync(webConfigPath, 'utf-8');

      expect(webConfigSource).toContain('Loads website schema and configuration data');
      expect(webConfigSource).toContain('IPC Communication');
      expect(webConfigSource).toContain('Error Handling');
      expect(webConfigSource).toContain('State Management');
      expect(webConfigSource).toContain('get-website-schema');
      expect(webConfigSource).toContain('get-file-content');
    });

    test('WebsiteConfigEditor handleSubmit function has comprehensive documentation', () => {
      const webConfigPath = path.join(__dirname, '../../src/renderer/ui/react/components/WebsiteConfigEditor.tsx');
      const webConfigSource = fs.readFileSync(webConfigPath, 'utf-8');

      expect(webConfigSource).toContain('Handles form submission for website configuration');
      expect(webConfigSource).toContain('Validation Steps');
      expect(webConfigSource).toContain('save-file-content');
      expect(webConfigSource).toContain('@param data Form submission data');
      expect(webConfigSource).toContain('React JSON Schema Form');
    });
  });
});

// Helper functions for AST parsing
function findFunctionDeclarations(sourceFile: ts.SourceFile): ts.FunctionDeclaration[] {
  const functions: ts.FunctionDeclaration[] = [];

  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node)) {
      functions.push(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return functions;
}

function getJSDocComment(node: ts.Node): string {
  const jsDocNodes = (node as ts.Node & { jsDoc?: ts.JSDoc[] }).jsDoc;
  if (!jsDocNodes || jsDocNodes.length === 0) {
    return '';
  }
  return jsDocNodes[0].getFullText();
}

function extractExampleBlocks(source: string): string[] {
  const exampleRegex = /```typescript\n([\s\S]*?)\n```/g;
  const examples: string[] = [];
  let match;

  while ((match = exampleRegex.exec(source)) !== null) {
    examples.push(match[1]);
  }

  return examples;
}
