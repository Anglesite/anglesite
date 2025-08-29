// Simple test to check certificate mocking
const { spawn } = require('child_process');

console.log('Starting certificate test...');

const testProcess = spawn('npm', ['test', '--', 'test/app/certificates.test.ts', '--testTimeout=5000'], {
  stdio: 'pipe',
});

let timeoutId = setTimeout(() => {
  console.log('Test is taking too long, killing process...');
  testProcess.kill('SIGKILL');
  process.exit(1);
}, 30000); // 30 second timeout

testProcess.stdout.on('data', (data) => {
  console.log('STDOUT:', data.toString());
});

testProcess.stderr.on('data', (data) => {
  console.log('STDERR:', data.toString());
});

testProcess.on('close', (code) => {
  clearTimeout(timeoutId);
  console.log('Test completed with code:', code);
  process.exit(code);
});

testProcess.on('error', (error) => {
  clearTimeout(timeoutId);
  console.log('Test error:', error);
  process.exit(1);
});
