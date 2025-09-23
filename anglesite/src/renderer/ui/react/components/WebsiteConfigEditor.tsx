/* eslint-disable jsdoc/match-description */
import React, { useState, useEffect } from 'react';
import Form, { IChangeEvent } from '@rjsf/core';
import { RJSFSchema } from '@rjsf/utils';
import validator from '@rjsf/validator-ajv8';
import { useAppContext } from '../context/AppContext';
import { logger } from '../../../utils/logger';
import { PATHS } from '../../../../shared/constants';

interface SchemaResult {
  schema?: RJSFSchema;
  error?: string;
  warnings?: string[];
  fallbackSchema?: RJSFSchema;
}

interface WebsiteConfigEditorProps {
  onSave?: (data: Record<string, unknown>) => void;
  onError?: (error: string) => void;
}

export const WebsiteConfigEditor: React.FC<WebsiteConfigEditorProps> = ({ onSave, onError }) => {
  const { state } = useAppContext();
  const [schema, setSchema] = useState<RJSFSchema | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    /**
     * Loads website schema and configuration data from the main process.
     *
     * This async function orchestrates the loading of both the JSON schema
     * (used for form validation and UI generation) and existing website
     * configuration data. It includes comprehensive error handling and
     * graceful fallbacks for missing or invalid data.
     *
     * **IPC Communication:**
     * - `get-website-schema`: Retrieves JSON schema for form generation
     * - `get-file-content`: Loads existing website.json configuration
     *
     * **Error Handling:**
     * - Type validation for schema response structure
     * - JSON parsing errors with fallback to default configuration
     * - Cancellation handling for component unmounting
     *
     * **State Management:**
     * - Updates loading state for UI feedback
     * - Sets error state for user notification
     * - Populates form with existing data or sensible defaults
     * @example
     * ```typescript
     * // Called automatically when websiteName changes
     * useEffect(() => {
     *   loadSchemaAndData();
     * }, [state.websiteName]);
     * ```
     */
    const loadSchemaAndData = async () => {
      if (!state.websiteName) {
        setLoading(false);
        return;
      }

      try {
        // Load schema
        const schemaResult = await window.electronAPI.invoke('get-website-schema', state.websiteName);

        if (isCancelled) return;

        // Type guard for schema result
        if (!schemaResult || typeof schemaResult !== 'object' || schemaResult === null) {
          throw new Error('Invalid schema response from main process');
        }

        const typedResult = schemaResult as Partial<SchemaResult>;

        if (!typedResult.schema || typeof typedResult.schema !== 'object') {
          throw new Error('Failed to load website configuration schema');
        }

        setSchema(typedResult.schema);

        if (typedResult.warnings?.length) {
          logger.warn('WebsiteConfigEditor', 'Schema loading warnings', { warnings: typedResult.warnings });
        }

        // Load existing data
        const existingContent = await window.electronAPI.invoke(
          'get-file-content',
          state.websiteName,
          PATHS.WEBSITE_DATA
        );

        if (isCancelled) return;

        if (existingContent && typeof existingContent === 'string') {
          try {
            const parsedData = JSON.parse(existingContent);
            if (parsedData && typeof parsedData === 'object') {
              setFormData(parsedData);
            } else {
              throw new Error('Invalid JSON data structure');
            }
          } catch (parseError) {
            logger.error('WebsiteConfigEditor', 'Failed to parse existing configuration', parseError);
            setFormData({
              title: state.websiteName || 'My Website',
              language: 'en',
            });
          }
        } else {
          setFormData({
            title: state.websiteName || 'My Website',
            language: 'en',
          });
        }
      } catch (error) {
        if (!isCancelled) {
          logger.error('WebsiteConfigEditor', 'Error loading schema or data', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          onError?.(`Failed to load configuration: ${errorMessage}`);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    loadSchemaAndData();

    return () => {
      isCancelled = true;
    };
  }, [state.websiteName, onError]);

  /**
   * Handles form submission for website configuration changes.
   *
   * Processes form data from React JSON Schema Form and saves it to the
   * website's configuration file via IPC communication. Includes validation,
   * error handling, and success/failure callbacks for parent components.
   *
   * **Validation Steps:**
   * 1. Ensures a website is currently loaded
   * 2. Validates form data structure from RJSF
   * 3. Converts to JSON format with proper formatting
   *
   * **IPC Communication:**
   * Uses `save-file-content` channel to write JSON data to `${PATHS.WEBSITE_DATA}`
   *
   * **Error Handling:**
   * - Reports validation errors through onError callback
   * - Handles IPC communication failures
   * - Provides user-friendly error messages
   * @param data Form submission data from React JSON Schema Form
   * @example
   * ```typescript
   * // Form submission flow
   * <Form
   *   schema={schema}
   *   formData={formData}
   *   onSubmit={handleSubmit}
   *   validator={validator}
   * />
   *
   * // Success/error handling in parent component
   * <WebsiteConfigEditor
   *   onSave={(data) => showSuccessMessage('Configuration saved!')}
   *   onError={(error) => showErrorMessage(error)}
   * />
   * ```
   */
  const handleSubmit = async (data: IChangeEvent) => {
    if (!state.websiteName) {
      onError?.('No website loaded');
      return;
    }

    try {
      // Validate form data structure
      if (!data.formData || typeof data.formData !== 'object') {
        throw new Error('Invalid form data structure');
      }

      const websiteJson = JSON.stringify(data.formData, null, 2);

      const success = await window.electronAPI.invoke(
        'save-file-content',
        state.websiteName,
        PATHS.WEBSITE_DATA,
        websiteJson
      );

      if (success) {
        onSave?.(data.formData);
      } else {
        onError?.('Failed to save configuration: Server returned false');
      }
    } catch (error) {
      logger.error('WebsiteConfigEditor', 'Error saving configuration', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      onError?.(`Failed to save configuration: ${errorMessage}`);
    }
  };

  if (!state.websiteName) {
    return <div>No website loaded</div>;
  }

  if (loading || !schema) {
    return <div>Loading...</div>;
  }

  return (
    <div style={{ padding: '20px' }}>
      <h3>Website Configuration</h3>
      <Form schema={schema} formData={formData} validator={validator} onSubmit={handleSubmit} />
    </div>
  );
};

export default WebsiteConfigEditor;
