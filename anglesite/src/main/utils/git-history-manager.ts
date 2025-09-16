/**
 * @file Git History Manager for Anglesite Websites
 *
 * Manages git repositories for website projects to maintain version history.
 * Automatically commits changes on save and close events with human-readable timestamps.
 */

import simpleGit, { SimpleGit, LogResult, DefaultLogFields, LogOptions } from 'simple-git';
import { format } from 'date-fns';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ILogger } from '../core/interfaces';

export interface GitCommitInfo {
  hash: string;
  date: Date;
  message: string;
  body: string;
  author: {
    name: string;
    email: string;
  };
}

export interface GitHistoryOptions {
  limit?: number;
  from?: string;
  to?: string;
}

/**
 * Service for managing git history in website projects.
 * Provides automatic versioning with linear history only (no branching).
 */
export class GitHistoryManager {
  private readonly logger: ILogger;
  private readonly gitInstances: Map<string, SimpleGit> = new Map();
  private readonly pendingCommits: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly DEBOUNCE_DELAY = 5000; // 5 seconds debounce for saves

  constructor(logger: ILogger) {
    this.logger = logger.child({ service: 'GitHistoryManager' });
  }

  /**
   * Get or create a git instance for a website path.
   */
  private getGitInstance(websitePath: string): SimpleGit {
    if (!this.gitInstances.has(websitePath)) {
      const git = simpleGit(websitePath);
      git.outputHandler((command, stdout, stderr) => {
        stdout.on('data', (data) => {
          this.logger.debug('Git stdout', { command, data: data.toString() });
        });
        stderr.on('data', (data) => {
          this.logger.debug('Git stderr', { command, data: data.toString() });
        });
      });
      this.gitInstances.set(websitePath, git);
    }
    return this.gitInstances.get(websitePath)!;
  }

  /**
   * Initialize a git repository for a website if not already initialized.
   */
  async initRepository(websitePath: string): Promise<void> {
    this.logger.info('Initializing git repository', { websitePath });

    try {
      const git = this.getGitInstance(websitePath);

      // Check if already a git repository
      let isRepo = false;
      try {
        isRepo = await git.checkIsRepo();
      } catch {
        // checkIsRepo can fail if not in a git directory - that's expected
        this.logger.debug('Not a git repository yet', { websitePath });
        isRepo = false;
      }

      if (isRepo) {
        this.logger.debug('Repository already exists', { websitePath });
        return;
      }

      this.logger.debug('Initializing new git repository', { websitePath });

      // Initialize repository
      await git.init();
      this.logger.debug('Git init completed', { websitePath });

      // Create .gitignore if it doesn't exist
      await this.createGitignore(websitePath);
      this.logger.debug('Created .gitignore file', { websitePath });

      // Configure git user for this repository
      await git.addConfig('user.name', 'Anglesite');
      await git.addConfig('user.email', 'anglesite@localhost');
      this.logger.debug('Configured git user', { websitePath });

      // Make initial commit
      await git.add('.');
      this.logger.debug('Added files to git staging', { websitePath });

      const timestamp = format(new Date(), "MMMM d, yyyy 'at' h:mm a");
      await git.commit(`Initial commit: ${timestamp}`);
      this.logger.debug('Created initial commit', { websitePath });

      // Verify repository was created successfully
      const finalCheck = await git.checkIsRepo();
      if (!finalCheck) {
        throw new Error('Git repository initialization verification failed');
      }

      this.logger.info('Git repository initialized successfully', { websitePath });
    } catch (error) {
      this.logger.error(
        'Failed to initialize git repository',
        error instanceof Error ? error : new Error(String(error)),
        {
          websitePath,
        }
      );
      throw error;
    }
  }

  /**
   * Create a .gitignore file for the website.
   */
  private async createGitignore(websitePath: string): Promise<void> {
    const gitignorePath = path.join(websitePath, '.gitignore');

    try {
      await fs.access(gitignorePath);
      this.logger.debug('.gitignore already exists', { websitePath });
    } catch {
      // File doesn't exist, create it
      const gitignoreContent = `# Build output
_site/
_dist/
dist/
build/
out/
.cache/

# Dependencies
node_modules/
bower_components/

# IDE and editor files
.vscode/
.idea/
*.sublime-*
*.swp
*.swo
*~
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment files
.env
.env.local
.env.*.local

# Temporary files
*.tmp
.temp/
tmp/
temp/

# Coverage
coverage/
.nyc_output/

# Anglesite specific
.anglesite-cache/
.anglesite-temp/
`;

      await fs.writeFile(gitignorePath, gitignoreContent, 'utf-8');
      this.logger.debug('Created .gitignore file', { websitePath });
    }
  }

  /**
   * Automatically commit changes with a debounced save.
   */
  async autoCommit(websitePath: string, action: 'save' | 'close'): Promise<void> {
    this.logger.debug('Auto-commit requested', { websitePath, action });

    // Cancel any pending commit for this website
    const pendingCommit = this.pendingCommits.get(websitePath);
    if (pendingCommit) {
      clearTimeout(pendingCommit);
      this.pendingCommits.delete(websitePath);
    }

    if (action === 'save') {
      // Debounce saves to avoid too many commits
      const timeout = setTimeout(async () => {
        await this.performCommit(websitePath, 'save');
        this.pendingCommits.delete(websitePath);
      }, this.DEBOUNCE_DELAY);

      this.pendingCommits.set(websitePath, timeout);
    } else {
      // Immediate commit on close
      await this.performCommit(websitePath, 'close');
    }
  }

  /**
   * Perform the actual git commit.
   */
  private async performCommit(websitePath: string, action: string): Promise<void> {
    try {
      const git = this.getGitInstance(websitePath);

      // Check if this is a git repository first
      let isRepo = false;
      try {
        isRepo = await git.checkIsRepo();
      } catch {
        this.logger.debug('Not a git repository, attempting to initialize', { websitePath });
        await this.initRepository(websitePath);
        isRepo = true;
      }

      if (!isRepo) {
        this.logger.warn('Cannot commit: not a git repository', { websitePath });
        return;
      }

      // Check if there are any changes to commit
      const status = await git.status();
      if (status.files.length === 0) {
        this.logger.debug('No changes to commit', { websitePath });
        return;
      }

      // Stage all changes
      await git.add('.');

      // Create commit message with human-readable timestamp
      const timestamp = format(new Date(), "MMMM d, yyyy 'at' h:mm a");
      const message = `${action}: ${timestamp}`;

      // Commit changes
      await git.commit(message);

      this.logger.info('Changes committed successfully', { websitePath, message });
    } catch (error) {
      this.logger.error('Failed to commit changes', error instanceof Error ? error : new Error(String(error)), {
        websitePath,
        action,
      });
      // Don't throw - we don't want to interrupt the user's workflow
    }
  }

  /**
   * Get the git history for a website.
   */
  async getHistory(websitePath: string, options: GitHistoryOptions = {}): Promise<GitCommitInfo[]> {
    this.logger.debug('Getting git history', { websitePath, options });

    try {
      const git = this.getGitInstance(websitePath);

      const logOptions: LogOptions = {
        maxCount: options.limit || 100,
      };

      if (options.from) {
        logOptions.from = options.from;
      }
      if (options.to) {
        logOptions.to = options.to;
      }

      const log: LogResult<DefaultLogFields> = await git.log(logOptions);

      return log.all.map((commit) => ({
        hash: commit.hash,
        date: new Date(commit.date),
        message: commit.message,
        body: commit.body || '',
        author: {
          name: commit.author_name || 'Unknown',
          email: commit.author_email || 'unknown@localhost',
        },
      }));
    } catch (error) {
      this.logger.error('Failed to get git history', error instanceof Error ? error : new Error(String(error)), {
        websitePath,
      });
      throw error;
    }
  }

  /**
   * Roll back to a specific commit.
   */
  async rollback(websitePath: string, commitHash: string): Promise<void> {
    this.logger.info('Rolling back to commit', { websitePath, commitHash });

    try {
      const git = this.getGitInstance(websitePath);

      // Check for uncommitted changes
      const status = await git.status();
      if (status.files.length > 0) {
        // Commit current changes before rollback
        await this.performCommit(websitePath, 'save before rollback');
      }

      // Reset to the specified commit (keeping changes as uncommitted)
      await git.reset(['--hard', commitHash]);

      this.logger.info('Successfully rolled back to commit', { websitePath, commitHash });
    } catch (error) {
      this.logger.error('Failed to rollback', error instanceof Error ? error : new Error(String(error)), {
        websitePath,
        commitHash,
      });
      throw error;
    }
  }

  /**
   * Get the current commit hash.
   */
  async getCurrentCommit(websitePath: string): Promise<string | null> {
    try {
      const git = this.getGitInstance(websitePath);
      const log = await git.log({ maxCount: 1 });
      return log.latest ? log.latest.hash : null;
    } catch (error) {
      this.logger.error('Failed to get current commit', error instanceof Error ? error : new Error(String(error)), {
        websitePath,
      });
      return null;
    }
  }

  /**
   * Clean up resources for a specific website.
   */
  disposeWebsite(websitePath: string): void {
    // Cancel any pending commits
    const pendingCommit = this.pendingCommits.get(websitePath);
    if (pendingCommit) {
      clearTimeout(pendingCommit);
      this.pendingCommits.delete(websitePath);
    }

    // Remove git instance
    this.gitInstances.delete(websitePath);

    this.logger.debug('Disposed git history manager for website', { websitePath });
  }

  /**
   * IDisposable implementation - clean up all resources.
   */
  dispose(): void {
    this.disposeAll();
  }

  /**
   * Clean up all resources.
   */
  disposeAll(): void {
    // Clear all pending commits
    for (const timeout of this.pendingCommits.values()) {
      clearTimeout(timeout);
    }
    this.pendingCommits.clear();

    // Clear all git instances
    this.gitInstances.clear();

    this.logger.debug('Disposed all git history managers');
  }
}
