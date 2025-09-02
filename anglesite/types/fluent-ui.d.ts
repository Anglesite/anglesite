// ABOUTME: Global TypeScript declarations for Fluent UI Web Components
// ABOUTME: Enables JSX support for all fluent-* custom elements in React

import React from 'react';

declare namespace JSX {
  interface IntrinsicElements {
    'fluent-button': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        appearance?: 'accent' | 'lightweight' | 'neutral' | 'outline' | 'stealth';
        disabled?: boolean;
        size?: 'small' | 'medium' | 'large';
        shape?: 'circular' | 'square';
      },
      HTMLElement
    >;

    'fluent-card': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;

    'fluent-text-field': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        placeholder?: string;
        value?: string;
        disabled?: boolean;
        readonly?: boolean;
        required?: boolean;
        type?: string;
        size?: 'small' | 'medium' | 'large';
      },
      HTMLElement
    >;

    'fluent-select': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        value?: string;
        disabled?: boolean;
        required?: boolean;
        size?: 'small' | 'medium' | 'large';
      },
      HTMLElement
    >;

    'fluent-option': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        value?: string;
        disabled?: boolean;
        selected?: boolean;
      },
      HTMLElement
    >;

    'fluent-checkbox': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        checked?: boolean;
        disabled?: boolean;
        required?: boolean;
        indeterminate?: boolean;
      },
      HTMLElement
    >;

    'fluent-radio': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        checked?: boolean;
        disabled?: boolean;
        required?: boolean;
        value?: string;
        name?: string;
      },
      HTMLElement
    >;

    'fluent-switch': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        checked?: boolean;
        disabled?: boolean;
        required?: boolean;
      },
      HTMLElement
    >;

    'fluent-slider': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        min?: number;
        max?: number;
        step?: number;
        value?: number;
        disabled?: boolean;
        orientation?: 'horizontal' | 'vertical';
      },
      HTMLElement
    >;

    'fluent-progress': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        value?: number;
        min?: number;
        max?: number;
        paused?: boolean;
      },
      HTMLElement
    >;

    'fluent-progress-ring': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        value?: number;
        min?: number;
        max?: number;
        paused?: boolean;
      },
      HTMLElement
    >;

    'fluent-badge': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        appearance?: 'filled' | 'ghost' | 'outline' | 'tint';
        color?: 'brand' | 'danger' | 'important' | 'informative' | 'severe' | 'subtle' | 'success' | 'warning';
        size?: 'tiny' | 'extra-small' | 'small' | 'medium' | 'large' | 'extra-large';
        shape?: 'circular' | 'rounded' | 'square';
      },
      HTMLElement
    >;

    'fluent-divider': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        orientation?: 'horizontal' | 'vertical';
        appearance?: 'default' | 'subtle' | 'brand' | 'strong';
      },
      HTMLElement
    >;

    'fluent-tabs': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        orientation?: 'horizontal' | 'vertical';
        size?: 'small' | 'medium' | 'large';
      },
      HTMLElement
    >;

    'fluent-tab': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        disabled?: boolean;
        selected?: boolean;
      },
      HTMLElement
    >;

    'fluent-tab-panel': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;

    'fluent-dialog': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        open?: boolean;
        modal?: boolean;
        'no-focus-trap'?: boolean;
      },
      HTMLElement
    >;

    'fluent-tooltip': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        position?: 'above' | 'below' | 'before' | 'after' | 'start' | 'end';
        visible?: boolean;
      },
      HTMLElement
    >;

    'fluent-accordion': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        'expand-mode'?: 'single' | 'multi';
      },
      HTMLElement
    >;

    'fluent-accordion-item': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        expanded?: boolean;
        disabled?: boolean;
      },
      HTMLElement
    >;

    'fluent-breadcrumb': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;

    'fluent-breadcrumb-item': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        href?: string;
        current?: boolean;
      },
      HTMLElement
    >;

    'fluent-menu': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;

    'fluent-menu-item': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        disabled?: boolean;
        expanded?: boolean;
        role?: string;
      },
      HTMLElement
    >;

    'fluent-tree-view': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;

    'fluent-tree-item': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        expanded?: boolean;
        disabled?: boolean;
        selected?: boolean;
      },
      HTMLElement
    >;
  }
}
