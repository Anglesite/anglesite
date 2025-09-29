// ABOUTME: Lazy-loading wrapper for Fluent UI text field component
// ABOUTME: Provides text input with Fluent UI styling and validation support

import React, { useEffect, useState } from 'react';
import { initializeFluentUI } from './index';

interface FluentTextFieldProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onInput'> {
  /** The input value */
  value?: string;
  /** Placeholder text when empty */
  placeholder?: string;
  /** Label displayed above the field */
  label?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Whether the field is read-only */
  readonly?: boolean;
  /** Error message to display */
  errorMessage?: string;
  /** Input type (text, email, password, etc.) */
  type?: string;
  /** Maximum length of input */
  maxlength?: number;
  /** Size variant */
  size?: 'small' | 'medium' | 'large';
  /** Visual appearance */
  appearance?: 'outline' | 'filled' | 'underline';
  /** Change handler */
  onInput?: (event: Event) => void;
}

export const FluentTextField: React.FC<FluentTextFieldProps> = ({ children, onInput, ...props }) => {
  const [isReady, setIsReady] = useState(false);
  const fieldRef = React.useRef<HTMLElement>(null);

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

  // Handle the onInput event using ref
  useEffect(() => {
    if (isReady && onInput && fieldRef.current) {
      const handler = (e: Event) => onInput(e);
      fieldRef.current.addEventListener('input', handler);
      return () => fieldRef.current?.removeEventListener('input', handler);
    }
  }, [isReady, onInput]);

  if (!isReady) {
    // Show loading state with native input
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
        <input
          type={props.type || 'text'}
          value={props.value}
          placeholder={props.placeholder}
          data-testid={props['data-testid']}
          onChange={props.onChange}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid var(--border-primary)',
            borderRadius: '4px',
            fontSize: '14px',
            opacity: 0.7,
            ...props.style,
          }}
        />
      </div>
    );
  }

  // Generate unique ID if not provided
  const fieldId = props.id || `field-${Math.random().toString(36).slice(2, 11)}`;

  // Cast props to work with JSX intrinsic elements
  const fluentProps: React.HTMLAttributes<HTMLElement> &
    Partial<FluentTextFieldProps> & { ref?: React.Ref<HTMLElement> } = {
    ...props,
    id: fieldId,
    ref: fieldRef,
  };

  // Remove React-specific props that shouldn't be passed to web component
  delete fluentProps.onInput;
  delete fluentProps.errorMessage;
  delete fluentProps.label;

  return (
    <div style={{ marginBottom: '16px' }}>
      {props.label && (
        <label
          htmlFor={fieldId}
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
      {React.createElement('fluent-text-field', fluentProps, children)}
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
