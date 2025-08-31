// ABOUTME: Lazy-loading wrapper for Fluent UI button component
// ABOUTME: Ensures Fluent UI is initialized before rendering the button

import React, { useEffect, useState } from 'react';
import { initializeFluentUI } from './index';

interface FluentButtonProps extends React.HTMLAttributes<HTMLElement> {
  appearance?: 'accent' | 'lightweight' | 'neutral' | 'outline' | 'stealth';
  disabled?: boolean;
  size?: 'small' | 'medium' | 'large';
  shape?: 'circular' | 'square';
  children: React.ReactNode;
}

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
        disabled
      >
        Loading...
      </button>
    );
  }

  // Cast props to work with JSX intrinsic elements
  const fluentProps = props as any;

  return React.createElement('fluent-button', fluentProps, children);
};