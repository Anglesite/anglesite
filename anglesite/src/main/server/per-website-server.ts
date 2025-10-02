/**
 * @file Per-website Eleventy server management using programmatic API.
 */
import * as path from 'path';
import * as fs from 'fs';
import { EleventyUrlResolver } from './eleventy-url-resolver';
import { logger, sanitize } from '../utils/logging';
// Dynamic imports for 11ty to avoid loading at module initialization
// import Eleventy from '@11ty/eleventy';
// import EleventyDevServer from '@11ty/eleventy-dev-server';
import { EnhancedFileWatcher, createEnhancedFileWatcher, FileChangeInfo } from './enhanced-file-watcher';

/**
 * Log message callback type for layer boundary communication.
 * Instead of directly importing UI layer, we accept a callback.
 */
type LogCallback = (websiteName: string, message: string, level: string) => void;

/**
 * Global log callback set by the orchestrator layer.
 * This allows the server layer to send logs without knowing about the UI layer.
 */
let logCallback: LogCallback | null = null;

/**
 * Set the log callback for this server instance.
 * Called by the orchestrator layer to establish communication.
 */
export function setServerLogCallback(callback: LogCallback | null): void {
  logCallback = callback;
}

/**
 * Send log message through the callback (no direct UI dependency).
 */
function sendLogToWindow(websiteName: string, message: string, level: string = 'info') {
  if (logCallback) {
    try {
      logCallback(websiteName, message, level);
    } catch (error) {
      // Silently fail if callback errors
      logger.debug(`Log callback failed for ${websiteName}`, {
        error: sanitize.error(error),
      });
    }
  }
}

/**
 * Server instance for a single website using programmatic API.
 */
export interface WebsiteServer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eleventy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  devServer: any;
  inputDir: string;
  outputDir: string;
  port: number;
  actualUrl?: string;
  urlResolver: EleventyUrlResolver;
  restoreConsole?: () => void;
  enhancedWatcher?: EnhancedFileWatcher;
}

/**
 * Start an Eleventy server for a specific website using programmatic API.
 */
export async function startWebsiteServer(inputDir: string, websiteName: string, port: number): Promise<WebsiteServer> {
  sendLogToWindow(websiteName, `🚀 Starting Eleventy server for ${websiteName}`, 'startup');
  sendLogToWindow(websiteName, `📁 Input directory: ${sanitize.path(inputDir)}`, 'debug');

  // Capture console output during Eleventy operations
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  // Function to restore original console methods
  const restoreConsole = () => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  };

  try {
    // Set up output directory for this website - use _site within the website directory
    const outputDir = path.join(inputDir, '_site');

    sendLogToWindow(websiteName, `📂 Setting up build directory…`, 'info');
    sendLogToWindow(websiteName, `📍 Output: ${outputDir}`, 'debug');

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      sendLogToWindow(websiteName, `✅ Created output directory`, 'info');
    }

    sendLogToWindow(websiteName, `⚙️ Loading Eleventy configuration…`, 'info');

    // Override console methods to capture Eleventy output
    console.log = (...args: unknown[]) => {
      const message = args.join(' ');
      // Check if this is an Eleventy log message
      if (message.includes('[11ty]') || message.includes('Eleventy') || message.includes('eleventy')) {
        sendLogToWindow(websiteName, message, 'info');
      }
      // Always call original console.log for debugging
      originalConsoleLog(...args);
    };

    console.error = (...args: unknown[]) => {
      const message = args.join(' ');
      // Check if this is an Eleventy error message
      if (message.includes('[11ty]') || message.includes('Eleventy') || message.includes('eleventy')) {
        sendLogToWindow(websiteName, message, 'error');
      }
      // Always call original console.error for debugging
      originalConsoleError(...args);
    };

    console.warn = (...args: unknown[]) => {
      const message = args.join(' ');
      // Check if this is an Eleventy warning message
      if (message.includes('[11ty]') || message.includes('Eleventy') || message.includes('eleventy')) {
        sendLogToWindow(websiteName, message, 'warning');
      }
      // Always call original console.warn for debugging
      originalConsoleWarn(...args);
    };

    // Create Eleventy instance with programmatic API
    // Don't try to load the config here - let Eleventy handle it internally
    // This allows Eleventy to properly resolve modules from the website's node_modules

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eleventyOptions: any = {
      quietMode: false,
    };

    // Use programmatic configuration instead of config file to avoid path resolution issues
    sendLogToWindow(websiteName, `📋 Using programmatic configuration (ignoring eleventy.config.js)`, 'debug');

    sendLogToWindow(websiteName, `📂 Input: ${inputDir}/src, Output: ${outputDir}`, 'debug');

    // Verify src directory exists before starting Eleventy
    const srcPath = path.join(inputDir, 'src');
    if (!fs.existsSync(srcPath)) {
      const errorMsg = `Source directory does not exist: ${srcPath}`;
      sendLogToWindow(websiteName, `❌ ${errorMsg}`, 'error');
      throw new Error(errorMsg);
    }
    sendLogToWindow(websiteName, `✅ Source directory verified: ${srcPath}`, 'debug');

    // Create Eleventy instance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let eleventy: any;

    // Create Eleventy instance with absolute paths and programmatic configuration
    const srcAbsolutePath = path.join(inputDir, 'src');
    sendLogToWindow(websiteName, `🔧 Using absolute input path: ${srcAbsolutePath}`, 'debug');
    sendLogToWindow(websiteName, `🔧 Using absolute output path: ${outputDir}`, 'debug');

    // Add configuration callback to options (proper Eleventy API)
    const eleventyOptionsWithConfig = {
      ...eleventyOptions,
      // Disable auto-discovery of config files (.eleventy.js, etc.) to prevent
      // Eleventy v3 from trying to require() user config files with ESM syntax
      configPath: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: async function (eleventyConfig: any) {
        // Import and add the anglesite-11ty plugin using dynamic import
        // Dynamic import is required because @dwk/anglesite-11ty is an ESM module
        let anglesiteEleventy;
        if (process.env.NODE_ENV === 'test') {
          anglesiteEleventy = (await import('@dwk/anglesite-11ty')).default;
        } else {
          // Use Function constructor to prevent TypeScript from transforming to require()
          const dynamicImport = new Function('specifier', 'return import(specifier)');
          anglesiteEleventy = (await dynamicImport('@dwk/anglesite-11ty')).default;
        }

        // FIXME: Workaround for eleventy-plugin-webc issue
        eleventyConfig.setFreezeReservedData(false);

        // Add anglesite-11ty plugin with WebC configuration
        eleventyConfig.addPlugin(anglesiteEleventy, {
          // Don't skip WebC here since we want the anglesite-11ty package to handle it
          webComponents: '_includes/**/*.webc', // This will be relative to srcAbsolutePath
        });

        // Add global data
        eleventyConfig.addGlobalData('eleventy', () => ({
          generator: process.env.ELEVENTY_VERSION ? `Eleventy v${process.env.ELEVENTY_VERSION}` : 'Eleventy',
        }));

        // Return directory configuration (these paths are relative to the input directory)
        return {
          templateFormats: ['11ty.js', 'webc', 'md', 'html'],
          markdownTemplateEngine: 'webc',
          htmlTemplateEngine: 'webc',
          dir: {
            // All paths are relative to srcAbsolutePath since that's our input
            input: '.', // Current directory (srcAbsolutePath)
            output: '../_site', // Relative to srcAbsolutePath, points to outputDir
            includes: '_includes',
            layouts: '_includes',
          },
        };
      },
    };

    // Temporarily rename config files to prevent Eleventy from auto-discovering them
    // This is necessary because Eleventy v3 will try to require() ESM config files,
    // which causes an error even though we're using programmatic configuration
    const websiteRoot = inputDir; // Parent of src/
    const configFiles = [
      'eleventy.config.js',
      'eleventy.config.cjs',
      'eleventy.config.mjs',
      '.eleventy.js',
      '.eleventy.cjs',
      '.eleventy.mjs',
    ];

    const renamedConfigs: Array<{ from: string; to: string }> = [];

    try {
      // Rename any existing config files temporarily
      for (const configFile of configFiles) {
        const configPath = path.join(websiteRoot, configFile);
        if (fs.existsSync(configPath)) {
          const tempPath = `${configPath}.anglesite-temp`;
          sendLogToWindow(websiteName, `🔧 Temporarily hiding ${configFile} to use programmatic config`, 'debug');
          fs.renameSync(configPath, tempPath);
          renamedConfigs.push({ from: configPath, to: tempPath });
        }
      }

      // Dynamically import Eleventy to avoid loading at module initialization
      sendLogToWindow(websiteName, `📦 Loading Eleventy module...`, 'debug');

      // Use Function constructor to create true dynamic import that TypeScript can't transform to require()
      // This is necessary because TypeScript with module:"commonjs" transforms await import() to require()
      // In test environment, jest.mock handles the module, so we can use a simpler approach
      let Eleventy;
      if (process.env.NODE_ENV === 'test') {
        // In test environment, use require which is already mocked by Jest
        Eleventy = (await import('@11ty/eleventy')).default;
      } else {
        // In production, use Function constructor to prevent TypeScript transformation
        const dynamicImport = new Function('specifier', 'return import(specifier)');
        Eleventy = (await dynamicImport('@11ty/eleventy')).default;
      }

      eleventy = new Eleventy(srcAbsolutePath, outputDir, eleventyOptionsWithConfig);
    } finally {
      // Restore any renamed config files
      for (const { from, to } of renamedConfigs) {
        try {
          if (fs.existsSync(to)) {
            fs.renameSync(to, from);
            sendLogToWindow(websiteName, `✅ Restored ${path.basename(from)}`, 'debug');
          }
        } catch (restoreError) {
          logger.error(`Failed to restore config file`, {
            error: sanitize.error(restoreError),
            from: sanitize.path(from),
            to: sanitize.path(to),
          });
        }
      }
    }

    try {
      // Initial build
      sendLogToWindow(websiteName, `🔨 Building website files…`, 'info');

      try {
        await eleventy.write();
        sendLogToWindow(websiteName, `✅ Build completed successfully`, 'info');
      } catch (buildError) {
        const sanitizedError = sanitize.error(buildError);
        logger.error(`Build failed for ${websiteName}`, {
          error: sanitizedError,
          websiteName,
        });

        if (buildError instanceof Error) {
          // Send sanitized error to window
          sendLogToWindow(websiteName, `❌ Build failed: ${sanitize.error(buildError.message)}`, 'error');

          // Check for nested error details in Eleventy errors
          if ('originalError' in buildError && buildError.originalError) {
            const sanitizedOriginal = sanitize.error(buildError.originalError);
            logger.error(`Original build error for ${websiteName}`, {
              originalError: sanitizedOriginal,
            });
            sendLogToWindow(websiteName, `📋 Original error: ${sanitizedOriginal}`, 'error');

            if (buildError.originalError instanceof Error) {
              const sanitizedOriginalMessage = sanitize.error(buildError.originalError.message);
              sendLogToWindow(websiteName, `🔍 Detailed error: ${sanitizedOriginalMessage}`, 'error');
            }
          }

          // Check for cause property (modern error chaining)
          if ('cause' in buildError && buildError.cause) {
            const sanitizedCause = sanitize.error(buildError.cause);
            logger.error(`Build error cause for ${websiteName}`, {
              cause: sanitizedCause,
            });
            sendLogToWindow(websiteName, `⚡ Error cause: ${sanitizedCause}`, 'error');
          }
        } else {
          sendLogToWindow(websiteName, `❌ Build failed: ${sanitizedError}`, 'error');
        }
        throw buildError;
      }

      // Track the actual server URL
      let actualServerUrl = '';

      // Dynamically import EleventyDevServer
      sendLogToWindow(websiteName, `📦 Loading Eleventy Dev Server module...`, 'debug');
      let EleventyDevServer;
      if (process.env.NODE_ENV === 'test') {
        EleventyDevServer = (await import('@11ty/eleventy-dev-server')).default;
      } else {
        const dynamicImport = new Function('specifier', 'return import(specifier)');
        EleventyDevServer = (await dynamicImport('@11ty/eleventy-dev-server')).default;
      }

      // Create dev server instance
      const devServer = new EleventyDevServer(websiteName, outputDir, {
        port: port,
        liveReload: true,
        domDiff: true,
        showVersion: false,
        watch: [inputDir + '/**/*'],
        ignore: [path.join(inputDir, '_site') + '/**/*'],
        logger: {
          log: (msg: string) => {
            console.log(`[${websiteName}] ${msg}`);
            // Capture actual server URL from logs
            const serverUrlMatch = msg.match(/Server at (http:\/\/localhost:\d+)\/?/);
            if (serverUrlMatch) {
              actualServerUrl = serverUrlMatch[1]; // Already clean, no trailing slash needed
            }
            sendLogToWindow(websiteName, msg, 'info');
          },
          info: (msg: string) => {
            console.log(`[${websiteName}] ${msg}`);
            // Also check info messages for server URL
            const serverUrlMatch = msg.match(/Server at (http:\/\/localhost:\d+)\/?/);
            if (serverUrlMatch) {
              actualServerUrl = serverUrlMatch[1];
            }
            sendLogToWindow(websiteName, msg, 'info');
          },
          error: (msg: string) => {
            console.error(`[${websiteName}] ${msg}`);
            sendLogToWindow(websiteName, msg, 'error');
          },
        },
      });

      // Set up enhanced file watching with incremental compilation
      const enhancedWatcher = createEnhancedFileWatcher(
        async (changedFiles: FileChangeInfo[]) => {
          // Enhanced rebuild callback with batched changes
          const relativePaths = changedFiles.map((f) => f.relativePath).join(', ');
          sendLogToWindow(websiteName, `📝 Files changed: ${relativePaths}`, 'info');
          sendLogToWindow(websiteName, `🔄 Rebuilding website…`, 'info');

          const rebuildStart = Date.now();
          try {
            // Use incremental compilation for better performance
            await eleventy.write();

            const rebuildTime = Date.now() - rebuildStart;
            sendLogToWindow(websiteName, `✅ Rebuild completed in ${rebuildTime}ms`, 'info');

            // Log performance metrics every 10 rebuilds
            const metrics = enhancedWatcher.getMetrics();
            if (metrics.totalRebuilds % 10 === 0) {
              sendLogToWindow(
                websiteName,
                `📊 Performance: ${metrics.totalRebuilds} rebuilds, avg ${Math.round(metrics.averageRebuildTime)}ms`,
                'debug'
              );
            }
          } catch (error) {
            const sanitizedError = sanitize.error(error);
            logger.error(`Rebuild failed for ${websiteName}`, {
              error: sanitizedError,
              websiteName,
            });
            sendLogToWindow(websiteName, `❌ Rebuild failed: ${sanitizedError}`, 'error');
          }
        },
        {
          inputDir,
          outputDir: outputDir,
          debounceMs: 300, // 300ms debounce for responsive rebuilds
          maxBatchSize: 25, // Process up to 25 changes at once
          enableMetrics: true,
          priorityExtensions: ['.md', '.html', '.css', '.js', '.ts', '.json', '.njk', '.liquid'],
        }
      );

      // Set up file watching based on environment
      if (process.env.NODE_ENV !== 'test') {
        // Production mode: disable default dev server watching since we use enhanced watcher
        devServer.watchFiles = () => {}; // Override to prevent default watching
      } else {
        // Test mode: use legacy dev server file watching for test compatibility
        const watchPattern = inputDir + '/**/*';
        const buildDir = path.join(inputDir, '_site');
        devServer.watchFiles([watchPattern]);

        // Set up the old file change handler for tests
        if (devServer.watcher) {
          devServer.watcher.on('change', async (changedPath: string) => {
            // Skip if the changed file is in the build directory (prevent recursive builds)
            if (changedPath.startsWith(buildDir)) {
              sendLogToWindow(websiteName, `🔄 Skipping build directory change: ${changedPath}`, 'debug');
              return;
            }

            sendLogToWindow(websiteName, `📝 File changed: ${changedPath}`, 'info');
            sendLogToWindow(websiteName, `🔄 Rebuilding website…`, 'info');
            try {
              await eleventy.write();
              sendLogToWindow(websiteName, `✅ Rebuild completed successfully`, 'info');
            } catch (error) {
              const sanitizedError = sanitize.error(error);
              logger.error(`Rebuild failed for ${websiteName}`, {
                error: sanitizedError,
                websiteName,
              });
              sendLogToWindow(websiteName, `❌ Rebuild failed: ${sanitizedError}`, 'error');
            }
          });
        }
      }

      // Start the dev server
      sendLogToWindow(websiteName, `🌐 Starting development server on port ${port}…`, 'info');

      devServer.serve(port);

      // Wait a moment for the server URL to be captured from logs
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Use captured URL if available, otherwise fall back to expected port
      const finalServerUrl = actualServerUrl || `http://localhost:${port}`;
      const actualPort = actualServerUrl ? parseInt(actualServerUrl.split(':')[2]) : port;

      sendLogToWindow(websiteName, `🎉 Server ready at ${finalServerUrl}`, 'info');

      // Initialize URL resolver for file-to-URL mapping
      sendLogToWindow(websiteName, `🗺️ Setting up file-to-URL mapping…`, 'info');
      const urlResolver = new EleventyUrlResolver(path.join(inputDir, 'src'));
      await urlResolver.initialize();
      sendLogToWindow(websiteName, `✅ URL resolver ready`, 'info');

      // Start enhanced file watching (skip in test environment)
      if (process.env.NODE_ENV !== 'test') {
        sendLogToWindow(websiteName, `👀 Starting enhanced file watching…`, 'info');
        await enhancedWatcher.start();
        sendLogToWindow(websiteName, `✅ Enhanced file watching active with smart debouncing`, 'info');
      } else {
        sendLogToWindow(websiteName, `👀 Using legacy file watching for test environment`, 'debug');
      }

      return {
        eleventy,
        devServer,
        inputDir: path.join(inputDir, 'src'),
        outputDir,
        port: actualPort,
        actualUrl: finalServerUrl,
        urlResolver,
        restoreConsole,
        enhancedWatcher,
      };
    } finally {
      // No need to restore working directory since we're using absolute paths
    }
  } catch (error) {
    // Restore console methods in case of error
    restoreConsole();
    const sanitizedError = sanitize.error(error);
    logger.error(`Failed to start server for ${websiteName}`, {
      error: sanitizedError,
      websiteName,
    });
    sendLogToWindow(websiteName, `❌ Failed to start server: ${sanitizedError}`, 'error');
    throw error;
  }
}

/**
 * Stop a website server.
 */
export async function stopWebsiteServer(server: WebsiteServer): Promise<void> {
  try {
    // Restore original console methods if available
    if (server.restoreConsole) {
      server.restoreConsole();
    }

    // Stop the enhanced file watcher first to prevent fsevents crashes
    // Enhanced with timeout protection to prevent race condition with Node.js module cleanup
    if (server.enhancedWatcher && process.env.NODE_ENV !== 'test') {
      try {
        logger.info(`Stopping enhanced file watcher for port ${server.port}...`);

        // Add timeout protection for file watcher cleanup to prevent fsevents race condition
        await Promise.race([
          server.enhancedWatcher.stop(),
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error('Enhanced file watcher stop timeout - preventing fsevents deadlock'));
            }, 2500); // 2.5 second timeout for individual watcher cleanup
          }),
        ]);

        logger.info(`Enhanced file watcher stopped successfully for port ${server.port}`);
      } catch (watcherError) {
        logger.error(`Error stopping enhanced file watcher for port ${server.port} (continuing with server shutdown)`, {
          error: sanitize.error(watcherError),
          port: server.port,
        });
        // Continue with cleanup even if watcher fails to stop properly
        // This prevents the entire shutdown from hanging on one problematic watcher
      }
    }

    // Stop the legacy file watcher if it exists
    if (server.devServer && server.devServer.watcher) {
      try {
        logger.info(`Stopping legacy file watcher for port ${server.port}...`);

        // Add timeout protection for legacy watcher cleanup too
        await Promise.race([
          server.devServer.watcher.close(),
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error('Legacy file watcher close timeout - preventing fsevents deadlock'));
            }, 2000); // 2 second timeout for legacy watcher cleanup
          }),
        ]);

        logger.info(`Legacy file watcher stopped successfully for port ${server.port}`);
      } catch (watcherError) {
        logger.error(`Error closing legacy file watcher for port ${server.port} (continuing with server shutdown)`, {
          error: sanitize.error(watcherError),
          port: server.port,
        });
        // Continue with cleanup even if legacy watcher fails
      }
    }

    // Stop the dev server
    if (server.devServer && typeof server.devServer.close === 'function') {
      try {
        await server.devServer.close();
      } catch (closeError) {
        logger.error(`Error closing dev server for port ${server.port}`, {
          error: sanitize.error(closeError),
          port: server.port,
        });
      }
    }

    // Clean up temporary output directory
    if (fs.existsSync(server.outputDir)) {
      try {
        fs.rmSync(server.outputDir, { recursive: true, force: true });
      } catch (cleanupError) {
        logger.error(`Failed to clean up directory`, {
          error: sanitize.error(cleanupError),
          directory: sanitize.path(server.outputDir),
        });
      }
    }
  } catch (error) {
    logger.error(`Error stopping server for port ${server.port}`, {
      error: sanitize.error(error),
      port: server.port,
    });
  }
}
