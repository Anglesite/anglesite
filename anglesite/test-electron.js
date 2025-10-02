// Minimal test to see if Electron module loading works
console.log('process.versions:', process.versions);
console.log('process.type:', process.type);

const electron = require('electron');
console.log('typeof electron:', typeof electron);
console.log('electron keys:', Object.keys(electron).slice(0, 30).join(', '));

if (typeof electron === 'object' && electron.app) {
  console.log('SUCCESS: Electron API is available!');
  electron.app.quit();
} else {
  console.log('FAILURE: Electron API is NOT available - got:', typeof electron);
  process.exit(1);
}
