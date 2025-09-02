// ABOUTME: Lazy-loading wrapper for Fluent UI divider component
// ABOUTME: Provides horizontal or vertical divider with Fluent UI styling

import React, { useEffect, useState } from 'react';
import { initializeFluentUI } from './index';

interface FluentDividerProps extends React.HTMLAttributes<HTMLElement> {
  /** Orientation of the divider */
  orientation?: 'horizontal' | 'vertical';
  /** Visual appearance */
  appearance?: 'default' | 'strong' | 'brand' | 'subtle';
  /** Alignment of content within divider */
  alignContent?: 'start' | 'center' | 'end';
  /** Whether divider should be inset from edges */
  inset?: boolean;
  /** Optional content/label */
  children?: React.ReactNode;
}

export const FluentDivider: React.FC<FluentDividerProps> = ({ children, ...props }) => {
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
    // Show loading state with fallback divider
    const isVertical = props.orientation === 'vertical';
    const margin = props.inset ? '0 16px' : '0';

    if (children) {
      // Divider with content
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            margin: '16px 0',
            ...props.style,
          }}
        >
          <div
            style={{
              flex: 1,
              height: '1px',
              background: 'var(--border-primary, #e1e1e1)',
              marginRight: '12px',
              marginLeft: props.alignContent === 'end' ? '0' : margin,
            }}
          />
          <span
            style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              opacity: 0.7,
            }}
          >
            {children}
          </span>
          <div
            style={{
              flex: 1,
              height: '1px',
              background: 'var(--border-primary, #e1e1e1)',
              marginLeft: '12px',
              marginRight: props.alignContent === 'start' ? '0' : margin,
            }}
          />
        </div>
      );
    }

    // Simple divider
    return (
      <div
        style={{
          width: isVertical ? '1px' : '100%',
          height: isVertical ? '100%' : '1px',
          background: 'var(--border-primary, #e1e1e1)',
          margin: isVertical ? margin : `16px ${margin}`,
          opacity: 0.7,
          ...props.style,
        }}
      />
    );
  }

  // Cast props to work with JSX intrinsic elements
  const fluentProps = props as any;

  return React.createElement('fluent-divider', fluentProps, children);
};
