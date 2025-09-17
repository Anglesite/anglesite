/**
 * @file TypeScript declarations for custom Jest matchers
 * @description Extends Jest's expect interface with our domain-specific matchers
 */

declare global {
  namespace jest {
    interface Matchers<R> {
      /**
       * Validates that the received value is a valid website configuration
       */
      toBeValidWebsiteConfig(): R;

      /**
       * Validates that the received string is a valid website name
       */
      toBeValidWebsiteName(): R;

      /**
       * Validates that the received string is a valid URL
       */
      toBeValidURL(): R;

      /**
       * Validates that the received string is valid JSON
       */
      toBeValidJSON(): R;

      /**
       * Validates that the received value is a valid collection item
       */
      toBeValidCollectionItem(): R;

      /**
       * Validates that the received error is an AngleError with specific code
       */
      toBeAngleErrorWithCode(expectedCode: string): R;

      /**
       * Validates that the received object has required properties
       */
      toHaveRequiredProperties(properties: string[]): R;

      /**
       * Validates that the received response follows API response format
       */
      toBeValidApiResponse(): R;
    }
  }
}

export {};
