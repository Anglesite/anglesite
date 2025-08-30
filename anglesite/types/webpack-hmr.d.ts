/**
 * @file Type definitions for webpack Hot Module Replacement
 */

declare global {
  namespace NodeJS {
    interface Module {
      hot?: {
        accept(): void;
        accept(dependencies: string[], callback: () => void): void;
        accept(dependency: string, callback: () => void): void;
        decline(): void;
        decline(dependencies: string[]): void;
        decline(dependency: string): void;
        dispose(callback: (data: unknown) => void): void;
        addDisposeHandler(callback: (data: unknown) => void): void;
        removeDisposeHandler(callback: (data: unknown) => void): void;
        invalidate(): void;
        addStatusHandler(callback: (status: string) => void): void;
        removeStatusHandler(callback: (status: string) => void): void;
        status(): string;
        data?: unknown;
      };
    }
  }
}

export {};
