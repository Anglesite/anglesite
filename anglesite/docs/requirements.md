# Anglesite Product Requirements

Anglesite Product Requirements Document (PRD) for Open Source Developers

## Table of Contents

- [Anglesite Product Requirements](#anglesite-product-requirements)
  - [Table of Contents](#table-of-contents)
  - [Executive Summary](#executive-summary)
  - [User Personas](#user-personas)
    - [Maria, the Freelance Writer](#maria-the-freelance-writer)
    - [David, the Open-Source Developer](#david-the-open-source-developer)
  - [Project Goals](#project-goals)
  - [Non-Goals](#non-goals)
  - [Phased Rollout / MVP](#phased-rollout--mvp)
  - [Core Features](#core-features)
  - [Technical Architecture](#technical-architecture)
  - [Editor Components](#editor-components)
  - [Roadmap for Contributors](#roadmap-for-contributors)
  - [Contributing Standards \& References](#contributing-standards--references)
  - [Legal \& Licensing](#legal--licensing)
  - [Summary for Developers](#summary-for-developers)

## Executive Summary

Anglesite is a local-first, open-source WYSIWYG static site generator built to democratize website creation. It empowers non-technical users to own and manage their web presence, while offering extensibility and transparency for developers. Anglesite is designed for active contribution and modular plugin development, with a focus on standards compliance, automation, and platform interoperability.

## User Personas

### Maria, the Freelance Writer

- **Background:** Maria is a non-technical writer who wants to create a professional-looking portfolio website to showcase her work. She's comfortable with word processors but has no experience with HTML or CSS.
- **Goals:** Maria wants to easily create and update her website without having to write any code. She needs a simple, intuitive interface that lets her focus on her content.
- **Frustrations:** Maria has tried using other website builders but found them to be too complex or too restrictive. She doesn't want to be locked into a proprietary platform.

### David, the Open-Source Developer

- **Background:** David is an experienced JavaScript developer who is passionate about open-source software. He's looking for a project to contribute to in his spare time.
- **Goals:** David wants to work on a project that is well-documented, has a clear roadmap, and a welcoming community. He's interested in building new features and fixing bugs.
- **Frustrations:** David has been frustrated by open-source projects that are poorly managed or have a toxic community. He wants to be part of a project that is transparent and collaborative.

## Project Goals

- Provide a developer-friendly open source foundation for static website creation
- Enable contributions through a robust plugin system and modular architecture
- Prioritize standards compliance, accessibility, and automation
- Facilitate multi-platform distribution and syndication

## Non-Goals

- **To be a full-blown CMS:** Anglesite is not intended to be a replacement for WordPress or other complex content management systems. It is focused on static site generation and does not include features like user management or a built-in database.
- **To be a proprietary platform:** Anglesite is and will always be open-source software. It is not owned by any single company and is not intended to be a commercial product.
- **To be a "one-size-fits-all" solution:** Anglesite is designed to be modular and extensible. It is not intended to be a monolithic application that tries to do everything for everyone.

## Phased Rollout / MVP

The initial focus of Anglesite will be on delivering a Minimum Viable Product (MVP) that provides a solid foundation for future development. The MVP will include the following core features:

1. **Standards-Compliant Output:** Semantic HTML, responsive CSS, and modern JS.
2. **Extensible Visual Editors:** Modular WYSIWYG editors for HTML and Markdown.
3. **Syndication Engine:** Built-in support for RSS and JSONFeed.
4. **Deployment Targets:** First-class support for Cloudflare Pages.
5. **Electron UX:** A basic Electron shell with platform-native theming.

## Core Features

1. **Standards-Compliant Output**
   - Semantic HTML, responsive CSS, modern JS
   - Built-in SEO: structured metadata, schema.org, and social cards
   - WCAG 2.1 AA accessibility by default

2. **Extensible Visual Editors**
   - Modular WYSIWYG editors for HTML, Markdown, CSS, SVG, XML
   - Uses community-maintained NPM packages
   - Editable plugin wrappers allow contributors to upgrade or swap editors

3. **Syndication Engine**
   - Push-based workflow with pluggable post-publish hooks
   - Each service uses a dedicated plugin for maintainability
   - Built-in support for feeds (RSS, JSONFeed, ActivityPub)

4. **Import & Migration Framework**
   - Abstracted importer pipeline for third-party platforms (WordPress, Wix, etc.)
   - Domain ownership verified via pluggable provider API modules
   - All import/export logic exposed as plugin hooks

5. **Developer-Focused Social Publishing**
   - **Git-centric ownership of source content:** All content is stored in a Git repository, allowing developers to use their existing workflows and tools. For example, a developer could write a blog post in their favorite text editor, commit it to a Git repository, and have it automatically published to their website and social media channels.
   - **Integration layer between static builds and social platforms:** Anglesite provides a set of plugins that make it easy to cross-post content to popular social media platforms like BlueSky and Mastodon. These plugins can be configured to automatically generate social media-friendly summaries and images.
   - Customizable social card generation and preview

6. **Modular Admin Console**
   - UI powered by a plugin system—support for alternative providers encouraged
   - **Example Integration:** Anglesite integrates with Cloudflare by default, with hooks for extensibility. This allows users to manage their Cloudflare-hosted sites from within the Anglesite admin console. However, this is just one example of a hosting provider integration. Developers are encouraged to create plugins for other hosting providers like Netlify, Vercel, and AWS.
   - Web standards–first config interface (robots.txt, redirects, headers, etc.)

7. **Collaboration Infrastructure**
   - Git-backed project storage with visual diff UI
   - Dropbox/iCloud/Drive support via file watcher adapters
   - **Near-term goals:** The initial focus will be on providing a solid foundation for collaboration, including features like visual diffing and file watcher adapters.
   - Real-time merge conflict resolution is future roadmap

8. **Accessibility & Automation**
   - Full OS-level accessibility APIs
   - Native scripting support through OS hooks and Electron IPC
   - AI-friendly design: local agents can drive workflows

9. **Deployment Targets**
   - First-class Cloudflare Pages support
   - Plugin interface for other CI/CD platforms
   - Secure 11ty build execution in Docker sandbox

10. **Electron UX**
    - Electron shell with platform-native theming
    - App UX built using standard web tech, allowing frontend devs to contribute easily
    - Preview server supports local network discovery and comparison

## Technical Architecture

- **Stack Overview**
  - Electron + Node.js + TypeScript
  - 11ty as the build engine
  - Docker for isolated build and test environments
  - Editors and UI components sourced from maintained OSS libraries
- **Configuration & Secrets**
  - Structured config via 11ty JavaScript Data Files
  - .env file encryption and integration with OS password managers
  - All secrets excluded from version control by default
- **Plugin System**
  - Angular-style API for UI and behavior extension
  - Plugin categories:
    - CSS themes (based on community frameworks)
    - WebC templates
    - Build process middleware
    - Import/export adapters
    - Syndication integrations
    - Hosting/domain provider modules
- **Developer Workflow**
  - TDD-first: includes tests for CLI, UI, and build outputs
  - TypeScript with strict linting and formatting rules
  - `@see` in JSDoc to spec links (HTML, CSS, JS, etc.)

## Editor Components

| Editor Type     | Compliance   | Contribution Opportunities                                                                            |
| --------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| HTML            | HTML5        | Custom element integration (e.g., for embedding interactive content), improved accessibility checking |
| Markdown        | CommonMark   | Live preview & syntax extensions (e.g., for creating tables or footnotes)                             |
| CSS             | W3C CSS      | Visual design tools, accessibility UI (e.g., for checking color contrast)                             |
| SVG             | W3C SVG      | Shape libraries, accessibility fixes (e.g., for adding ARIA labels to SVG elements)                   |
| XML             | W3C XML      | Syndication schema validation (e.g., for ensuring that an RSS feed is well-formed)                    |
| JavaScript/Text | VSCode-based | Language extension plugins (e.g., for adding support for new programming languages)                   |

## Roadmap for Contributors

- **i18n/l10n:**
  - Extract all user-facing strings into a separate file.
  - Enable language packs via plugin hook.
- **Headless CMS sync:**
  - Add integration points for external DBs.
  - Create a plugin for a popular headless CMS like Strapi or Sanity.
- **Real-time collaboration:**
  - Investigate OT/CRDT-friendly document models.
  - Implement a basic real-time editing feature for Markdown files.
- **Serverless support:**
  - Create a Cloudflare Pages Functions plugin starter.
- **Export templates:**
  - Create an SCORM/xAPI export template for e-learning courses.
  - Create an ePub export template for e-books.
  - Create an Apple Help export template for software documentation.

## Contributing Standards & References

- 11ty.dev
- MDN Web Docs
- W3C Specifications
- CommonMark Spec
- Cloudflare Developer Docs
- Electron Guide
- Docker Docs
- JSDoc

## Legal & Licensing

- Complies with Apple App Store and open web standards
- Open source license: ISC (with SPDX format license table)
- Contributor license agreement (CLA) may be added based on community input

## Summary for Developers

Anglesite is more than a site generator—it’s an open, standards-based platform for building, extending, and deploying content-first websites. Designed to invite and reward contributor input, Anglesite provides developers with tools to improve the web ecosystem from the ground up.
