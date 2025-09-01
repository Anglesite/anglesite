# Documentation Style Guide

ABOUTME: Comprehensive style guide for all documentation in the @dwk monorepo
ABOUTME: Defines formatting conventions, tone guidelines, and required sections

## Purpose

This style guide ensures consistency across all documentation in the @dwk monorepo, making it easier for contributors to write high-quality documentation and for users to find the information they need.

## File Organization

### File Naming

- Use lowercase with hyphens: `multi-window-architecture.md`
- Be descriptive but concise: `bundle-analysis.md` not `how-to-analyze-bundles.md`
- Group related files in directories: `architecture/`, `features/`, `testing/`

### Directory Structure

```
docs/
├── developer/           # Technical documentation for contributors
│   ├── architecture/   # System design and patterns
│   ├── features/       # Feature-specific documentation
│   ├── testing/        # Testing strategies and guides
│   ├── release/        # Release process and management
│   └── setup/          # Environment and development setup
├── api/                # Auto-generated API documentation
├── user-guide/         # End-user documentation
├── schemas/            # Schema validation and examples
└── README.md           # Documentation hub and navigation
```

## File Structure Requirements

### Required Sections

Every documentation file MUST include:

1. **ABOUTME Comments** (first two lines):

   ```markdown
   # Title

   ABOUTME: Brief description of what this file covers
   ABOUTME: Additional context about the file's purpose or scope
   ```

2. **Overview/Purpose Section**: Clearly explain what the document covers

3. **Navigation Elements**:
   - Link to parent documentation where applicable
   - Cross-references to related documents

### Recommended Sections

For technical documentation:

- **Prerequisites** - What users need before following this guide
- **Examples** - Practical code examples and usage patterns
- **Troubleshooting** - Common issues and solutions
- **References** - Links to external resources

## Markdown Formatting Standards

### Headers

- Use ATX-style headers (`# ## ###`) not Setext-style (`===` `---`)
- Only one H1 (`#`) per document (the title)
- Follow logical hierarchy (don't skip levels)
- Use sentence case: `## Getting started` not `## Getting Started`

### Code Blocks

Always specify language for syntax highlighting:

````markdown
```typescript
// Good - with language specified
const example = "Hello World";
```
````

```
// Bad - no language specified
const example = 'Hello World';
```

````

### Links

- Use descriptive link text: `[Testing Strategy](testing/strategy.md)`
- Not: `[Click here](testing/strategy.md)` or `[Link](testing/strategy.md)`
- For external links, consider adding domain: `[Fluent UI Documentation](https://docs.microsoft.com/en-us/fluent-ui/web-components/)`

### Lists

- Use `-` for unordered lists (consistent with this guide)
- Use `1.` for ordered lists
- Capitalize first word of each list item
- End with period if list items are complete sentences

### Tables

- Always include header row
- Use consistent alignment
- Keep content concise - link to detailed explanations if needed

```markdown
| Component | Status | Notes |
|-----------|--------|-------|
| Button    | ✅     | Complete with tests |
| Input     | 🚧     | In progress |
````

## Content Guidelines

### Tone and Voice

- **Professional but approachable**: Technical but not intimidating
- **Direct and concise**: Get to the point quickly
- **Action-oriented**: Use imperative mood for instructions
- **Inclusive**: Use "you" not "the user", avoid assumptions about skill level

### Writing Style

#### Good Examples

- "Run `npm test` to execute the test suite"
- "This feature requires Node.js 18 or higher"
- "The multi-window architecture allows multiple projects simultaneously"

#### Avoid

- "Simply run..." (what's simple to you may not be to others)
- "Obviously..." or "Of course..." (patronizing)
- "We recommend..." (use "Recommended:" or imperative mood)

### Technical Content

#### Code Examples

- Always test code examples before publishing
- Include necessary imports and context
- Show complete, working examples when possible
- Use realistic variable names and scenarios

#### Error Messages

- Include actual error text when documenting troubleshooting
- Show both the error and the solution
- Explain WHY the error occurs, not just how to fix it

### Documentation Types

#### API Documentation

- **Auto-generated preferred**: Use JSDoc comments in code
- **Include examples**: Every public API should have usage examples
- **Document parameters**: Types, requirements, default values
- **Show return values**: What the function returns and when

#### Architecture Documentation

- **Start with overview**: High-level concept before details
- **Include diagrams**: Visual representations of complex systems
- **Explain decisions**: Why this architecture was chosen
- **Show relationships**: How components interact

#### Feature Documentation

- **Target audience first**: Developer-focused vs user-focused
- **Prerequisites clear**: What needs to be set up first
- **Step-by-step**: Break complex processes into clear steps
- **Testing instructions**: How to verify it works

## Cross-References and Navigation

### Internal Links

- Use relative paths: `[Testing Guide](../testing/strategy.md)`
- Verify links work (broken links fail the experience)
- Link to specific sections with anchors when helpful: `[Coverage Requirements](testing/strategy.md#coverage-requirements)`

### External Links

- Always include the domain in link text for external resources
- Check that external links are still valid periodically
- Consider linking to official documentation over blog posts

### Navigation Aids

- Include "Quick Links" sections for long documents
- Use breadcrumbs for deep hierarchies
- Add "See also" sections for related topics

## Visual Elements

### Admonitions and Callouts

Use sparingly and consistently:

```markdown
> **Note**: Additional information that's helpful but not critical

> **Warning**: Important information about potential issues

> **Tip**: Helpful suggestions for optimization or best practices
```

### Status Indicators

For project status or feature completion:

- ✅ Complete/Available
- 🚧 In Progress/Partial
- ❌ Not Available/Deprecated
- 🔄 Under Review/Experimental

### Icons in Headers

Use sparingly and only when they add meaning:

- 📖 For documentation sections
- 🛠️ For developer/technical sections
- 👥 For user-facing content
- ⚠️ For important warnings or breaking changes

## Maintenance

### Regular Updates

- Review documentation with each release
- Update examples when APIs change
- Remove outdated information
- Check external links periodically

### Version Information

- Include version information for feature documentation
- Note when features were added or deprecated
- Update "Coming Soon" sections when features are released

## Quality Checklist

Before publishing documentation:

- [ ] ABOUTME comments added to file
- [ ] Headers follow logical hierarchy
- [ ] Code examples are tested and work
- [ ] Internal links are verified
- [ ] External links include domain names
- [ ] Tone is professional but approachable
- [ ] Grammar and spelling are correct
- [ ] Related documents are cross-referenced

## Examples

### Good Documentation File Structure

````markdown
# Multi-Window Architecture

ABOUTME: Technical documentation for Anglesite's multi-window system
ABOUTME: Covers architecture, implementation details, and development guidelines

## Overview

Anglesite uses a sophisticated multi-window architecture...

## Architecture Components

### Window Types

1. **Main Window** - Application hub
2. **Website Editor Windows** - Dedicated project windows

## Implementation

### Creating New Windows

```typescript
// Example with proper context
import { createWindow } from "../window-manager";

const newWindow = await createWindow({
  width: 800,
  height: 600,
  title: "Project Editor",
});
```
````

## See Also

- [Window Manager API](../../api/ui/multi-window-manager/README.md)
- [Testing Windows](../testing/integration.md#window-testing)

```

This style guide ensures our documentation remains consistent, accessible, and valuable to all contributors and users.
```
