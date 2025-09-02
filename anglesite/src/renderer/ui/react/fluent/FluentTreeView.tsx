// ABOUTME: Lazy-loading wrapper for Fluent UI tree view component
// ABOUTME: Provides hierarchical tree navigation with Fluent UI styling

import React, { useEffect, useState } from 'react';
import { initializeFluentUI } from './index';

export interface FluentTreeItem {
  id: string;
  label: string;
  icon?: string;
  expanded?: boolean;
  selected?: boolean;
  disabled?: boolean;
  children?: FluentTreeItem[];
}

interface FluentTreeViewProps extends React.HTMLAttributes<HTMLElement> {
  /** Tree data structure */
  items: FluentTreeItem[];
  /** Selection mode */
  selectionMode?: 'single' | 'multiple' | 'none';
  /** Whether to show lines connecting items */
  showLines?: boolean;
  /** Item click handler */
  onItemClick?: (item: FluentTreeItem) => void;
  /** Item expand/collapse handler */
  onItemToggle?: (item: FluentTreeItem, expanded: boolean) => void;
}

export const FluentTreeView: React.FC<FluentTreeViewProps> = ({ items, onItemClick, onItemToggle, ...props }) => {
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

  // Render tree items recursively
  const renderTreeItems = (items: FluentTreeItem[], level = 0): React.ReactNode => {
    return items.map((item) => {
      const hasChildren = item.children && item.children.length > 0;

      if (!isReady) {
        // Fallback rendering
        return (
          <div key={item.id} style={{ paddingLeft: `${level * 20}px` }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '4px 8px',
                cursor: item.disabled ? 'default' : 'pointer',
                opacity: item.disabled ? 0.5 : 1,
                background: item.selected ? 'var(--selection-bg, #e1e1e1)' : 'transparent',
              }}
              onClick={() => !item.disabled && onItemClick?.(item)}
            >
              {hasChildren && <span style={{ marginRight: '4px' }}>{item.expanded ? '▼' : '▶'}</span>}
              {item.icon && <span style={{ marginRight: '8px' }}>{item.icon}</span>}
              <span>{item.label}</span>
            </div>
            {item.expanded && hasChildren && <div>{renderTreeItems(item.children!, level + 1)}</div>}
          </div>
        );
      }

      // Fluent UI tree item
      const treeItemProps: any = {
        key: item.id,
        'data-item-id': item.id,
        disabled: item.disabled,
        selected: item.selected,
        expanded: item.expanded,
      };

      return React.createElement(
        'fluent-tree-item',
        treeItemProps,
        <>
          {item.icon && <span slot="start">{item.icon}</span>}
          {item.label}
          {hasChildren && renderTreeItems(item.children!, level + 1)}
        </>
      );
    });
  };

  // Handle click events
  useEffect(() => {
    if (isReady && onItemClick) {
      const handler = (e: Event) => {
        const target = e.target as HTMLElement;
        const treeItem = target.closest('[data-item-id]');
        if (treeItem) {
          const itemId = treeItem.getAttribute('data-item-id');
          const findItem = (items: FluentTreeItem[]): FluentTreeItem | undefined => {
            for (const item of items) {
              if (item.id === itemId) return item;
              if (item.children) {
                const found = findItem(item.children);
                if (found) return found;
              }
            }
          };
          const item = findItem(items);
          if (item) onItemClick(item);
        }
      };

      const treeViewId = props.id || 'tree-view';
      const element = document.getElementById(treeViewId);
      if (element) {
        element.addEventListener('click', handler);
        return () => element.removeEventListener('click', handler);
      }
    }
  }, [isReady, onItemClick, items, props.id]);

  if (!isReady) {
    // Show loading state with fallback tree
    return (
      <div
        id={props.id}
        style={{
          border: '1px solid var(--border-primary)',
          borderRadius: '4px',
          padding: '8px',
          opacity: 0.7,
          ...props.style,
        }}
      >
        {renderTreeItems(items)}
      </div>
    );
  }

  // Cast props to work with JSX intrinsic elements
  const fluentProps = {
    ...props,
    id: props.id || 'tree-view',
  } as any;

  // Remove React-specific props
  delete fluentProps.items;
  delete fluentProps.onItemClick;
  delete fluentProps.onItemToggle;

  return React.createElement('fluent-tree-view', fluentProps, renderTreeItems(items));
};
