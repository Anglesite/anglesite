/**
 * @file Tests for the Electron renderer process.
 */
// Mock Electron's ipcRenderer (not used directly in tests)
jest.mock('electron', () => ({
  ipcRenderer: {
    send: jest.fn(),
  },
}));

describe('Renderer Process', () => {
  let buildButton: HTMLElement;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up a minimal DOM for the test
    document.body.innerHTML = `
      <button id="preview">Preview</button>
      <button id="open-browser">Open Browser</button>
      <button id="reload">Reload</button>
      <button id="devtools">DevTools</button>
    `;
    buildButton = document.getElementById('preview') as HTMLElement;

    // Dynamically import the renderer script after the DOM is set up
    jest.isolateModules(() => {
      jest.requireActual('../dist/src/renderer/renderer.js');
    });
  });

  it("should send a 'preview' message when the preview button is clicked", () => {
    const mockElectronAPI = (global as unknown as { mockElectronAPI: { send: jest.Mock } }).mockElectronAPI;
    buildButton.click();
    expect(mockElectronAPI.send).toHaveBeenCalledWith('preview');
  });
});
