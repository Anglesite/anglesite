import React, { useState, useEffect } from 'react';
import Form, { IChangeEvent } from '@rjsf/core';
import { RJSFSchema } from '@rjsf/utils';
import validator from '@rjsf/validator-ajv8';
import { useAppContext } from '../context/AppContext';

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
    };
  }, [state.websiteName, onError]);

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
      <Form schema={schema} formData={formData} validator={validator} onSubmit={handleSubmit} />
    </div>
  );
};

export default WebsiteConfigEditor;
