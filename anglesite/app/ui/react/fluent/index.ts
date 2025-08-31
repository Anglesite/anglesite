// ABOUTME: Fluent UI Web Components integration module for Anglesite
// ABOUTME: Configures design tokens, registers components, and provides React integration utilities

// Track initialization state to avoid duplicate loads
let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

/**
 * Lazy initialize Fluent UI Web Components design system
 * Only loads and registers components when first requested
 */
export async function initializeFluentUI(): Promise<void> {
  // Return existing promise if already initializing
  if (initializationPromise) {
    return initializationPromise;
  }

  // Return immediately if already initialized
  if (isInitialized) {
    return Promise.resolve();
  }

  // Create initialization promise
  initializationPromise = (async () => {
    try {
      // Dynamically import Fluent UI components only when needed
      const {
        fluentButton,
        fluentCard,
        fluentTextField,
        fluentSelect,
        fluentOption,
        fluentCheckbox,
        fluentRadio,
        fluentSwitch,
        fluentSlider,
        fluentProgress,
        fluentProgressRing,
        fluentBadge,
        fluentDivider,
        fluentTab,
        fluentTabPanel,
        fluentTabs,
        fluentDialog,
        fluentTooltip,
        fluentAccordion,
        fluentAccordionItem,
        fluentBreadcrumb,
        fluentBreadcrumbItem,
        fluentMenu,
        fluentMenuItem,
        fluentTreeView,
        fluentTreeItem,
        provideFluentDesignSystem
      } = await import('@fluentui/web-components');

      // Register all components with the design system
      provideFluentDesignSystem().register(
        // Form Controls
        fluentButton(),
        fluentTextField(),
        fluentSelect(),
        fluentOption(),
        fluentCheckbox(),
        fluentRadio(),
        fluentSwitch(),
        fluentSlider(),

        // Layout & Content
        fluentCard(),
        fluentDivider(),
        fluentAccordion(),
        fluentAccordionItem(),

        // Navigation
        fluentTab(),
        fluentTabPanel(),
        fluentTabs(),
        fluentBreadcrumb(),
        fluentBreadcrumbItem(),
        fluentMenu(),
        fluentMenuItem(),
        fluentTreeView(),
        fluentTreeItem(),

        // Feedback
        fluentProgress(),
        fluentProgressRing(),
        fluentBadge(),
        fluentTooltip(),
        fluentDialog()
      );

      isInitialized = true;
    } catch (error) {
      console.warn('Fluent UI Web Components initialization failed:', error);
      // Reset promise to allow retry
      initializationPromise = null;
      throw error;
    }
  })();

  return initializationPromise;
}

/**
 * React hook for accessing Fluent design tokens
 * Returns commonly used design tokens for inline styling
 */
export function useFluentTokens() {
  return {
    colors: {
      primary: 'var(--accent-fill-rest)',
      primaryHover: 'var(--accent-fill-hover)',
      primaryActive: 'var(--accent-fill-active)',
      text: 'var(--neutral-foreground-rest)',
      textSecondary: 'var(--neutral-foreground-hint)',
      background: 'var(--neutral-fill-rest)',
      backgroundHover: 'var(--neutral-fill-hover)',
      border: 'var(--neutral-stroke-rest)',
      error: 'var(--error-fill-rest)',
      success: 'var(--success-fill-rest)',
      warning: 'var(--warning-fill-rest)',
    },
    spacing: {
      xs: 'var(--design-unit)',
      sm: 'calc(var(--design-unit) * 2)',
      md: 'calc(var(--design-unit) * 3)',
      lg: 'calc(var(--design-unit) * 4)',
      xl: 'calc(var(--design-unit) * 6)',
    },
    typography: {
      fontFamily: 'var(--body-font)',
      fontSizeBase: 'var(--type-ramp-base-font-size)',
      fontSizePlus1: 'var(--type-ramp-plus-1-font-size)',
      fontSizeMinus1: 'var(--type-ramp-minus-1-font-size)',
      lineHeight: 'var(--type-ramp-base-line-height)',
    },
    borderRadius: {
      small: 'var(--control-corner-radius)',
      medium: 'calc(var(--control-corner-radius) * 2)',
      large: 'calc(var(--control-corner-radius) * 3)',
    },
  };
}

/**
 * Component names for Fluent UI Web Components
 * Use these constants to ensure consistent naming
 */
export const FluentComponents = {
  Button: 'fluent-button',
  Card: 'fluent-card',
  TextField: 'fluent-text-field',
  Select: 'fluent-select',
  Option: 'fluent-option',
  Checkbox: 'fluent-checkbox',
  Radio: 'fluent-radio',
  Switch: 'fluent-switch',
  Slider: 'fluent-slider',
  Progress: 'fluent-progress',
  ProgressRing: 'fluent-progress-ring',
  Badge: 'fluent-badge',
  Divider: 'fluent-divider',
  Tab: 'fluent-tab',
  TabPanel: 'fluent-tab-panel',
  Tabs: 'fluent-tabs',
  Dialog: 'fluent-dialog',
  Tooltip: 'fluent-tooltip',
  Accordion: 'fluent-accordion',
  AccordionItem: 'fluent-accordion-item',
  Breadcrumb: 'fluent-breadcrumb',
  BreadcrumbItem: 'fluent-breadcrumb-item',
  Menu: 'fluent-menu',
  MenuItem: 'fluent-menu-item',
  TreeView: 'fluent-tree-view',
  TreeItem: 'fluent-tree-item',
} as const;
