/**
 * @file Preload script for the Electron application.
 * @see {@link https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts}
 */
import { contextBridge, ipcRenderer, shell, clipboard } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel: string, ...args: unknown[]) => {
    // Whitelist channels for security
    const validChannels = [
      'new-website',
      'open-website',
      'preview',
      'open-browser',
      'reload-preview',
      'toggle-devtools',
      'hide-preview',
      'export-site',
      'create-website-with-name',
      'renderer-loaded',
      'input-dialog-result',
      'show-website-context-menu',
      'delete-website',
      'open-website-selection',
      'website-editor-show-preview',
      'website-editor-show-edit',
      'load-file-preview',
      'bagit-metadata-result',
      'get-bagit-metadata-defaults',
      'first-launch-result',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },
  invoke: (channel: string, ...args: unknown[]) => {
    // Whitelist invoke channels for security
    const validChannels = [
      'list-websites',
      'validate-website-name',
      'rename-website',
      'get-current-theme',
      'set-theme',
      'load-website-files',
      'start-website-dev-server',
      'get-website-files',
      'get-file-content',
      'save-file-content',
      'get-file-url',
      'get-website-server-url',
      'load-website-preview',
    ];
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error(`Invalid invoke channel: ${channel}`));
  },
  on: (channel: string, func: (...args: unknown[]) => void) => {
    // Whitelist channels for security
    const validChannels = [
      'preview-loaded',
      'preview-error',
      'menu-new-website',
      'menu-reload',
      'menu-toggle-devtools',
      'menu-export-site',
      'show-website-name-input',
      'website-context-menu-action',
      'website-operation-completed',
      'theme-updated',
      'trigger-new-website',
      'load-website',
      'bagit-metadata-defaults',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => {
        func(...args);
      });
    }
  },
  once: (channel: string, func: (...args: unknown[]) => void) => {
    // Whitelist channels for security
    const validChannels = ['bagit-metadata-defaults', 'theme-updated'];
    if (validChannels.includes(channel)) {
      ipcRenderer.once(channel, (_event, ...args) => {
        func(...args);
      });
    }
  },
  removeAllListeners: (channel: string) => {
    const validChannels = ['preview-loaded', 'preview-error'];
    if (validChannels.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },

  // Theme API methods
  getCurrentTheme: () => ipcRenderer.invoke('get-current-theme'),
  setTheme: (theme: string) => ipcRenderer.invoke('set-theme', theme),
  onThemeUpdated: (callback: (...args: unknown[]) => void) => {
    ipcRenderer.on('theme-updated', (_event, ...args) => callback(...args));
  },

  // External browser API
  openExternal: (url: string) => {
    shell.openExternal(url);
  },

  // Clipboard API
  clipboard: {
    writeText: (text: string) => {
      clipboard.writeText(text);
    },
    readText: () => {
      return clipboard.readText();
    },
  },
});
