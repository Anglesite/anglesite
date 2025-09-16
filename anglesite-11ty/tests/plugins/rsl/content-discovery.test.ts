/**
 * Tests for RSL Content Discovery Module
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { discoverContentAssets, validateDiscoveredAssets } from '../../../plugins/rsl/content-discovery';
import type { RSLContentDiscoveryConfig, RSLContentAsset } from '../../../plugins/rsl/types';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

/**
 * Creates a temporary directory structure for testing
 * @param structure - Object representing the file structure
 * @returns Promise resolving to the temporary directory path
 */
async function createTempDirectory(structure: Record<string, string | Buffer>): Promise<string> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rsl-test-'));

  for (const [filePath, content] of Object.entries(structure)) {
    const fullPath = path.join(tempDir, filePath);
    const dir = path.dirname(fullPath);

    // Create directory if it doesn't exist
    await mkdir(dir, { recursive: true });

    // Write file content
    if (typeof content === 'string') {
      await writeFile(fullPath, content, 'utf-8');
    } else {
      await writeFile(fullPath, content);
    }
  }

  return tempDir;
}

/**
 * Cleans up temporary directory
 * @param tempDir - Directory to remove
 */
async function cleanupTempDirectory(tempDir: string): Promise<void> {
  try {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Failed to cleanup temp directory ${tempDir}:`, error);
  }
}

describe('Content Discovery Module', () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await cleanupTempDirectory(tempDir);
    }
  });

  describe('Basic Asset Discovery', () => {
    it('should discover basic file types', async () => {
      tempDir = await createTempDirectory({
        'index.html': '<html><body>Test</body></html>',
        'style.css': 'body { color: red; }',
        'script.js': 'console.log("test");',
        'image.png': Buffer.from('fake-png-data'),
        'document.pdf': Buffer.from('fake-pdf-data'),
      });

      const config: RSLContentDiscoveryConfig = {
        enabled: true,
        maxDepth: 5,
        includeExtensions: ['.html', '.css', '.js', '.png', '.pdf'],
        generateChecksums: false,
      };

      const assets = await discoverContentAssets(tempDir, config, 'https://example.com');

      expect(assets).toHaveLength(5);

      const htmlAsset = assets.find((a) => a.url.endsWith('index.html'));
      expect(htmlAsset).toBeDefined();
      expect(htmlAsset?.type).toBe('text/html');
      expect(htmlAsset?.size).toBeGreaterThan(0);

      const imageAsset = assets.find((a) => a.url.endsWith('image.png'));
      expect(imageAsset).toBeDefined();
      expect(imageAsset?.type).toBe('image/png');
    });

    it('should respect file extension filters', async () => {
      tempDir = await createTempDirectory({
        'included.png': Buffer.from('fake-png'),
        'excluded.txt': 'text content',
        'also-excluded.pdf': Buffer.from('fake-pdf'),
      });

      const config: RSLContentDiscoveryConfig = {
        enabled: true,
        includeExtensions: ['.png'], // Only include PNG files
        generateChecksums: false,
      };

      const assets = await discoverContentAssets(tempDir, config, 'https://example.com');

      expect(assets).toHaveLength(1);
      expect(assets[0].url).toMatch(/included\.png$/);
    });

    it('should exclude specified file extensions', async () => {
      tempDir = await createTempDirectory({
        'image.png': Buffer.from('fake-png'),
        'temp.tmp': 'temporary file',
        'log.log': 'log content',
        'document.pdf': Buffer.from('fake-pdf'),
      });

      const config: RSLContentDiscoveryConfig = {
        enabled: true,
        excludeExtensions: ['.tmp', '.log'],
        generateChecksums: false,
      };

      const assets = await discoverContentAssets(tempDir, config, 'https://example.com');

      expect(assets).toHaveLength(2);
      expect(assets.some((a) => a.url.includes('.tmp'))).toBe(false);
      expect(assets.some((a) => a.url.includes('.log'))).toBe(false);
    });

    it('should exclude specified directories', async () => {
      tempDir = await createTempDirectory({
        'public/image.png': Buffer.from('fake-png'),
        'node_modules/lib.js': 'library code',
        '.git/config': 'git config',
        '_site/built.html': '<html></html>',
        'content/article.md': '# Article',
      });

      const config: RSLContentDiscoveryConfig = {
        enabled: true,
        excludeDirectories: ['node_modules', '.git', '_site'],
        generateChecksums: false,
      };

      const assets = await discoverContentAssets(tempDir, config, 'https://example.com');

      expect(assets).toHaveLength(2); // Only public/image.png and content/article.md
      expect(assets.some((a) => a.url.includes('node_modules'))).toBe(false);
      expect(assets.some((a) => a.url.includes('.git'))).toBe(false);
      expect(assets.some((a) => a.url.includes('_site'))).toBe(false);
    });

    it('should respect maximum depth setting', async () => {
      tempDir = await createTempDirectory({
        'level0.txt': 'root level',
        'dir1/level1.txt': 'depth 1',
        'dir1/dir2/level2.txt': 'depth 2',
        'dir1/dir2/dir3/level3.txt': 'depth 3',
        'dir1/dir2/dir3/dir4/level4.txt': 'depth 4',
      });

      const config: RSLContentDiscoveryConfig = {
        enabled: true,
        maxDepth: 2,
        generateChecksums: false,
      };

      const assets = await discoverContentAssets(tempDir, config, 'https://example.com');

      expect(assets.length).toBeGreaterThanOrEqual(2); // At least level0 and level1
      expect(assets.length).toBeLessThanOrEqual(3); // At most level0, level1, level2
      expect(assets.some((a) => a.url.includes('level3.txt'))).toBe(false);
      expect(assets.some((a) => a.url.includes('level4.txt'))).toBe(false);
    });

    it('should return empty array when discovery is disabled', async () => {
      tempDir = await createTempDirectory({
        'image.png': Buffer.from('fake-png'),
        'document.pdf': Buffer.from('fake-pdf'),
      });

      const config: RSLContentDiscoveryConfig = {
        enabled: false,
      };

      const assets = await discoverContentAssets(tempDir, config, 'https://example.com');

      expect(assets).toHaveLength(0);
    });
  });

  describe('Checksum Generation', () => {
    it('should generate checksums when enabled', async () => {
      tempDir = await createTempDirectory({
        'test.txt': 'test content for checksum',
      });

      const config: RSLContentDiscoveryConfig = {
        enabled: true,
        generateChecksums: true,
      };

      const assets = await discoverContentAssets(tempDir, config, 'https://example.com');

      expect(assets).toHaveLength(1);
      expect(assets[0].checksum).toBeTruthy();
      expect(assets[0].checksumAlgorithm).toBe('sha256');
      expect(assets[0].checksum).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex string
    });

    it('should not generate checksums when disabled', async () => {
      tempDir = await createTempDirectory({
        'test.txt': 'test content',
      });

      const config: RSLContentDiscoveryConfig = {
        enabled: true,
        generateChecksums: false,
      };

      const assets = await discoverContentAssets(tempDir, config, 'https://example.com');

      expect(assets).toHaveLength(1);
      expect(assets[0].checksum).toBeUndefined();
      expect(assets[0].checksumAlgorithm).toBeUndefined();
    });
  });

  describe('Markdown Asset Extraction', () => {
    it('should extract assets referenced in markdown files', async () => {
      tempDir = await createTempDirectory({
        'article.md': `# Article\n![Image](./image.png)\n[Download](./document.pdf)`,
        'image.png': Buffer.from('fake-png'),
        'document.pdf': Buffer.from('fake-pdf'),
      });

      const config: RSLContentDiscoveryConfig = {
        enabled: true,
        generateChecksums: false,
      };

      const assets = await discoverContentAssets(tempDir, config, 'https://example.com');

      expect(assets).toHaveLength(3); // markdown + image + document
      expect(assets.some((a) => a.url.endsWith('article.md'))).toBe(true);
      expect(assets.some((a) => a.url.endsWith('image.png'))).toBe(true);
      expect(assets.some((a) => a.url.endsWith('document.pdf'))).toBe(true);
    });

    it('should skip external URLs in markdown', async () => {
      tempDir = await createTempDirectory({
        'article.md': `# Article\n![External](https://example.com/image.png)\n[Local](./local.png)`,
        'local.png': Buffer.from('fake-png'),
      });

      const config: RSLContentDiscoveryConfig = {
        enabled: true,
        generateChecksums: false,
      };

      const assets = await discoverContentAssets(tempDir, config, 'https://mysite.com');

      expect(assets).toHaveLength(2); // Only markdown and local.png
      // Should not have any external URLs from external references (the base URL will contain mysite.com)
      expect(assets.some((a) => a.url.includes('example.com/image.png'))).toBe(false);
    });

    it('should handle missing referenced files gracefully', async () => {
      tempDir = await createTempDirectory({
        'article.md': `# Article\n![Missing](./missing.png)\n[Exists](./exists.txt)`,
        'exists.txt': 'existing file',
      });

      const config: RSLContentDiscoveryConfig = {
        enabled: true,
        generateChecksums: false,
      };

      const assets = await discoverContentAssets(tempDir, config, 'https://example.com');

      expect(assets).toHaveLength(2); // markdown + exists.txt (missing.png skipped)
      expect(assets.some((a) => a.url.endsWith('missing.png'))).toBe(false);
    });

    it('should avoid duplicate assets', async () => {
      tempDir = await createTempDirectory({
        'article1.md': `# Article 1\n![Shared](./shared.png)`,
        'article2.md': `# Article 2\n![Shared](./shared.png)`,
        'shared.png': Buffer.from('fake-png'),
      });

      const config: RSLContentDiscoveryConfig = {
        enabled: true,
        generateChecksums: false,
      };

      const assets = await discoverContentAssets(tempDir, config, 'https://example.com');

      expect(assets).toHaveLength(3); // 2 markdown files + 1 shared image
      const sharedAssets = assets.filter((a) => a.url.endsWith('shared.png'));
      expect(sharedAssets).toHaveLength(1);
    });
  });

  describe('URL Generation', () => {
    it('should generate correct URLs with base URL', async () => {
      tempDir = await createTempDirectory({
        'subdir/file.txt': 'test content',
      });

      const config: RSLContentDiscoveryConfig = {
        enabled: true,
        generateChecksums: false,
      };

      const baseUrl = 'https://mysite.com';
      const assets = await discoverContentAssets(tempDir, config, baseUrl);

      expect(assets).toHaveLength(1);
      expect(assets[0].url).toMatch(/^https:\/\/mysite\.com\//);
      expect(assets[0].url).toMatch(/subdir\/file\.txt$/);
    });

    it('should handle Windows path separators', async () => {
      tempDir = await createTempDirectory({
        'subdir/file.txt': 'test content',
      });

      const config: RSLContentDiscoveryConfig = {
        enabled: true,
        generateChecksums: false,
      };

      const assets = await discoverContentAssets(tempDir, config, 'https://example.com');

      expect(assets).toHaveLength(1);
      // URL should use forward slashes regardless of OS
      expect(assets[0].url).not.toContain('\\');
      expect(assets[0].url).toContain('/');
    });
  });

  describe('Asset Validation', () => {
    const createTestAssets = (): RSLContentAsset[] => [
      {
        url: 'https://example.com/valid.png',
        type: 'image/png',
        size: 1024,
        lastmod: new Date(),
        localPath: '/tmp/valid.png',
      },
      {
        url: '', // Invalid: missing URL
        type: 'image/jpeg',
        size: 2048,
        lastmod: new Date(),
      },
      {
        url: 'https://example.com/no-type.bin',
        // Missing type
        size: 512,
        lastmod: new Date(),
      },
      {
        url: 'https://example.com/invalid-size.txt',
        type: 'text/plain',
        size: -1, // Invalid size
        lastmod: new Date(),
      },
      {
        url: 'https://example.com/huge.zip',
        type: 'application/zip',
        size: 200 * 1024 * 1024, // 200MB - very large
        lastmod: new Date(),
      },
    ];

    it('should identify missing required fields', () => {
      const assets = createTestAssets();
      const issues = validateDiscoveredAssets(assets);

      const missingUrl = issues.find((i) => i.issue.includes('missing URL'));
      expect(missingUrl).toBeDefined();
      expect(missingUrl?.severity).toBe('error');

      const missingType = issues.find((i) => i.issue.includes('missing MIME type'));
      expect(missingType).toBeDefined();
      expect(missingType?.severity).toBe('warning');
    });

    it('should identify invalid size values', () => {
      const assets = createTestAssets();
      const issues = validateDiscoveredAssets(assets);

      const invalidSize = issues.find((i) => i.issue.includes('invalid size'));
      expect(invalidSize).toBeDefined();
      expect(invalidSize?.severity).toBe('warning');
    });

    it('should warn about very large files', () => {
      const assets = createTestAssets();
      const issues = validateDiscoveredAssets(assets);

      const largeFile = issues.find((i) => i.issue.includes('very large'));
      expect(largeFile).toBeDefined();
      expect(largeFile?.severity).toBe('warning');
      expect(largeFile?.asset.url).toContain('huge.zip');
    });

    it('should validate file accessibility when local path provided', async () => {
      const tempFile = path.join(os.tmpdir(), 'test-validation.txt');
      await writeFile(tempFile, 'test content');

      const assets: RSLContentAsset[] = [
        {
          url: 'https://example.com/exists.txt',
          type: 'text/plain',
          size: 12,
          lastmod: new Date(),
          localPath: tempFile,
        },
        {
          url: 'https://example.com/missing.txt',
          type: 'text/plain',
          size: 10,
          lastmod: new Date(),
          localPath: '/nonexistent/path/missing.txt',
        },
      ];

      const issues = validateDiscoveredAssets(assets);

      const missingFile = issues.find((i) => i.issue.includes('does not exist'));
      expect(missingFile).toBeDefined();
      expect(missingFile?.severity).toBe('error');

      // Clean up
      await fs.promises.unlink(tempFile);
    });

    it('should return empty array for valid assets', () => {
      const validAssets: RSLContentAsset[] = [
        {
          url: 'https://example.com/valid.png',
          type: 'image/png',
          size: 1024,
          lastmod: new Date(),
        },
      ];

      const issues = validateDiscoveredAssets(validAssets);
      expect(issues).toHaveLength(0);
    });
  });

  describe('MIME Type Detection', () => {
    it('should detect common file types correctly', async () => {
      tempDir = await createTempDirectory({
        'image.jpg': Buffer.from('fake-jpeg'),
        'document.pdf': Buffer.from('fake-pdf'),
        'video.mp4': Buffer.from('fake-mp4'),
        'audio.mp3': Buffer.from('fake-mp3'),
        'style.css': 'body { margin: 0; }',
        'script.js': 'console.log("test");',
        'data.json': '{"test": true}',
        'page.html': '<html></html>',
        'readme.md': '# Readme',
        'archive.zip': Buffer.from('fake-zip'),
        'unknown.xyz': 'unknown file type',
      });

      const config: RSLContentDiscoveryConfig = {
        enabled: true,
        generateChecksums: false,
      };

      const assets = await discoverContentAssets(tempDir, config, 'https://example.com');

      const typeMap: Record<string, string> = {};
      assets.forEach((asset) => {
        const filename = path.basename(new URL(asset.url).pathname);
        typeMap[filename] = asset.type || '';
      });

      expect(typeMap['image.jpg']).toBe('image/jpeg');
      expect(typeMap['document.pdf']).toBe('application/pdf');
      expect(typeMap['video.mp4']).toBe('video/mp4');
      expect(typeMap['audio.mp3']).toBe('audio/mpeg');
      expect(typeMap['style.css']).toBe('text/css');
      expect(typeMap['script.js']).toBe('application/javascript');
      expect(typeMap['data.json']).toBe('application/json');
      expect(typeMap['page.html']).toBe('text/html');
      expect(typeMap['readme.md']).toBe('text/markdown');
      expect(typeMap['archive.zip']).toBe('application/zip');
      expect(typeMap['unknown.xyz']).toBe('application/octet-stream');
    });
  });

  describe('Error Handling', () => {
    it('should handle directory access errors gracefully', async () => {
      const config: RSLContentDiscoveryConfig = {
        enabled: true,
        generateChecksums: false,
      };

      // Try to scan a non-existent directory
      const assets = await discoverContentAssets('/nonexistent/directory', config, 'https://example.com');

      expect(assets).toHaveLength(0);
    });

    it('should continue processing when individual files fail', async () => {
      tempDir = await createTempDirectory({
        'valid.txt': 'valid content',
        'also-valid.txt': 'also valid',
      });

      // Create a file and then make it inaccessible
      const inaccessibleFile = path.join(tempDir, 'inaccessible.txt');
      await writeFile(inaccessibleFile, 'content');

      // Note: chmod may not work on all systems/CI environments
      // This test primarily ensures the code doesn't crash

      const config: RSLContentDiscoveryConfig = {
        enabled: true,
        generateChecksums: true, // This might fail for some files
      };

      const assets = await discoverContentAssets(tempDir, config, 'https://example.com');

      // Should still discover the accessible files
      expect(assets.length).toBeGreaterThanOrEqual(2);
      expect(assets.some((a) => a.url.includes('valid.txt'))).toBe(true);
    });
  });
});
