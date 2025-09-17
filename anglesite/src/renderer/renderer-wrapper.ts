declare const window: Window & typeof globalThis;
declare const document: Document;
declare function prompt(message?: string, defaultValue?: string): string | null;

/**
 * @file Wrapper for renderer.ts to enable testing
 * This file wraps the renderer functionality in exportable functions for testing purposes.
 */

export function executeRendererInitialization(): void {
  // Send a message to main process to confirm renderer is loaded
  window.electronAPI?.send('renderer-loaded', 'Renderer is working!');
}

export function registerShowWebsiteNameInputListener(): void {
  try {
    if (window.electronAPI?.on) {
      window.electronAPI.on('show-website-name-input', () => {
        const websiteName = prompt('Enter a name for your new website:', 'My Website');

        if (websiteName && websiteName.trim()) {
          window.electronAPI?.send('create-website-with-name', websiteName.trim());
        }
      });
    } else {
      console.error('No electronAPI available');
    }
  } catch (error) {
    console.error('Error setting up listener:', error);
  }
}

export function setupButtonEventHandlers(): void {
  const newWebsiteButton = document.getElementById('new-website');
  const previewButton = document.getElementById('preview');
  const openBrowserButton = document.getElementById('open-browser');
  const reloadButton = document.getElementById('reload');
  const devToolsButton = document.getElementById('devtools');

  if (newWebsiteButton) {
    newWebsiteButton.addEventListener('click', () => {
      window.electronAPI?.send('new-website');
    });
  }

  if (previewButton) {
    previewButton.addEventListener('click', () => {
      window.electronAPI?.send('preview');
    });
  }

  if (openBrowserButton) {
    openBrowserButton.addEventListener('click', () => {
      window.electronAPI?.send('open-browser');
    });
  }

  if (reloadButton) {
    reloadButton.addEventListener('click', () => {
      window.electronAPI?.send('reload-preview');
    });
  }

  if (devToolsButton) {
    devToolsButton.addEventListener('click', () => {
      window.electronAPI?.send('toggle-devtools');
    });
  } else {
    console.error('DevTools button not found!');
  }
}

export function registerMenuEventListeners(): void {
  window.electronAPI?.on('preview-loaded', () => {});

  window.electronAPI?.on('menu-new-website', () => {
    window.electronAPI?.send('new-website');
  });

  // Handle trigger-new-website from menu
  window.electronAPI?.on('trigger-new-website', () => {
    window.electronAPI?.send('new-website');
  });

  window.electronAPI?.on('menu-reload', () => {
    const reloadButton = document.getElementById('reload');
    if (reloadButton) {
      reloadButton.click();
    }
  });

  window.electronAPI?.on('menu-toggle-devtools', () => {
    const devToolsButton = document.getElementById('devtools');
    if (devToolsButton) {
      devToolsButton.click();
    }
  });

  window.electronAPI?.on('menu-export-site', () => {
    window.electronAPI?.send('export-site');
  });
}

export function setupDOMContentLoadedHandler(): void {
  window.addEventListener('DOMContentLoaded', () => {
    // Renderer loaded successfully with BrowserView support
    // Setting up menu event listeners is handled elsewhere
  });
}
