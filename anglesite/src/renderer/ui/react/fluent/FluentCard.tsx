// ABOUTME: Lazy-loading wrapper for Fluent UI card component
// ABOUTME: Provides container with Fluent UI card styling

import React, { useEffect, useState } from 'react';
import { initializeFluentUI } from './index';

interface FluentCardProps extends React.HTMLAttributes<HTMLElement> {
  /** Visual appearance of the card */
  appearance?: 'filled' | 'filled-alternative' | 'outline' | 'subtle';
  /** Size/padding variant */
  size?: 'small' | 'medium' | 'large';
  /** Orientation of content */
  orientation?: 'horizontal' | 'vertical';
  /** Whether the card is selectable */
  selectable?: boolean;
  /** Whether the card is currently selected */
  selected?: boolean;
  /** Card content */
  children: React.ReactNode;
}

export const FluentCard: React.FC<FluentCardProps> = ({ children, ...props }) => {
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
    // Show loading state with fallback styling
    const padding = props.size === 'small' ? '12px' : props.size === 'large' ? '24px' : '16px';

    // Extract style-related props and pass through all other props including event handlers
    const { size, appearance, orientation, selectable, selected, style, ...otherProps } = props;

    // These style props are extracted to prevent them from being passed to the DOM element
    // Currently using basic styling but could be enhanced based on these props in the future
    void size;
    void appearance;
    void orientation;
    void selectable;
    void selected;

    return (
      <div
        {...otherProps}
        style={{
          padding,
          background: 'var(--card-bg, white)',
          border: '1px solid var(--border-primary, #e1e1e1)',
          borderRadius: '8px',
          opacity: 0.7,
          ...style,
        }}
      >
        {children}
      </div>
    );
  }

  // Cast props to work with JSX intrinsic elements
  const fluentProps = props as React.HTMLAttributes<HTMLElement> & FluentCardProps;

  return React.createElement('fluent-card', fluentProps, children);
};
