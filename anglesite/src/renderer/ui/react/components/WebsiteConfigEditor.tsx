import React, { useState, useEffect, FormEvent } from 'react';
import Form, { IChangeEvent } from '@rjsf/core';
import { RJSFSchema, RJSFValidationError, ValidatorType } from '@rjsf/utils';
import validator from '@rjsf/validator-ajv8';
import { useAppContext } from '../context/AppContext';
import { logger } from '../../../utils/logger';
import { ErrorBoundary } from './ErrorBoundary';

interface WebsiteConfigEditorProps {
  onSave?: (data: Record<string, unknown>) => void;
  onError?: (error: string) => void;
}

const WebsiteConfigEditorInner: React.FC<WebsiteConfigEditorProps> = ({ onSave, onError }) => {
  const { state } = useAppContext();

  logger.debug('WebsiteConfigEditor', 'Component initializing', {
    websiteName: state.websiteName,
    websitePath: state.websitePath,
    loading: state.loading,
    currentView: state.currentView,
  });

  const [schema, setSchema] = useState<RJSFSchema | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [initialData, setInitialData] = useState<Record<string, unknown> | null>(null);

  // Load the website schema
  const loadSchema = async () => {
    logger.debug('WebsiteConfigEditor', 'loadSchema called', { websiteName: state.websiteName });

    if (!state.websiteName) {
      logger.warn('WebsiteConfigEditor', 'Cannot load schema - no websiteName');
      setError('No website loaded');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setSchemaError(null);

      logger.debug('WebsiteConfigEditor', 'Loading website schema via IPC', { websiteName: state.websiteName });

      // Use IPC to load schema from file system
      let websiteSchema: RJSFSchema;

      try {
        const schemaResult = await window.electronAPI?.invoke('get-website-schema', state.websiteName);

        const result = schemaResult as {
          schema?: RJSFSchema;
          error?: string;
          warnings?: string[];
          fallbackSchema?: RJSFSchema;
        };
        if (result?.schema) {
          websiteSchema = result.schema;
          logger.info('WebsiteConfigEditor', 'Schema loaded successfully from file system');

          // Show warnings if any modules failed to load
          if (result.warnings && Array.isArray(result.warnings) && result.warnings.length > 0) {
            logger.warn('WebsiteConfigEditor', 'Schema loading warnings', { warnings: result.warnings });
            setError(`Schema loaded with warnings: ${result.warnings.join(', ')}`);
          }
        } else if (result?.error) {
          logger.warn('WebsiteConfigEditor', 'Schema loading failed, using fallback', {
            error: result.error,
          });
          setSchemaError(`Schema loading failed: ${result.error}`);
          websiteSchema = result.fallbackSchema || getEmbeddedSchema();
        } else {
          throw new Error('Invalid schema response from IPC');
        }
      } catch (err) {
        logger.error('WebsiteConfigEditor', 'IPC schema loading failed', err);
        setError(`Failed to load schema via IPC: ${(err as Error).message}. Using embedded fallback.`);
        websiteSchema = getEmbeddedSchema();
      }

      setSchema(websiteSchema);
    } catch (err) {
      logger.error('WebsiteConfigEditor', 'Failed to load schema', err);
      setError('Failed to load website configuration schema');
    } finally {
      setLoading(false);
    }
  };

  // Load existing website.json data
  const loadWebsiteData = async () => {
    logger.debug('WebsiteConfigEditor', 'loadWebsiteData called', { websiteName: state.websiteName });

    if (!state.websiteName) {
      logger.warn('WebsiteConfigEditor', 'Cannot load data - no websiteName');
      return;
    }

    try {
      const existingContent = await window.electronAPI?.invoke(
        'get-file-content',
        state.websiteName,
        'src/_data/website.json'
      );

      if (existingContent && typeof existingContent === 'string') {
        const data = JSON.parse(existingContent);
        setFormData(data);
        setInitialData(data);
        setHasUnsavedChanges(false);
      } else {
        // Set defaults
        const defaults = {
          title: state.websiteName || 'My Website',
          language: 'en',
        };
        setFormData(defaults);
        setInitialData(defaults);
        setHasUnsavedChanges(false);
      }
    } catch {
      logger.info('WebsiteConfigEditor', 'No existing website.json found, using defaults');
      const defaults = {
        title: state.websiteName || 'My Website',
        language: 'en',
      };
      setFormData(defaults);
      setInitialData(defaults);
      setHasUnsavedChanges(false);
    }
  };

  // Save website configuration
  const saveWebsiteConfig = async (data: Record<string, unknown>) => {
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
        setInitialData(data);
        setHasUnsavedChanges(false);
        onSave?.(data);

        // Clear success message after 5 seconds
        setTimeout(() => setSuccess(null), 5000);
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

  // Get embedded schema fallback (enhanced version)
  const getEmbeddedSchema = (): RJSFSchema => ({
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Website Configuration (Fallback)',
    description: 'Basic website configuration schema - enhanced fallback when full schema is unavailable',
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
      // Basic analytics (simplified)
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
      // Basic manifest (simplified)
      manifest: {
        type: 'object',
        title: 'Progressive Web App',
        description: 'Settings for Progressive Web App features',
        properties: {
          name: {
            type: 'string',
            title: 'App Name',
            description: 'Name for the Progressive Web App manifest',
          },
          short_name: {
            type: 'string',
            title: 'Short Name',
            description: 'Short name for the PWA (12 characters or less)',
            maxLength: 12,
          },
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
          display: {
            type: 'string',
            title: 'Display Mode',
            description: 'How the PWA should be displayed',
            enum: ['fullscreen', 'standalone', 'minimal-ui', 'browser'],
            default: 'standalone',
          },
        },
      },
      // Basic feeds configuration (simplified)
      feeds: {
        type: 'object',
        title: 'RSS/Atom Feeds',
        description: 'Configure RSS and Atom feed generation',
        properties: {
          enabled: {
            type: 'boolean',
            title: 'Enable Feeds',
            description: 'Generate RSS/Atom feeds for your content',
            default: false,
          },
        },
      },
      // Basic robots configuration (simplified)
      robots: {
        type: 'array',
        title: 'Robots.txt Rules',
        description: 'Configure search engine crawler rules',
        items: {
          type: 'object',
          properties: {
            'User-agent': {
              type: 'string',
              title: 'User Agent',
              default: '*',
            },
            Allow: {
              type: 'array',
              title: 'Allowed Paths',
              items: { type: 'string' },
            },
            Disallow: {
              type: 'array',
              title: 'Disallowed Paths',
              items: { type: 'string' },
            },
          },
        },
        default: [
          {
            'User-agent': '*',
            Allow: ['/'],
          },
        ],
      },
    },
  });

  // Enhanced UI Schema for better form rendering and organization
  const getUiSchema = (schema: RJSFSchema) => {
    const baseUiSchema: Record<string, unknown> = {
      'ui:order': [
        'title',
        'description',
        'url',
        'language',
        'author',
        'social',
        'analytics',
        'manifest',
        'feeds',
        'robots',
        '*',
      ],

      title: {
        'ui:placeholder': 'Enter your website title',
        'ui:help': 'This appears in browser tabs and search results',
      },
      description: {
        'ui:widget': 'textarea',
        'ui:options': {
          rows: 3,
        },
        'ui:placeholder': 'Brief description of your website (max 160 characters for SEO)',
      },
      url: {
        'ui:placeholder': 'https://example.com',
        'ui:help': 'Must use HTTPS for security and SEO benefits',
      },
      language: {
        'ui:help': 'ISO 639-1 language code (e.g., en, es, fr, de)',
      },
      author: {
        'ui:title': '👤 Author Information',
        'ui:description': 'Information about you or your organization',
        'ui:options': {
          removable: false,
        },
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
        'ui:title': '🔗 Social Media Profiles',
        'ui:description': 'Connect your social media accounts for better integration',
        'ui:options': {
          removable: false,
        },
        twitter: {
          'ui:placeholder': 'username',
          'ui:help': 'Without the @ symbol',
        },
        github: {
          'ui:placeholder': 'username',
        },
        linkedin: {
          'ui:placeholder': 'https://linkedin.com/in/username',
        },
      },
      analytics: {
        'ui:title': '📊 Analytics & Tracking',
        'ui:description': "Track your website's performance and visitor behavior",
        'ui:options': {
          removable: false,
        },
        google: {
          'ui:placeholder': 'G-XXXXXXXXXX',
          'ui:help': 'From Google Analytics',
        },
      },
      manifest: {
        'ui:title': '📱 Progressive Web App',
        'ui:description': 'Make your website installable as a mobile app',
        'ui:options': {
          removable: false,
        },
        name: {
          'ui:placeholder': 'My Awesome App',
        },
        short_name: {
          'ui:placeholder': 'MyApp',
          'ui:help': '12 characters or less for mobile icons',
        },
        theme_color: {
          'ui:widget': 'color',
          'ui:help': 'Primary brand color',
        },
        background_color: {
          'ui:widget': 'color',
          'ui:help': 'Splash screen background',
        },
        display: {
          'ui:help': 'How the app appears when launched',
        },
      },
    };

    // Add UI configuration for additional properties from full schema
    if (schema.properties) {
      if (schema.properties.feeds) {
        baseUiSchema.feeds = {
          'ui:title': '📡 RSS/Atom Feeds',
          'ui:description': 'Syndicate your content via feeds',
          'ui:options': {
            removable: false,
          },
        };
      }

      if (schema.properties.robots) {
        baseUiSchema.robots = {
          'ui:title': '🤖 Search Engine Rules',
          'ui:description': 'Configure how search engines crawl your site',
          'ui:options': {
            orderable: true,
          },
          items: {
            'ui:options': {
              removable: true,
            },
          },
        };
      }

      // Add configuration for complex full-schema properties
      if (schema.properties.headers) {
        baseUiSchema.headers = {
          'ui:title': '🔒 Security Headers',
          'ui:description': 'Configure HTTP security headers',
        };
      }

      if (schema.properties.rsl) {
        baseUiSchema.rsl = {
          'ui:title': '⚖️ Rights & Standards',
          'ui:description': 'Configure content licensing and usage rights',
        };
      }
    }

    return baseUiSchema;
  };

  // Form event handlers
  const handleFormChange = (data: IChangeEvent<Record<string, unknown>, RJSFSchema, Record<string, unknown>>) => {
    if (data.formData) {
      setFormData(data.formData);
    }
    setError(null);
    setSuccess(null);

    // Check if data has changed
    if (data.formData) {
      const hasChanges = JSON.stringify(data.formData) !== JSON.stringify(initialData);
      setHasUnsavedChanges(hasChanges);
    }
  };

  const handleFormSubmit = (
    data: IChangeEvent<Record<string, unknown>, RJSFSchema, Record<string, unknown>>,
    event: FormEvent<HTMLFormElement>
  ) => {
    // Prevent default form submission
    event.preventDefault();
    if (data.formData) {
      saveWebsiteConfig(data.formData);
    }
  };

  const handleFormError = (errors: RJSFValidationError[]) => {
    logger.warn('WebsiteConfigEditor', 'Form validation errors', { errors });
    const errorMessages = errors.map((error) => `${error.property || 'field'}: ${error.message}`).join(', ');
    setError(`Please fix the following errors: ${errorMessages}`);
  };

  // Load data on mount
  useEffect(() => {
    loadSchema();
    loadWebsiteData();
  }, [state.websiteName]);

  // Handle before unload - warn about unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+S or Ctrl+S to save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (hasUnsavedChanges && !saving) {
          saveWebsiteConfig(formData);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hasUnsavedChanges, saving, formData]);

  // Early return if websiteName is not available - but AFTER hooks are defined
  if (!state.websiteName) {
    logger.debug('WebsiteConfigEditor', 'No website name available, showing loading state');
    return (
      <div style={{ padding: '20px' }}>
        <h3>Website Configuration</h3>
        <p style={{ color: 'var(--text-secondary)' }}>Waiting for website to load...</p>
        <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          Debug: websiteName={state.websiteName || 'undefined'}, loading={state.loading}
        </div>
      </div>
    );
  }

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3
            style={{
              margin: '0',
              color: 'var(--text-primary)',
              fontSize: '18px',
              fontWeight: 600,
            }}
          >
            Website Configuration
          </h3>
          {hasUnsavedChanges && (
            <span
              style={{
                fontSize: '12px',
                color: 'var(--warning-color, #f0ad4e)',
                fontWeight: 500,
              }}
            >
              ● Unsaved changes
            </span>
          )}
        </div>
        {(error || schemaError) && (
          <div
            style={{
              margin: '8px 0',
              padding: '8px 12px',
              background: 'var(--error-bg, #ffeaea)',
              border: '1px solid var(--error-border, #ffb3b3)',
              borderRadius: '4px',
              color: 'var(--error-color)',
              fontSize: '14px',
            }}
          >
            {schemaError && <div>{schemaError}</div>}
            {error && <div>{error}</div>}
          </div>
        )}
        <p
          style={{
            margin: '0',
            color: 'var(--text-secondary)',
            fontSize: '14px',
          }}
        >
          Configure your website settings, metadata, and features using this powerful schema-driven editor.
          {hasUnsavedChanges && (
            <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              (Press Cmd+S or Ctrl+S to save)
            </span>
          )}
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
          uiSchema={getUiSchema(schema)}
          formData={formData}
          validator={validator as ValidatorType}
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
              opacity: !hasUnsavedChanges && !saving ? 0.7 : 1,
            }}
            title={hasUnsavedChanges ? 'Save changes (Cmd+S)' : 'No changes to save'}
          >
            {saving ? 'Saving...' : hasUnsavedChanges ? 'Save Configuration' : 'Configuration Saved'}
          </button>
        </Form>
      </div>
    </div>
  );
};

// Wrap with error boundary
export const WebsiteConfigEditor: React.FC<WebsiteConfigEditorProps> = (props) => (
  <ErrorBoundary componentName="WebsiteConfigEditor">
    <WebsiteConfigEditorInner {...props} />
  </ErrorBoundary>
);

export default WebsiteConfigEditor;
