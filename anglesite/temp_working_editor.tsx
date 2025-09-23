import React, { useState, useEffect } from 'react';
import Form from '@rjsf/core';
import { RJSFSchema } from '@rjsf/utils';
import validator from '@rjsf/validator-ajv8';
import { useAppContext } from '../context/AppContext';

interface FormSubmissionData {
  formData: Record<string, unknown>;
}

interface WebsiteConfigEditorProps {
  onSave?: (data: FormSubmissionData) => void;
  onError?: (error: string) => void;
}

export const WebsiteConfigEditor: React.FC<WebsiteConfigEditorProps> = ({ onSave, onError }) => {
  const { state } = useAppContext();
  const [schema, setSchema] = useState<RJSFSchema | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load the website schema
  const loadSchema = async () => {
    try {
      setLoading(true);
      setError(null);

      // Try to load schema from the anglesite-11ty package
      let websiteSchema: RJSFSchema;

      try {
        const response = await fetch('../../anglesite-11ty/schemas/website.schema.json');
        if (response.ok) {
          websiteSchema = (await response.json()) as RJSFSchema;
        } else {
          throw new Error('Schema file not found');
        }
      } catch {
        // Fallback to embedded schema
        websiteSchema = getEmbeddedSchema();
      }

      setSchema(websiteSchema);
    } catch (err) {
      console.error('Failed to load schema:', err);
      setError('Failed to load website configuration schema');
    } finally {
      setLoading(false);
    }
  };

  // Load existing website.json data
  const loadWebsiteData = async () => {
    if (!state.websiteName) return;

    try {
      const existingContent = await window.electronAPI?.invoke(
        'get-file-content',
        state.websiteName,
        'src/_data/website.json'
      );

      if (existingContent && typeof existingContent === 'string') {
        const data = JSON.parse(existingContent);
        setFormData(data);
      } else {
        // Set defaults
        setFormData({
          title: state.websiteName || 'My Website',
          language: 'en',
        });
      }
    } catch {
      console.log('No existing website.json found, using defaults');
      setFormData({
        title: state.websiteName || 'My Website',
        language: 'en',
      });
    }
  };

  // Save website configuration
  const saveWebsiteConfig = async (data: FormSubmissionData) => {
    if (!state.websiteName) {
      setError('No website loaded');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const websiteJson = JSON.stringify(data, null, 2);
      const success = await window.electronAPI?.invoke(
        'save-file-content',
        state.websiteName,
        'src/_data/website.json',
        websiteJson
      );

      if (success) {
        setSuccess('Configuration saved successfully!');
        onSave?.(data);

        // Clear success message after 3 seconds
        setTimeout(() => setSuccess(null), 3000);
      } else {
        throw new Error('Failed to save file');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save configuration';
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  // Get embedded schema fallback
  const getEmbeddedSchema = (): RJSFSchema => ({
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Website Configuration',
    description: 'Configure your website settings, metadata, and features',
    type: 'object',
    required: ['title', 'language'],
    properties: {
      title: {
        type: 'string',
        title: 'Website Title',
        description: 'The main title of your website that appears in the browser tab and search results',
        minLength: 1,
        examples: ['My Awesome Website', 'Anglesite Starter'],
      },
      language: {
        type: 'string',
        title: 'Primary Language',
        description: 'The primary language of your website using ISO 639-1 language codes',
        pattern: '^[a-z]{2}(-[A-Z]{2})?$',
        examples: ['en', 'en-US', 'fr', 'de', 'es'],
        default: 'en',
      },
      description: {
        type: 'string',
        title: 'Website Description',
        description: 'A brief description of your website used for SEO and social media previews',
        maxLength: 160,
      },
      url: {
        type: 'string',
        title: 'Website URL',
        description: 'The base URL where your website will be hosted (must use HTTPS)',
        format: 'uri',
        pattern: '^https://',
        examples: ['https://example.com', 'https://mysite.netlify.app'],
      },
      author: {
        type: 'object',
        title: 'Author Information',
        description: 'Information about the website author or organization',
        properties: {
          name: {
            type: 'string',
            title: 'Name',
            description: 'Your full name or organization name',
          },
          email: {
            type: 'string',
            title: 'Email Address',
            format: 'email',
            description: 'Contact email address for the website',
          },
          url: {
            type: 'string',
            title: 'Personal Website',
            format: 'uri',
            description: 'Your personal website or company homepage',
          },
        },
      },
      social: {
        type: 'object',
        title: 'Social Media Profiles',
        description: 'Your social media accounts for integration and sharing',
        properties: {
          twitter: {
            type: 'string',
            title: 'Twitter/X Username',
            description: 'Your Twitter/X username (without the @ symbol)',
            pattern: '^[A-Za-z0-9_]+$',
          },
          github: {
            type: 'string',
            title: 'GitHub Username',
            description: 'Your GitHub username or organization',
          },
          linkedin: {
            type: 'string',
            title: 'LinkedIn Profile',
            description: 'Full URL to your LinkedIn profile or company page',
            format: 'uri',
          },
        },
      },
      analytics: {
        type: 'object',
        title: 'Analytics & Tracking',
        description: 'Configure website analytics and tracking services',
        properties: {
          google: {
            type: 'string',
            title: 'Google Analytics ID',
            description: 'Your Google Analytics measurement ID (starts with G-, UA-, or GTM-)',
            pattern: '^(UA-|G-|GTM-)',
            examples: ['G-XXXXXXXXXX', 'UA-XXXXX-Y'],
          },
        },
      },
      manifest: {
        type: 'object',
        title: 'Progressive Web App',
        description: 'Settings for Progressive Web App features',
        properties: {
          theme_color: {
            type: 'string',
            title: 'Theme Color',
            description: 'Primary theme color for your app (hex color code)',
            pattern: '^#[0-9A-Fa-f]{6}$',
            examples: ['#007bff', '#28a745', '#dc3545'],
          },
          background_color: {
            type: 'string',
            title: 'Background Color',
            description: 'Background color for the splash screen (hex color code)',
            pattern: '^#[0-9A-Fa-f]{6}$',
            examples: ['#ffffff', '#f8f9fa'],
          },
        },
      },
    },
  });

  // UI Schema for better form rendering
  const uiSchema = {
    title: {
      'ui:placeholder': 'Enter your website title',
    },
    description: {
      'ui:widget': 'textarea',
      'ui:options': {
        rows: 3,
      },
      'ui:placeholder': 'Brief description of your website (max 160 characters)',
    },
    url: {
      'ui:placeholder': 'https://example.com',
    },
    author: {
      'ui:description': 'Information about you or your organization',
      name: {
        'ui:placeholder': 'Your name or company name',
      },
      email: {
        'ui:placeholder': 'contact@example.com',
      },
      url: {
        'ui:placeholder': 'https://yourwebsite.com',
      },
    },
    social: {
      'ui:description': 'Connect your social media profiles',
      twitter: {
        'ui:placeholder': 'username',
      },
      github: {
        'ui:placeholder': 'username',
      },
      linkedin: {
        'ui:placeholder': 'https://linkedin.com/in/username',
      },
    },
    analytics: {
      'ui:description': "Track your website's performance",
      google: {
        'ui:placeholder': 'G-XXXXXXXXXX',
      },
    },
    manifest: {
      'ui:description': 'Progressive Web App settings',
      theme_color: {
        'ui:widget': 'color',
      },
      background_color: {
        'ui:widget': 'color',
      },
    },
  };

  // Form event handlers
  const handleFormChange = (e: { formData: Record<string, unknown> }) => {
    setFormData(e.formData);
    setError(null);
    setSuccess(null);
  };

  const handleFormSubmit = (e: FormSubmissionData) => {
    saveWebsiteConfig(e);
  };

  const handleFormError = (errors: unknown[]) => {
    console.log('Form validation errors:', errors);
    const errorMessages = errors
      .map((error) => {
        const errorObj = error as { property?: string; message?: string };
        return `${errorObj.property || 'field'}: ${errorObj.message || 'invalid value'}`;
      })
      .join(', ');
    setError(`Please fix the following errors: ${errorMessages}`);
  };

  // Load data on mount
  useEffect(() => {
    loadSchema();
    loadWebsiteData();
  }, [state.websiteName]);

  if (loading) {
    return (
      <div style={{ padding: '20px' }}>
        <h3>Website Configuration</h3>
        <p style={{ color: 'var(--text-secondary)' }}>Loading configuration editor...</p>
      </div>
    );
  }

  if (!schema) {
    return (
      <div style={{ padding: '20px' }}>
        <h3>Website Configuration</h3>
        <div style={{ color: 'var(--error-color)' }}>{error || 'Failed to load configuration schema'}</div>
        <button
          onClick={loadSchema}
          style={{
            marginTop: '12px',
            padding: '8px 16px',
            background: 'var(--button-bg)',
            border: '1px solid var(--border-primary)',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        padding: '20px',
        background: 'var(--bg-primary)',
      }}
    >
      <div style={{ marginBottom: '20px' }}>
        <h3
          style={{
            margin: '0 0 10px 0',
            color: 'var(--text-primary)',
            fontSize: '18px',
            fontWeight: 600,
          }}
        >
          Website Configuration
        </h3>
        <p
          style={{
            margin: '0',
            color: 'var(--text-secondary)',
            fontSize: '14px',
          }}
        >
          Configure your website settings, metadata, and features using this powerful schema-driven editor.
        </p>
      </div>

      {error && (
        <div
          style={{
            background: 'var(--error-color)',
            color: 'white',
            padding: '12px',
            borderRadius: '6px',
            marginBottom: '20px',
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          style={{
            background: '#28a745',
            color: 'white',
            padding: '12px',
            borderRadius: '6px',
            marginBottom: '20px',
            fontSize: '14px',
          }}
        >
          {success}
        </div>
      )}

      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '8px',
          padding: '20px',
        }}
      >
        <Form
          schema={schema}
          uiSchema={uiSchema}
          formData={formData}
          validator={validator}
          onChange={handleFormChange}
          onSubmit={handleFormSubmit}
          onError={handleFormError}
          disabled={saving}
        >
          <button
            type="submit"
            disabled={saving}
            style={{
              background: saving ? 'var(--button-disabled)' : '#007bff',
              color: 'white',
              border: 'none',
              padding: '12px 24px',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: saving ? 'not-allowed' : 'pointer',
              marginTop: '20px',
            }}
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </Form>
      </div>
    </div>
  );
};

export default WebsiteConfigEditor;
