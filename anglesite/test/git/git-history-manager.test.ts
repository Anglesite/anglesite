/**
 * @file Tests for GitHistoryManager
 */
import { GitHistoryManager } from '../../src/main/utils/git-history-manager';
import { Logger } from '../../src/main/core/service-registry';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('GitHistoryManager', () => {
  let gitHistoryManager: GitHistoryManager;
  let testDir: string;

  beforeEach(async () => {
    const logger = new Logger('test');
    gitHistoryManager = new GitHistoryManager(logger);
    
    // Create temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-history-test-'));
  });

  afterEach(async () => {
    // Clean up test directory
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
    
    // Clean up git history manager resources
    gitHistoryManager.dispose();
  });

  describe('Repository Initialization', () => {
    it('should initialize a git repository', async () => {
      await gitHistoryManager.initRepository(testDir);
      
      // Check if .git directory was created
      const gitDir = path.join(testDir, '.git');
      const stats = await fs.stat(gitDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should create a .gitignore file', async () => {
      await gitHistoryManager.initRepository(testDir);
      
      // Check if .gitignore was created
      const gitignorePath = path.join(testDir, '.gitignore');
      const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
      
      expect(gitignoreContent).toContain('node_modules/');
      expect(gitignoreContent).toContain('_site/');
      expect(gitignoreContent).toContain('.DS_Store');
    });

    it('should not fail when initializing an existing repository', async () => {
      // Initialize twice - should not throw
      await gitHistoryManager.initRepository(testDir);
      await expect(gitHistoryManager.initRepository(testDir)).resolves.not.toThrow();
    });
  });

  describe('Auto-commit functionality', () => {
    beforeEach(async () => {
      await gitHistoryManager.initRepository(testDir);
      
      // Create a test file
      const testFile = path.join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'initial content');
    });

    it('should commit changes on save with debouncing', async () => {
      // Make a change
      const testFile = path.join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'modified content');
      
      // Trigger save auto-commit
      await gitHistoryManager.autoCommit(testDir, 'save');
      
      // Wait for debounced commit to complete
      await new Promise(resolve => setTimeout(resolve, 6000));
      
      // Check history
      const history = await gitHistoryManager.getHistory(testDir, { limit: 2 });
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].message).toContain('save:');
    }, 10000);

    it('should commit changes immediately on close', async () => {
      // Make a change
      const testFile = path.join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'modified for close');
      
      // Trigger close auto-commit
      await gitHistoryManager.autoCommit(testDir, 'close');
      
      // Check history immediately (no debouncing for close)
      const history = await gitHistoryManager.getHistory(testDir, { limit: 2 });
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].message).toContain('close:');
    });
  });

  describe('History retrieval', () => {
    beforeEach(async () => {
      await gitHistoryManager.initRepository(testDir);
      
      // Create multiple commits
      for (let i = 1; i <= 3; i++) {
        const testFile = path.join(testDir, `test${i}.txt`);
        await fs.writeFile(testFile, `content ${i}`);
        await gitHistoryManager.autoCommit(testDir, 'close');
        // Small delay between commits
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    });

    it('should retrieve commit history', async () => {
      const history = await gitHistoryManager.getHistory(testDir);
      
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0]).toHaveProperty('hash');
      expect(history[0]).toHaveProperty('date');
      expect(history[0]).toHaveProperty('message');
      expect(history[0]).toHaveProperty('author');
    });

    it('should limit history results', async () => {
      const history = await gitHistoryManager.getHistory(testDir, { limit: 2 });
      
      expect(history.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Resource management', () => {
    it('should clean up resources for a specific website', async () => {
      await gitHistoryManager.initRepository(testDir);
      
      // Trigger some activity to create resources
      await gitHistoryManager.autoCommit(testDir, 'save');
      
      // Clean up resources for this website
      gitHistoryManager.disposeWebsite(testDir);
      
      // Should not throw
      expect(() => gitHistoryManager.disposeWebsite(testDir)).not.toThrow();
    });

    it('should clean up all resources on dispose', async () => {
      await gitHistoryManager.initRepository(testDir);
      
      // Clean up all resources
      gitHistoryManager.dispose();
      
      // Should not throw
      expect(() => gitHistoryManager.dispose()).not.toThrow();
    });
  });
});