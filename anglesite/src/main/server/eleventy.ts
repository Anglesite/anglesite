/**
 * @file Eleventy server management.
 */
let liveServerReady = false;
let currentLiveServerUrl = 'https://localhost:8080';
let currentWebsiteName = 'anglesite';

/**
 * Get hostname from test domain URL.
 */
export function getHostnameFromTestDomain(testDomainUrl: string): string {
  try {
    const url = new URL(testDomainUrl);
    return url.hostname;
  } catch (error) {
    console.error('Failed to parse test domain URL:', error);
    return 'localhost';
  }
}

/**
 * Set the current live-server URL.
 */
export function setLiveServerUrl(url: string) {
  currentLiveServerUrl = url;
  liveServerReady = true;
}

/**
 * Returns the URL of the currently running Eleventy server.
 */
export function getCurrentLiveServerUrl(): string {
  return currentLiveServerUrl;
}

/**
 * Checks whether the Eleventy server has finished starting up and is ready to serve content.
 */
export function isLiveServerReady(): boolean {
  return liveServerReady;
}

/**
 * Returns the name of the website currently being served by Eleventy.
 */
export function getCurrentWebsiteName(): string {
  return currentWebsiteName;
}

/**
 * Updates the name of the website currently being served.
 */
export function setCurrentWebsiteName(name: string) {
  currentWebsiteName = name;
}
