// ABOUTME: Lazy-loading wrapper for Fluent UI button component
// ABOUTME: Ensures Fluent UI is initialized before rendering the button

import React, { useEffect, useState } from 'react';
import { initializeFluentUI } from './index';

/**
 * Props for the FluentButton component
 * Extends HTMLAttributes to support standard HTML element attributes
 */
interface FluentButtonProps extends React.HTMLAttributes<HTMLElement> {
  /** Visual appearance variant of the button */
  appearance?: 'accent' | 'lightweight' | 'neutral' | 'outline' | 'stealth' | 'subtle';
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Size variant of the button */
  size?: 'small' | 'medium' | 'large';
  /** Shape variant for icon buttons */
  shape?: 'circular' | 'square';
  /** Button content - text, icons, or other React elements */
  children: React.ReactNode;
}

/**
 * Lazy-loading wrapper for Microsoft Fluent UI Button component
 *
 * This component ensures Fluent UI Web Components are initialized before rendering.
 * Shows a loading state with fallback styling while components load asynchronously.
 * @example
 * ```tsx
 * <FluentButton
 *   appearance="accent"
 *   onClick={() => console.log('clicked')}
 * >
 *   Click Me
 * </FluentButton>
 * ```
 * @example
 * ```tsx
 * <FluentButton
 *   appearance="outline"
 *   size="large"
 *   disabled
 * >
 *   Disabled Button
 * </FluentButton>
 * ```
 * @param props FluentButton properties
 * @param props.children Content to display inside the button
 * @returns React component that renders a Fluent UI button
 */
export const FluentButton: React.FC<FluentButtonProps> = ({ children, ...props }) => {
  const [isReady, setIsReady] = useState(false);

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
        // Fallback to regular button
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

  if (!isReady) {
    // Show loading state with native button
    return (
      <button
        {...props}
        style={{
          padding: '8px 16px',
          background: 'var(--button-bg, #0078d4)',
          color: 'white',
          border: '1px solid var(--border-primary, #0078d4)',
          borderRadius: '4px',
          cursor: 'pointer',
          opacity: 0.7,
          ...props.style,
        }}
        disabled={props.disabled}
      >
        {children}
      </button>
    );
  }

  // Cast props to work with JSX intrinsic elements
  const fluentProps = props as React.HTMLAttributes<HTMLElement> & FluentButtonProps;

  return React.createElement('fluent-button', fluentProps, children);
};
