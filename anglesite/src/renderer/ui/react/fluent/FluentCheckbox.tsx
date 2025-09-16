// ABOUTME: Lazy-loading wrapper for Fluent UI checkbox component
// ABOUTME: Provides checkbox input with Fluent UI styling

import React, { useEffect, useState } from 'react';
import { initializeFluentUI } from './index';

interface FluentCheckboxProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onChange'> {
  /** Whether the checkbox is checked */
  checked?: boolean;
  /** Label text displayed next to checkbox */
  label?: string;
  /** Whether the checkbox is disabled */
  disabled?: boolean;
  /** Whether the checkbox is required */
  required?: boolean;
  /** Indeterminate state (partially checked) */
  indeterminate?: boolean;
  /** Size variant */
  size?: 'small' | 'medium' | 'large';
  /** Change handler */
  onChange?: (checked: boolean) => void;
}

export const FluentCheckbox: React.FC<FluentCheckboxProps> = ({ onChange, label, ...props }) => {
  const [isReady, setIsReady] = useState(false);
  const checkboxRef = React.useRef<HTMLElement>(null);

  useEffect(() => {
    let isMounted = true;

    const loadFluentUI = async () => {
      try {
        await initializeFluentUI();
        if (isMounted) {
          setIsReady(true);
        }
      } catch (error) {
        console.error('Failed to load Fluent UI:', error);
        if (isMounted) {
          setIsReady(true);
        }
      }
    };

    loadFluentUI();

    return () => {
      isMounted = false;
    };
  }, []);

  // Handle the onChange event using ref
  useEffect(() => {
    if (isReady && onChange && checkboxRef.current) {
      const handler = (e: Event) => {
        const target = e.target as HTMLInputElement;
        onChange(target.checked);
      };
      checkboxRef.current.addEventListener('change', handler);
      return () => checkboxRef.current?.removeEventListener('change', handler);
    }
  }, [isReady, onChange]);

  if (!isReady) {
    // Show loading state with native checkbox
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: '12px',
          opacity: 0.7,
        }}
      >
        <input
          type="checkbox"
          checked={props.checked}
          disabled
          style={{
            marginRight: '8px',
            ...props.style,
          }}
        />
        {label && (
          <label
            style={{
              fontSize: '14px',
              color: 'var(--text-primary)',
            }}
          >
            {label}
            {props.required && <span style={{ color: 'var(--error-color, red)' }}> *</span>}
          </label>
        )}
      </div>
    );
  }

  // Generate unique ID if not provided
  const checkboxId = props.id || `checkbox-${Math.random().toString(36).slice(2, 11)}`;

  // Cast props to work with JSX intrinsic elements
  const fluentProps: React.HTMLAttributes<HTMLElement> &
    Partial<FluentCheckboxProps> & { ref?: React.Ref<HTMLElement> } = {
    ...props,
    id: checkboxId,
    ref: checkboxRef,
  };

  // Remove React-specific props that shouldn't be passed to web component
  delete fluentProps.onChange;
  delete fluentProps.label;

  return (
    <div style={{ marginBottom: '12px' }}>
      {React.createElement(
        'fluent-checkbox',
        fluentProps,
        label && (
          <>
            {label}
            {props.required && <span style={{ color: 'var(--error-color, red)' }}> *</span>}
          </>
        )
      )}
    </div>
  );
};
