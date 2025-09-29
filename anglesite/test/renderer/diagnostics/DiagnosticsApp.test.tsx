/**
 * @file Tests for DiagnosticsApp component
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { jest } from '@jest/globals';
import DiagnosticsApp from '../../../src/renderer/diagnostics/DiagnosticsApp';

// Mock the electron API
const mockDiagnosticsAPI = {
  getServiceHealth: jest.fn(),
  getErrors: jest.fn(),
  getStatistics: jest.fn(),
  getNotifications: jest.fn(),
};

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: {
    diagnostics: mockDiagnosticsAPI,
    send: jest.fn(),
  },
  writable: true,
});

// Mock console methods to avoid test noise
const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

describe('DiagnosticsApp', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default successful mock responses
    mockDiagnosticsAPI.getServiceHealth.mockResolvedValue({
      isHealthy: true,
      errorReportingConnected: true,
      activeSubscriptions: 0,
      pendingNotifications: 0,
    });
  });

  afterEach(() => {
    consoleSpy.mockClear();
    consoleLogSpy.mockClear();
  });

  afterAll(() => {
    consoleSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  test('should render initialization loading state', () => {
    render(<DiagnosticsApp />);

    expect(screen.getByTestId('initialization-spinner')).toBeInTheDocument();
    expect(screen.getByText('Initializing diagnostics interface...')).toBeInTheDocument();
  });

  test('should initialize successfully and show main interface', async () => {
    render(<DiagnosticsApp />);

    // Wait for initialization
    await waitFor(() => {
      expect(screen.getByTestId('diagnostics-app')).toBeInTheDocument();
    });

    // Check that service health was called
    expect(mockDiagnosticsAPI.getServiceHealth).toHaveBeenCalled();

    // Should show dashboard and placeholder error list
    expect(screen.getByText('Error Overview')).toBeInTheDocument(); // From ErrorDashboard
    expect(screen.getByText('Error List')).toBeInTheDocument(); // Still placeholder
  });

  test('should handle initialization failure gracefully', async () => {
    mockDiagnosticsAPI.getServiceHealth.mockRejectedValue(new Error('Service unavailable'));

    render(<DiagnosticsApp />);

    await waitFor(() => {
      expect(screen.getByText('Unable to Load Diagnostics')).toBeInTheDocument();
      expect(screen.getByText('Service unavailable')).toBeInTheDocument();
    });

    // Should show retry button
    expect(screen.getByTestId('main-retry-button')).toBeInTheDocument();
  });

  test('should handle missing electron API gracefully', async () => {
    // Remove electron API temporarily
    const originalAPI = (window as any).electronAPI;
    delete (window as any).electronAPI;

    render(<DiagnosticsApp />);

    await waitFor(() => {
      expect(screen.getByText('Unable to Load Diagnostics')).toBeInTheDocument();
      expect(screen.getByText(/Diagnostics API not available/)).toBeInTheDocument();
    });

    // Restore API
    (window as any).electronAPI = originalAPI;
  });

  test('should show development info in development mode', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    render(<DiagnosticsApp />);

    await waitFor(() => {
      expect(screen.getByTestId('diagnostics-app')).toBeInTheDocument();
    });

    // Should show dev info
    expect(screen.getByText('Service Health: ✅')).toBeInTheDocument();
    expect(screen.getByText('Connection: 🟢')).toBeInTheDocument();
    expect(screen.getByText('API Available: ✅')).toBeInTheDocument();

    process.env.NODE_ENV = originalEnv;
  });

  test('should handle error boundary correctly', async () => {
    // Force an error by making the service health call throw
    mockDiagnosticsAPI.getServiceHealth.mockImplementation(() => {
      throw new Error('Component error');
    });

    render(<DiagnosticsApp />);

    await waitFor(() => {
      expect(screen.getByText('Unable to Load Diagnostics')).toBeInTheDocument();
      expect(screen.getByText('Component error')).toBeInTheDocument();
    });
  });

  test('should have proper layout structure', async () => {
    render(<DiagnosticsApp />);

    await waitFor(() => {
      expect(screen.getByTestId('diagnostics-layout')).toBeInTheDocument();
    });

    // Check layout components
    expect(screen.getByTestId('diagnostics-header')).toBeInTheDocument();
    expect(screen.getByTestId('diagnostics-main')).toBeInTheDocument();
    expect(screen.getByTestId('diagnostics-footer')).toBeInTheDocument();

    // Check header content
    expect(screen.getByText('Website Diagnostics')).toBeInTheDocument();
    expect(screen.getByTestId('connection-status')).toBeInTheDocument();
    expect(screen.getByTestId('close-button')).toBeInTheDocument();
  });

  test('should show disconnected state when service is unhealthy', async () => {
    mockDiagnosticsAPI.getServiceHealth.mockResolvedValue({
      isHealthy: false,
      errorReportingConnected: false,
      activeSubscriptions: 0,
      pendingNotifications: 0,
    });

    render(<DiagnosticsApp />);

    await waitFor(() => {
      expect(screen.getByText('Disconnected')).toBeInTheDocument();
    });
  });

  test('should have accessible structure', async () => {
    render(<DiagnosticsApp />);

    await waitFor(() => {
      expect(screen.getByTestId('diagnostics-app')).toBeInTheDocument();
    });

    // Check for proper ARIA labels and roles
    const layout = screen.getByTestId('diagnostics-layout');
    expect(layout).toBeInTheDocument();

    const header = screen.getByTestId('diagnostics-header');
    expect(header.tagName).toBe('HEADER');

    const main = screen.getByTestId('diagnostics-main');
    expect(main.tagName).toBe('MAIN');

    const footer = screen.getByTestId('diagnostics-footer');
    expect(footer.tagName).toBe('FOOTER');
  });
});
