// ABOUTME: Lazy-loading wrapper for Fluent UI select/dropdown component
// ABOUTME: Provides dropdown selection with Fluent UI styling

import React, { useEffect, useState } from 'react';
import { initializeFluentUI } from './index';

interface FluentSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface FluentSelectProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onChange'> {
  /** The selected value */
  value?: string;
  /** Available options */
  options: FluentSelectOption[];
  /** Label displayed above the field */
  label?: string;
  /** Placeholder text when no selection */
  placeholder?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Error message to display */
  errorMessage?: string;
  /** Size variant */
  size?: 'small' | 'medium' | 'large';
  /** Visual appearance */
  appearance?: 'outline' | 'filled' | 'underline';
  /** Change handler */
  onChange?: (value: string) => void;
}

export const FluentSelect: React.FC<FluentSelectProps> = ({ options, onChange, ...props }) => {
  const [isReady, setIsReady] = useState(false);
  const selectRef = React.useRef<HTMLElement>(null);

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
    if (isReady && onChange && selectRef.current) {
      const handler = (e: Event) => {
        const target = e.target as HTMLSelectElement;
        onChange(target.value);
      };
      selectRef.current.addEventListener('change', handler);
      return () => selectRef.current?.removeEventListener('change', handler);
    }
  }, [isReady, onChange]);

  if (!isReady) {
    // Show loading state with native select
    return (
      <div style={{ marginBottom: '16px' }}>
        {props.label && (
          <label
            style={{
              display: 'block',
              marginBottom: '4px',
              fontSize: '14px',
              color: 'var(--text-primary)',
            }}
          >
            {props.label}
            {props.required && <span style={{ color: 'var(--error-color, red)' }}> *</span>}
          </label>
        )}
        <select
          value={props.value}
          disabled
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid var(--border-primary)',
            borderRadius: '4px',
            fontSize: '14px',
            opacity: 0.7,
            background: 'white',
            ...props.style,
          }}
        >
          {props.placeholder && <option value="">{props.placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // Generate unique ID if not provided
  const selectId = props.id || `select-${Math.random().toString(36).slice(2, 11)}`;

  // Cast props to work with JSX intrinsic elements
  const fluentProps = {
    ...props,
    id: selectId,
    ref: selectRef,
  } as any;

  // Remove React-specific props that shouldn't be passed to web component
  delete fluentProps.onChange;
  delete fluentProps.errorMessage;
  delete fluentProps.label;
  delete fluentProps.options;

  return (
    <div style={{ marginBottom: '16px' }}>
      {props.label && (
        <label
          htmlFor={selectId}
          style={{
            display: 'block',
            marginBottom: '4px',
            fontSize: '14px',
            color: 'var(--text-primary)',
          }}
        >
          {props.label}
          {props.required && <span style={{ color: 'var(--error-color, red)' }}> *</span>}
        </label>
      )}
      {React.createElement(
        'fluent-select',
        fluentProps,
        <>
          {props.placeholder && React.createElement('fluent-option', { value: '' }, props.placeholder)}
          {options.map((option) =>
            React.createElement(
              'fluent-option',
              {
                key: option.value,
                value: option.value,
                disabled: option.disabled,
              },
              option.label
            )
          )}
        </>
      )}
      {props.errorMessage && (
        <div
          style={{
            color: 'var(--error-color, red)',
            fontSize: '12px',
            marginTop: '4px',
          }}
        >
          {props.errorMessage}
        </div>
      )}
    </div>
  );
};
