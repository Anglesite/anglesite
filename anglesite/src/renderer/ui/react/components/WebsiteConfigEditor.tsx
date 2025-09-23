import React, { useState, useEffect } from 'react';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import { useAppContext } from '../context/AppContext';

interface SchemaResult {
  schema?: Record<string, unknown>;
  error?: string;
  warnings?: string[];
  fallbackSchema?: Record<string, unknown>;
}

interface WebsiteConfigEditorProps {
  onSave?: (data: any) => void;
  onError?: (error: string) => void;
}

export const WebsiteConfigEditor: React.FC<WebsiteConfigEditorProps> = ({ onSave, onError }) => {
  const { state } = useAppContext();
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;
    const abortController = new AbortController();

    const loadSchemaAndData = async () => {
      if (!state.websiteName) {
        setLoading(false);
        return;
      }

      try {
        // Load schema
        const schemaResult = await window.electronAPI.invoke(
          'get-website-schema',
          state.websiteName
        );

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
          console.warn('Schema warnings:', typedResult.warnings);
        }

        // Load existing data
        const existingContent = await window.electronAPI.invoke(
          'get-file-content',
          state.websiteName,
          'src/_data/website.json'
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
            console.error('Failed to parse existing configuration:', parseError);
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
          console.error('Error loading schema or data:', error);
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
      abortController.abort();
    };
  }, [state.websiteName, onError]);

  const handleSubmit = async (data: any) => {
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
        'src/_data/website.json',
        websiteJson
      );

      if (success) {
        onSave?.(data.formData);
      } else {
        onError?.('Failed to save configuration: Server returned false');
      }
    } catch (error) {
      console.error('Error saving configuration:', error);
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
      <Form
        schema={schema}
        formData={formData}
        validator={validator as any}
        onSubmit={handleSubmit}
      />
    </div>
  );
};

export default WebsiteConfigEditor;