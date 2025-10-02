// Test what electron module actually exports
console.log('=== Electron Module Test ===');
console.log('process.type:', process.type);
console.log('process.versions:', process.versions);

try {
  const electron = require('electron');
  console.log('\ntypeof electron:', typeof electron);
  console.log('electron keys:', Object.keys(electron).slice(0, 20).join(', '));
  console.log('electron.app:', electron.app);
  console.log('typeof electron.app:', typeof electron.app);

  if (electron.app && typeof electron.app.setName === 'function') {
    console.log('\n✅ SUCCESS: Electron API is available!');
    electron.app.quit();
  } else {
    console.log('\n❌ FAILURE: Electron app is not available');
    process.exit(1);
  }
} catch (err) {
  console.error('\n❌ ERROR loading electron:', err);
  process.exit(1);
}
