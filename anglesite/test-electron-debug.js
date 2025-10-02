console.log('=== Electron Debug ===');
console.log('process.type:', process.type);
console.log('process.versions:', process.versions);
console.log('process.versions.electron:', process.versions.electron);

const electron = require('electron');
console.log('typeof electron:', typeof electron);

if (typeof electron === 'object') {
  console.log('✅ Electron API loaded!');
  console.log('electron.app exists:', !!electron.app);
  if (electron.app) {
    electron.app.whenReady().then(() => {
      console.log('App ready!');
      electron.app.quit();
    });
  }
} else {
  console.log('❌ Got string instead of API:', electron);
}
