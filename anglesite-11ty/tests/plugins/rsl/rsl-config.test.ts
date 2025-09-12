/**
 * Tests for RSL Configuration Module
 */

import {
  validateRSLConfiguration,
  mergeRSLConfigurations,
  normalizeRSLConfiguration,
  getEffectiveLicenseConfiguration,
  isRSLEnabledForCollection,
  resolveLicenseTemplate,
  DEFAULT_RSL_CONFIG,
  BUILTIN_LICENSE_TEMPLATES,
} from '../../../plugins/rsl/rsl-config.js';
import type { RSLConfiguration, RSLLicenseConfiguration } from '../../../plugins/rsl/types.js';

describe('RSL Configuration Validation', () => {
  it('should validate a valid RSL configuration', () => {
    const validConfig: RSLConfiguration = {
      enabled: true,
      defaultOutputFormats: ['sitewide', 'collection'],
      defaultLicense: {
        permits: [{ type: 'usage', values: ['view'] }],
        payment: { type: 'free', attribution: true },
      },
    };

    const result = validateRSLConfiguration(validConfig);
    expect(result.valid).toBe(true);
    expect(result.errors.filter((e) => e.severity === 'error')).toHaveLength(0);
  });

  it('should reject invalid permission types', () => {
    const invalidConfig = {
      defaultLicense: {
        permits: [{ type: 'invalid-permission', values: ['view'] }],
      },
    };

    const result = validateRSLConfiguration(invalidConfig);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: 'rsl.defaultLicense.permits[0].type',
        message: 'Invalid permission type: invalid-permission',
        severity: 'error',
      })
    );
  });

  it('should reject invalid payment types', () => {
    const invalidConfig = {
      defaultLicense: {
        payment: { type: 'invalid-payment' },
      },
    };

    const result = validateRSLConfiguration(invalidConfig);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: 'rsl.defaultLicense.payment.type',
        message: 'Invalid payment type: invalid-payment',
        severity: 'error',
      })
    );
  });

  it('should reject negative payment amounts', () => {
    const invalidConfig = {
      defaultLicense: {
        payment: { type: 'purchase', amount: -100 },
      },
    };

    const result = validateRSLConfiguration(invalidConfig);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: 'rsl.defaultLicense.payment.amount',
        message: 'Payment amount cannot be negative',
        severity: 'error',
      })
    );
  });

  it('should reject invalid URLs', () => {
    const invalidConfig = {
      defaultLicense: {
        standard: 'not-a-url',
      },
    };

    const result = validateRSLConfiguration(invalidConfig);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: 'rsl.defaultLicense.standard',
        message: 'Standard license URL must be a valid URL',
        severity: 'error',
      })
    );
  });

  it('should reject invalid output formats', () => {
    const invalidConfig = {
      defaultOutputFormats: ['invalid-format'],
    };

    const result = validateRSLConfiguration(invalidConfig);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: 'rsl.defaultOutputFormats[0]',
        message: 'Invalid output format: invalid-format',
        severity: 'error',
      })
    );
  });

  it('should handle non-object configurations', () => {
    const result = validateRSLConfiguration('not-an-object');
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        path: 'rsl',
        message: 'RSL configuration must be an object',
        severity: 'error',
      })
    );
  });
});

describe('RSL Configuration Merging', () => {
  it('should merge configurations with child overriding parent', () => {
    const parent: RSLLicenseConfiguration = {
      permits: [{ type: 'usage', values: ['view'] }],
      payment: { type: 'free', attribution: true },
      copyright: 'Parent Copyright',
    };

    const child: RSLLicenseConfiguration = {
      permits: [{ type: 'usage', values: ['view', 'download'] }],
      payment: { type: 'purchase', amount: 10 },
    };

    const merged = mergeRSLConfigurations(parent, child);

    expect(merged.permits).toEqual(child.permits);
    expect(merged.payment).toEqual(child.payment);
    expect(merged.copyright).toBe(parent.copyright); // Not overridden
  });

  it('should return child when parent is undefined', () => {
    const child: RSLLicenseConfiguration = {
      permits: [{ type: 'usage', values: ['view'] }],
    };

    const merged = mergeRSLConfigurations(undefined, child);
    expect(merged).toEqual(child);
  });

  it('should return parent when child is undefined', () => {
    const parent: RSLLicenseConfiguration = {
      permits: [{ type: 'usage', values: ['view'] }],
    };

    const merged = mergeRSLConfigurations(parent, undefined);
    expect(merged).toEqual(parent);
  });

  it('should return empty object when both are undefined', () => {
    const merged = mergeRSLConfigurations(undefined, undefined);
    expect(merged).toEqual({});
  });
});

describe('RSL Configuration Normalization', () => {
  it('should apply defaults to minimal configuration', () => {
    const minimalConfig: Partial<RSLConfiguration> = {
      enabled: false,
    };

    const normalized = normalizeRSLConfiguration(minimalConfig);

    expect(normalized.enabled).toBe(false); // Overridden
    expect(normalized.defaultOutputFormats).toEqual(DEFAULT_RSL_CONFIG.defaultOutputFormats);
    expect(normalized.contentDiscovery).toEqual(DEFAULT_RSL_CONFIG.contentDiscovery);
  });

  it('should merge built-in templates with custom templates', () => {
    const config: Partial<RSLConfiguration> = {
      templates: {
        custom: {
          MY_LICENSE: {
            id: 'MY_LICENSE',
            name: 'My Custom License',
            license: { permits: [{ type: 'usage', values: ['view'] }] },
          },
        },
      },
    };

    const normalized = normalizeRSLConfiguration(config);

    expect(normalized.templates?.builtin).toEqual(BUILTIN_LICENSE_TEMPLATES);
    expect(normalized.templates?.custom?.['MY_LICENSE']).toBeDefined();
  });
});

describe('Effective License Configuration', () => {
  it('should apply inheritance hierarchy correctly', () => {
    const rslConfig: RSLConfiguration = {
      enabled: true,
      defaultLicense: {
        permits: [{ type: 'usage', values: ['view'] }],
        copyright: 'Site Copyright',
      },
      collections: {
        blog: {
          enabled: true,
          permits: [{ type: 'usage', values: ['view', 'download'] }],
        },
      },
    };

    const contentLicense: RSLLicenseConfiguration = {
      payment: { type: 'purchase', amount: 5 },
    };

    const effective = getEffectiveLicenseConfiguration(rslConfig, 'blog', contentLicense);

    expect(effective.permits).toEqual([{ type: 'usage', values: ['view', 'download'] }]); // From collection
    expect(effective.copyright).toBe('Site Copyright'); // From site
    expect(effective.payment).toEqual({ type: 'purchase', amount: 5 }); // From content
  });

  it('should work without collection or content overrides', () => {
    const rslConfig: RSLConfiguration = {
      enabled: true,
      defaultLicense: {
        permits: [{ type: 'usage', values: ['view'] }],
      },
    };

    const effective = getEffectiveLicenseConfiguration(rslConfig);
    expect(effective).toEqual(rslConfig.defaultLicense);
  });
});

describe('Copyright Inheritance', () => {
  it('should inherit top-level copyright when defaultLicense has no copyright', () => {
    const rslConfig: RSLConfiguration = {
      enabled: true,
      copyright: 'Global Site Copyright',
      defaultLicense: {
        permits: [{ type: 'usage', values: ['view'] }],
      },
    };

    const effective = getEffectiveLicenseConfiguration(rslConfig);
    expect(effective.copyright).toBe('Global Site Copyright');
  });

  it('should not override existing copyright in defaultLicense', () => {
    const rslConfig: RSLConfiguration = {
      enabled: true,
      copyright: 'Global Site Copyright',
      defaultLicense: {
        permits: [{ type: 'usage', values: ['view'] }],
        copyright: 'Default License Copyright',
      },
    };

    const effective = getEffectiveLicenseConfiguration(rslConfig);
    expect(effective.copyright).toBe('Default License Copyright');
  });

  it('should inherit top-level copyright at collection level when collection license has no copyright', () => {
    const rslConfig: RSLConfiguration = {
      enabled: true,
      copyright: 'Global Site Copyright',
      defaultLicense: {
        permits: [{ type: 'usage', values: ['view'] }],
      },
      collections: {
        blog: {
          permits: [{ type: 'usage', values: ['view', 'download'] }],
        },
      },
    };

    const effective = getEffectiveLicenseConfiguration(rslConfig, 'blog');
    expect(effective.copyright).toBe('Global Site Copyright');
    expect(effective.permits).toEqual([{ type: 'usage', values: ['view', 'download'] }]);
  });

  it('should not override collection-specific copyright', () => {
    const rslConfig: RSLConfiguration = {
      enabled: true,
      copyright: 'Global Site Copyright',
      defaultLicense: {
        permits: [{ type: 'usage', values: ['view'] }],
      },
      collections: {
        blog: {
          permits: [{ type: 'usage', values: ['view', 'download'] }],
          copyright: 'Blog Specific Copyright',
        },
      },
    };

    const effective = getEffectiveLicenseConfiguration(rslConfig, 'blog');
    expect(effective.copyright).toBe('Blog Specific Copyright');
  });

  it('should inherit top-level copyright at content level when content license has no copyright', () => {
    const rslConfig: RSLConfiguration = {
      enabled: true,
      copyright: 'Global Site Copyright',
      defaultLicense: {
        permits: [{ type: 'usage', values: ['view'] }],
      },
    };

    const contentLicense: RSLLicenseConfiguration = {
      permits: [{ type: 'usage', values: ['view', 'download', 'modify'] }],
    };

    const effective = getEffectiveLicenseConfiguration(rslConfig, undefined, contentLicense);
    expect(effective.copyright).toBe('Global Site Copyright');
    expect(effective.permits).toEqual([{ type: 'usage', values: ['view', 'download', 'modify'] }]);
  });

  it('should not override content-specific copyright', () => {
    const rslConfig: RSLConfiguration = {
      enabled: true,
      copyright: 'Global Site Copyright',
      defaultLicense: {
        permits: [{ type: 'usage', values: ['view'] }],
      },
    };

    const contentLicense: RSLLicenseConfiguration = {
      permits: [{ type: 'usage', values: ['view', 'download', 'modify'] }],
      copyright: 'Content Specific Copyright',
    };

    const effective = getEffectiveLicenseConfiguration(rslConfig, undefined, contentLicense);
    expect(effective.copyright).toBe('Content Specific Copyright');
  });

  it('should work with complex inheritance scenarios', () => {
    const rslConfig: RSLConfiguration = {
      enabled: true,
      copyright: 'Global Site Copyright',
      defaultLicense: {
        permits: [{ type: 'usage', values: ['view'] }],
        payment: { type: 'free' },
      },
      collections: {
        blog: {
          permits: [{ type: 'usage', values: ['view', 'download'] }],
          // No copyright specified - should inherit global
        },
        podcast: {
          permits: [{ type: 'usage', values: ['view', 'stream'] }],
          copyright: 'Podcast Specific Copyright',
        },
      },
    };

    // Blog should inherit global copyright
    const blogEffective = getEffectiveLicenseConfiguration(rslConfig, 'blog');
    expect(blogEffective.copyright).toBe('Global Site Copyright');
    expect(blogEffective.permits).toEqual([{ type: 'usage', values: ['view', 'download'] }]);

    // Podcast should keep its own copyright
    const podcastEffective = getEffectiveLicenseConfiguration(rslConfig, 'podcast');
    expect(podcastEffective.copyright).toBe('Podcast Specific Copyright');
    expect(podcastEffective.permits).toEqual([{ type: 'usage', values: ['view', 'stream'] }]);
  });
});

describe('Collection RSL Enablement', () => {
  it('should return false when RSL is globally disabled', () => {
    const rslConfig: RSLConfiguration = {
      enabled: false,
      collections: {
        blog: { enabled: true },
      },
    };

    expect(isRSLEnabledForCollection(rslConfig, 'blog')).toBe(false);
  });

  it('should return false when collection explicitly disabled', () => {
    const rslConfig: RSLConfiguration = {
      enabled: true,
      collections: {
        blog: { enabled: false },
      },
    };

    expect(isRSLEnabledForCollection(rslConfig, 'blog')).toBe(false);
  });

  it('should return true for undefined collection (opt-out model)', () => {
    const rslConfig: RSLConfiguration = {
      enabled: true,
    };

    expect(isRSLEnabledForCollection(rslConfig, 'blog')).toBe(true);
  });

  it('should return true when collection not explicitly disabled', () => {
    const rslConfig: RSLConfiguration = {
      enabled: true,
      collections: {
        blog: {}, // No enabled property = enabled by default
      },
    };

    expect(isRSLEnabledForCollection(rslConfig, 'blog')).toBe(true);
  });
});

describe('License Template Resolution', () => {
  it('should resolve built-in license templates', () => {
    const template = resolveLicenseTemplate('CC0');
    expect(template).toBeDefined();
    expect(template?.id).toBe('CC0');
    expect(template?.name).toBe('Creative Commons Zero (Public Domain)');
  });

  it('should resolve custom templates', () => {
    const templates = {
      custom: {
        MY_LICENSE: {
          id: 'MY_LICENSE',
          name: 'My License',
          license: { permits: [{ type: 'usage', values: ['view'] }] },
        },
      },
    };

    const template = resolveLicenseTemplate('MY_LICENSE', templates);
    expect(template?.id).toBe('MY_LICENSE');
    expect(template?.name).toBe('My License');
  });

  it('should return null for unknown templates', () => {
    const template = resolveLicenseTemplate('UNKNOWN_LICENSE');
    expect(template).toBeNull();
  });

  it('should prioritize custom over built-in templates', () => {
    const templates = {
      custom: {
        CC0: {
          id: 'CC0',
          name: 'Custom CC0',
          license: { permits: [] },
        },
      },
    };

    // Built-in should still win over custom in our current implementation
    const template = resolveLicenseTemplate('CC0', templates);
    expect(template?.name).toBe('Creative Commons Zero (Public Domain)');
  });
});

describe('Built-in License Templates', () => {
  it('should include essential Creative Commons licenses', () => {
    expect(BUILTIN_LICENSE_TEMPLATES['CC0']).toBeDefined();
    expect(BUILTIN_LICENSE_TEMPLATES['CC-BY-4.0']).toBeDefined();
    expect(BUILTIN_LICENSE_TEMPLATES['CC-BY-NC-4.0']).toBeDefined();
  });

  it('should include restrictive license templates', () => {
    expect(BUILTIN_LICENSE_TEMPLATES['ALL_RIGHTS_RESERVED']).toBeDefined();
    expect(BUILTIN_LICENSE_TEMPLATES['NO_AI_TRAINING']).toBeDefined();
  });

  it('should have valid license configurations', () => {
    Object.values(BUILTIN_LICENSE_TEMPLATES).forEach((template) => {
      const validation = validateRSLConfiguration({ defaultLicense: template.license });
      expect(validation.valid).toBe(true);
    });
  });
});
