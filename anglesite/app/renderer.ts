declare const window: Window & typeof globalThis;
declare const document: Document;
declare function prompt(message?: string, defaultValue?: string): string | null;

/**
 * @file Renderer process for the Electron application.
 * @see {@link https://www.electronjs.org/docs/latest/tutorial/process-model#renderer-process}
 */

// Export functions for testing
export function initializeRenderer(): void {
  // Renderer initialization
}

export function logElectronAPIAvailability(): void {
  // Check electronAPI availability
}

export function logDocumentReadyState(): void {
  // Check document ready state
}

export function sendRendererLoadedMessage(): void {
  // Send a message to main process to confirm renderer is loaded
  if (window.electronAPI) {
    window.electronAPI.send('renderer-loaded', 'Renderer is working!');
  }
}

// Execute initialization when running as script
initializeRenderer();
logElectronAPIAvailability();
logDocumentReadyState();
sendRendererLoadedMessage();

export function registerShowWebsiteNameInputListener(): void {
  try {
    if (window.electronAPI && window.electronAPI.on) {
      window.electronAPI.on('show-website-name-input', () => {
        const websiteName = prompt('Enter a name for your new website:', 'My Website');

        if (websiteName && websiteName.trim()) {
          window.electronAPI.send('create-website-with-name', websiteName.trim());
        }
      });
    } else {
      console.error('No electronAPI available');
    }
  } catch (error) {
    console.error('Error setting up listener:', error);
  }
}

// Execute when running as script
registerShowWebsiteNameInputListener();

export function setupButtonEventHandlers(): void {
  const newWebsiteButton = document.getElementById('new-website');
  const previewButton = document.getElementById('preview');
  const openBrowserButton = document.getElementById('open-browser');
  const reloadButton = document.getElementById('reload');
  const devToolsButton = document.getElementById('devtools');

  /**
   * Adds event listener to the new website button.
   * @returns {void}
   */
  if (newWebsiteButton) {
    newWebsiteButton.addEventListener('click', () => {
      window.electronAPI.send('new-website');
    });
  }

  /**
   * Adds event listener to the preview button to load the site preview.
   * @returns {void}
   */
  if (previewButton) {
    previewButton.addEventListener('click', () => {
      console.log('Preview button clicked');
      window.electronAPI.send('preview');
    });
  }

  /**
   * Adds event listener to the open browser button to open the site in external browser.
   * @returns {void}
   */
  if (openBrowserButton) {
    openBrowserButton.addEventListener('click', () => {
      window.electronAPI.send('open-browser');
    });
  }

  /**
   * Adds event listener to the reload button to refresh the site preview.
   * @returns {void}
   */
  if (reloadButton) {
    reloadButton.addEventListener('click', () => {
      console.log('Reload button clicked');
      window.electronAPI.send('reload-preview');
    });
  }

  /**
   * Adds event listener to the DevTools button to toggle dev tools.
   * @returns {void}
   */
  if (devToolsButton) {
    devToolsButton.addEventListener('click', () => {
      console.log('DevTools button clicked - sending IPC message');
      window.electronAPI.send('toggle-devtools');
      console.log('IPC message sent');
    });
  } else {
    console.error('DevTools button not found!');
  }
}

// Execute when running as script
setupButtonEventHandlers();

export function registerMenuEventListeners(): void {
  /**
   * Listens for preview loaded events from the main process.
   * @returns {void}
   */
  window.electronAPI.on('preview-loaded', () => {
    console.log('Preview BrowserView loaded');
  });

  /**
   * Handle menu events from the application menu.
   * @returns {void}
   */
  window.electronAPI.on('menu-new-website', () => {
    window.electronAPI.send('new-website');
  });

  // Handle trigger-new-website from menu
  window.electronAPI.on('trigger-new-website', () => {
    window.electronAPI.send('new-website');
  });

  window.electronAPI.on('menu-reload', () => {
    const reloadButton = document.getElementById('reload');
    if (reloadButton) {
      reloadButton.click();
    }
  });

  window.electronAPI.on('menu-toggle-devtools', () => {
    const devToolsButton = document.getElementById('devtools');
    if (devToolsButton) {
      devToolsButton.click();
    }
  });

  window.electronAPI.on('menu-export-site', () => {
    console.log('Export site requested from menu');
    window.electronAPI.send('export-site');
  });
}

// Execute when running as script
registerMenuEventListeners();

export function setupDOMContentLoadedHandler(): void {
  /**
   * Add console log to confirm renderer is loaded.
   * @returns {void}
   */
  window.addEventListener('DOMContentLoaded', () => {
    // Renderer loaded successfully with BrowserView support
    // Setting up menu event listeners is handled elsewhere
  });
}

// Execute when running as script
setupDOMContentLoadedHandler();
