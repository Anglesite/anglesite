# Fluent UI Migration Guide

ABOUTME: Complete migration guide for integrating Microsoft Fluent UI Web Components into Anglesite
ABOUTME: Covers implementation details, component mapping, lazy loading, performance, and troubleshooting

## Overview

Microsoft Fluent UI Web Components have been integrated as the primary UI system for Anglesite, replacing the previous custom view implementation. This guide covers the migration process and new component usage.

## Why Fluent UI?

- **Modern Design System** - Consistent with Microsoft's design language
- **Web Components** - Framework-agnostic, standards-based components
- **Performance** - Lazy loading and tree-shaking support
- **Accessibility** - WCAG 2.1 AA compliant out of the box
- **TypeScript Support** - Full type definitions included

## Migration Strategy

### Phase 1: Component Replacement (COMPLETED)

All previous custom UI components have been replaced with Fluent UI equivalents.

### Old vs New Component Mapping

| Old Component | Fluent UI Replacement | Location                               |
| ------------- | --------------------- | -------------------------------------- |
| CustomButton  | FluentButton          | `app/ui/react/fluent/FluentButton.tsx` |
| CustomInput   | fluent-text-field     | Direct usage                           |
| CustomDialog  | fluent-dialog         | Direct usage                           |
| CustomMenu    | fluent-menu           | Direct usage                           |

## Implementation Details

### Lazy Loading Architecture

Fluent UI components are lazy-loaded to optimize initial bundle size:

```typescript
// app/ui/react/fluent/index.ts
export const loadFluentUI = async () => {
  const { provideFluentDesignSystem, fluentButton, fluentTextField } =
    await import(
      /* webpackChunkName: "fluent-ui" */
      "@fluentui/web-components"
    );

  provideFluentDesignSystem()
    .register(fluentButton())
    .register(fluentTextField());
};
```

### Component Usage

#### React Integration

```tsx
// app/ui/react/fluent/FluentButton.tsx
import React from "react";

interface FluentButtonProps {
  appearance?: "accent" | "lightweight" | "outline" | "stealth";
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}

export const FluentButton: React.FC<FluentButtonProps> = ({
  appearance = "accent",
  ...props
}) => {
  return (
    <fluent-button appearance={appearance} {...props}>
      {props.children}
    </fluent-button>
  );
};
```

#### Direct Web Component Usage

```html
<!-- In templates -->
<fluent-button appearance="accent" @click="${this.handleClick}">
  Click Me
</fluent-button>

<fluent-text-field placeholder="Enter text...">
  <span slot="start">🔍</span>
</fluent-text-field>
```

## Design Tokens

Fluent UI uses design tokens for theming:

```typescript
// Set custom design tokens
import { DesignToken } from "@microsoft/fast-foundation";

const accentColor = DesignToken.create<string>("accent-color");
accentColor.setValueFor(document.body, "#0078D4");
```

## Migration Checklist

- [x] Remove old custom component implementations
- [x] Install @fluentui/web-components package
- [x] Set up lazy loading for optimal performance
- [x] Create React wrapper components
- [x] Update all UI references to use Fluent components
- [x] Add TypeScript definitions
- [x] Test accessibility compliance

## Common Patterns

### Form Controls

```tsx
<fluent-text-field
  type="email"
  required
  placeholder="Email"
  value={email}
  @change=${(e) => setEmail(e.target.value)}
>
  <span slot="start">📧</span>
</fluent-text-field>
```

### Dialogs and Modals

```tsx
<fluent-dialog id="save-dialog" modal>
  <h2 slot="title">Save Changes?</h2>
  <div>Your changes will be saved to the project.</div>
  <fluent-button slot="action" appearance="accent">
    Save
  </fluent-button>
  <fluent-button slot="action">Cancel</fluent-button>
</fluent-dialog>
```

### Data Display

```tsx
<fluent-data-grid>
  <fluent-data-grid-row>
    <fluent-data-grid-cell>Name</fluent-data-grid-cell>
    <fluent-data-grid-cell>Status</fluent-data-grid-cell>
  </fluent-data-grid-row>
</fluent-data-grid>
```

## Performance Considerations

1. **Bundle Size** - Fluent UI adds ~50KB gzipped when fully loaded
2. **Lazy Loading** - Components load on-demand, reducing initial bundle
3. **Tree Shaking** - Only imported components are included in build
4. **CSS-in-JS** - Styles are encapsulated, no global CSS pollution

## Testing Fluent Components

```typescript
// Example test
import { render, fireEvent } from '@testing-library/react';
import { FluentButton } from '../FluentButton';

test('FluentButton triggers onClick', () => {
  const handleClick = jest.fn();
  const { getByText } = render(
    <FluentButton onClick={handleClick}>Test</FluentButton>
  );

  fireEvent.click(getByText('Test'));
  expect(handleClick).toHaveBeenCalled();
});
```

## Troubleshooting

### Components Not Rendering

Ensure Fluent UI is registered before use:

```typescript
await loadFluentUI(); // Must complete before rendering
```

### TypeScript Errors

Add type definitions to your TypeScript config:

```typescript
// types/fluent-ui.d.ts
declare module "@fluentui/web-components";
```

### Style Conflicts

Fluent UI uses Shadow DOM for style encapsulation. If styles aren't applying:

1. Check that design tokens are set at the correct scope
2. Verify no global CSS is interfering
3. Use Fluent's CSS custom properties for customization

## Resources

- [Fluent UI Web Components Documentation (docs.microsoft.com)](https://docs.microsoft.com/en-us/fluent-ui/web-components/)
- [Design Token Reference (docs.microsoft.com)](https://docs.microsoft.com/en-us/fluent-ui/web-components/design-system/design-tokens)
- [Component Storybook (aka.ms)](https://aka.ms/fluentui-storybook)
- [Microsoft Fluent UI GitHub (github.com)](https://github.com/microsoft/fluentui)
