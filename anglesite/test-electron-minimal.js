const { app, BrowserWindow } = require('electron');

console.log('Loaded electron:', typeof app);

app.whenReady().then(() => {
  console.log('✅ App is ready!');
  app.quit();
});
