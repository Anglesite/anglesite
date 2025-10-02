console.log('=== Electron Module Test ===');
const electron = require('electron');
console.log('typeof electron:', typeof electron);
console.log('electron keys:', Object.keys(electron || {}).slice(0, 10));
console.log('electron.app:', electron?.app);
console.log('electron.BrowserWindow:', electron?.BrowserWindow);

if (electron && electron.app) {
  console.log('✅ Electron loaded successfully!');
  electron.app.whenReady().then(() => {
    console.log('✅ App is ready!');
    electron.app.quit();
  });
} else {
  console.error('❌ Electron did not load properly');
  console.error('electron value:', electron);
  process.exit(1);
}
