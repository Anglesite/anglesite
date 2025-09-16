/**
 * @file IPC testing utilities for backend handler tests
 * @description Provides standardized utilities for testing IPC handlers and backend functionality
 */

import type { MockElectronAPI } from './mock-factory';

/**
 * Utility class for testing IPC handlers
 */
export class IPCTestHelper {
  private mockAPI: MockElectronAPI;

  constructor(mockAPI: MockElectronAPI) {
    this.mockAPI = mockAPI;
  }

  /**
   * Assert that an IPC call was made with specific parameters
   */
  expectCall(channel: string, ...expectedArgs: unknown[]): void {
    expect(this.mockAPI.invoke).toHaveBeenCalledWith(channel, ...expectedArgs);
  }

  /**
   * Assert that an IPC call was made a specific number of times
   */
  expectCallCount(channel: string, count: number): void {
    const calls = this.mockAPI.invoke.mock.calls.filter((call) => call[0] === channel);
    expect(calls).toHaveLength(count);
  }

  /**
   * Get the arguments from a specific IPC call
   */
  getCallArgs(channel: string, callIndex = 0): unknown[] {
    const calls = this.mockAPI.invoke.mock.calls.filter((call) => call[0] === channel);
    if (calls.length <= callIndex) {
      throw new Error(`Expected at least ${callIndex + 1} calls to ${channel}, but got ${calls.length}`);
    }
    return calls[callIndex].slice(1); // Remove channel name from args
  }

  /**
   * Assert that an IPC call was made with arguments matching a pattern
   */
  expectCallMatching(channel: string, matcher: (args: unknown[]) => boolean): void {
    const calls = this.mockAPI.invoke.mock.calls.filter((call) => call[0] === channel);
    const matchingCall = calls.find((call) => matcher(call.slice(1)));
    expect(matchingCall).toBeDefined();
  }

  /**
   * Setup responses for multiple IPC channels
   */
  setupResponses(responses: Record<string, unknown>): void {
    this.mockAPI.invoke.mockImplementation((channel: string, ...args: unknown[]) => {
      if (channel in responses) {
        const response = responses[channel];
        return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
      }
      return Promise.resolve(null);
    });
  }

  /**
   * Setup a response for a specific channel that depends on the arguments
   */
  setupDynamicResponse(channel: string, responseFunction: (...args: unknown[]) => unknown): void {
    const originalImplementation = this.mockAPI.invoke.getMockImplementation();

    this.mockAPI.invoke.mockImplementation((ch: string, ...args: unknown[]) => {
      if (ch === channel) {
        try {
          const result = responseFunction(...args);
          return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
        } catch (error) {
          return Promise.reject(error);
        }
      }

      // Fallback to original implementation or return null
      return originalImplementation ? originalImplementation(ch, ...args) : Promise.resolve(null);
    });
  }

  /**
   * Reset all IPC mocks
   */
  reset(): void {
    this.mockAPI.invoke.mockClear();
    this.mockAPI.send.mockClear();
    this.mockAPI.on.mockClear();
    this.mockAPI.off.mockClear();
  }
}

/**
 * Common IPC test patterns for standard operations
 */
export class IPCTestPatterns {
  private helper: IPCTestHelper;

  constructor(mockAPI: MockElectronAPI) {
    this.helper = new IPCTestHelper(mockAPI);
  }

  /**
   * Test pattern for file operations
   */
  async fileOperation(
    channel: string,
    websiteName: string,
    filePath: string,
    expectedResult: unknown,
    additionalArgs: unknown[] = []
  ): Promise<void> {
    this.helper.setupResponses({ [channel]: expectedResult });

    // Simulate the IPC call
    const result = await this.helper.mockAPI.invoke(channel, websiteName, filePath, ...additionalArgs);

    expect(result).toEqual(expectedResult);
    this.helper.expectCall(channel, websiteName, filePath, ...additionalArgs);
  }

  /**
   * Test pattern for schema operations
   */
  async schemaOperation(websiteName: string, expectedSchema: unknown, shouldSucceed = true): Promise<void> {
    const response = shouldSucceed
      ? { schema: expectedSchema }
      : { error: 'Schema not found', fallbackSchema: expectedSchema };

    this.helper.setupResponses({ 'get-website-schema': response });

    const result = await this.helper.mockAPI.invoke('get-website-schema', websiteName);

    expect(result).toEqual(response);
    this.helper.expectCall('get-website-schema', websiteName);
  }

  /**
   * Test pattern for website creation
   */
  async websiteCreation(websiteName: string, websitePath: string, shouldSucceed = true): Promise<void> {
    const expectedResult = shouldSucceed ? { success: true } : { error: 'Creation failed' };

    this.helper.setupResponses({ 'create-website': expectedResult });

    const result = await this.helper.mockAPI.invoke('create-website', websiteName, websitePath);

    expect(result).toEqual(expectedResult);
    this.helper.expectCall('create-website', websiteName, websitePath);
  }

  /**
   * Test pattern for configuration save operations
   */
  async configurationSave(websiteName: string, configData: unknown, shouldSucceed = true): Promise<void> {
    const expectedResult = shouldSucceed ? true : false;

    this.helper.setupResponses({ 'save-file-content': expectedResult });

    const result = await this.helper.mockAPI.invoke(
      'save-file-content',
      websiteName,
      'src/_data/website.json',
      JSON.stringify(configData)
    );

    expect(result).toBe(expectedResult);
    this.helper.expectCall('save-file-content', websiteName, 'src/_data/website.json', JSON.stringify(configData));
  }

  /**
   * Test pattern for error handling
   */
  async errorHandling(channel: string, args: unknown[], expectedError: string | Error): Promise<void> {
    const error = typeof expectedError === 'string' ? new Error(expectedError) : expectedError;

    this.helper.setupResponses({ [channel]: error });

    await expect(this.helper.mockAPI.invoke(channel, ...args)).rejects.toThrow();
    this.helper.expectCall(channel, ...args);
  }
}

/**
 * Utility for testing event-based IPC communications
 */
export class IPCEventTestHelper {
  private mockAPI: MockElectronAPI;
  private eventHandlers: Map<string, Function[]> = new Map();

  constructor(mockAPI: MockElectronAPI) {
    this.mockAPI = mockAPI;
    this.setupEventMocks();
  }

  private setupEventMocks(): void {
    this.mockAPI.on.mockImplementation((event: string, handler: Function) => {
      if (!this.eventHandlers.has(event)) {
        this.eventHandlers.set(event, []);
      }
      this.eventHandlers.get(event)!.push(handler);
    });

    this.mockAPI.off.mockImplementation((event: string, handler?: Function) => {
      if (handler) {
        const handlers = this.eventHandlers.get(event) || [];
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      } else {
        this.eventHandlers.delete(event);
      }
    });
  }

  /**
   * Trigger an event and call all registered handlers
   */
  triggerEvent(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.forEach((handler) => handler(...args));
  }

  /**
   * Assert that an event listener was registered
   */
  expectEventListener(event: string): void {
    expect(this.mockAPI.on).toHaveBeenCalledWith(event, expect.any(Function));
  }

  /**
   * Get the number of handlers registered for an event
   */
  getHandlerCount(event: string): number {
    return this.eventHandlers.get(event)?.length || 0;
  }

  /**
   * Clear all event handlers
   */
  clearEventHandlers(): void {
    this.eventHandlers.clear();
  }
}

/**
 * Factory for creating IPC test helpers
 */
export class IPCTestFactory {
  static createHelper(mockAPI: MockElectronAPI): IPCTestHelper {
    return new IPCTestHelper(mockAPI);
  }

  static createPatterns(mockAPI: MockElectronAPI): IPCTestPatterns {
    return new IPCTestPatterns(mockAPI);
  }

  static createEventHelper(mockAPI: MockElectronAPI): IPCEventTestHelper {
    return new IPCEventTestHelper(mockAPI);
  }

  /**
   * Create a complete IPC testing environment
   */
  static createTestEnvironment(mockAPI: MockElectronAPI) {
    return {
      helper: new IPCTestHelper(mockAPI),
      patterns: new IPCTestPatterns(mockAPI),
      events: new IPCEventTestHelper(mockAPI),
      mockAPI,
    };
  }
}

/**
 * Common assertions for IPC testing
 */
export const IPCAssertions = {
  /**
   * Assert that a website name is valid
   */
  validWebsiteName(name: unknown): void {
    expect(typeof name).toBe('string');
    expect(name).toBeTruthy();
    expect(name).not.toContain('/');
    expect(name).not.toContain('\\');
  },

  /**
   * Assert that a file path is valid
   */
  validFilePath(path: unknown): void {
    expect(typeof path).toBe('string');
    expect(path).toBeTruthy();
  },

  /**
   * Assert that a configuration object is valid
   */
  validConfiguration(config: unknown): void {
    expect(config).toBeInstanceOf(Object);
    expect(config).toHaveProperty('title');
    expect(config).toHaveProperty('language');
  },

  /**
   * Assert that an IPC response has the expected structure
   */
  validIPCResponse(response: unknown, expectedProperties: string[]): void {
    expect(response).toBeInstanceOf(Object);
    expectedProperties.forEach((prop) => {
      expect(response).toHaveProperty(prop);
    });
  },

  /**
   * Assert that an error response has the expected structure
   */
  validErrorResponse(response: unknown): void {
    expect(response).toBeInstanceOf(Object);
    expect(response).toHaveProperty('error');
    expect(typeof (response as any).error).toBe('string');
  },
};

/**
 * Convenience functions for common IPC test scenarios
 */
export const IPCTestScenarios = {
  /**
   * Test successful file loading
   */
  async successfulFileLoad(helper: IPCTestHelper, websiteName: string, filePath: string, content: string) {
    helper.setupResponses({ 'get-file-content': content });
    const result = await helper.mockAPI.invoke('get-file-content', websiteName, filePath);
    expect(result).toBe(content);
    helper.expectCall('get-file-content', websiteName, filePath);
  },

  /**
   * Test file loading failure
   */
  async failedFileLoad(helper: IPCTestHelper, websiteName: string, filePath: string) {
    const error = new Error('File not found');
    helper.setupResponses({ 'get-file-content': error });
    await expect(helper.mockAPI.invoke('get-file-content', websiteName, filePath)).rejects.toThrow('File not found');
    helper.expectCall('get-file-content', websiteName, filePath);
  },

  /**
   * Test successful configuration save
   */
  async successfulConfigSave(helper: IPCTestHelper, websiteName: string, config: unknown) {
    helper.setupResponses({ 'save-file-content': true });
    const result = await helper.mockAPI.invoke(
      'save-file-content',
      websiteName,
      'src/_data/website.json',
      JSON.stringify(config)
    );
    expect(result).toBe(true);
    helper.expectCall('save-file-content', websiteName, 'src/_data/website.json', JSON.stringify(config));
  },
};
