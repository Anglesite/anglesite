# Anglesite 💎

> **Local-first, WYSIWYG static site generator that makes website creation as easy as editing a document**

Anglesite combines the power of modern static site generation with an intuitive desktop experience. Create beautiful, fast websites without wrestling with command lines, build tools, or complex configurations.

## ✨ Why Anglesite?

- **🖥️ Native Desktop App**: No browser tabs, no server setup—just a clean, focused workspace
- **🔒 Local-First**: Your data stays on your computer. Work offline, own your content
- **⚡ Live Preview**: See changes instantly with automatic HTTPS and hot reload
- **🎨 WYSIWYG Editing**: Visual editors for content, no HTML wrestling required
- **🚀 Zero Configuration**: Works out of the box with sensible defaults
- **🔐 Built-in Security**: Automatic HTTPS with trusted certificates, no manual setup

## 🚀 Quick Start

### Download & Install

**macOS** (Primary Support):

```bash
# Download from GitHub Releases (v1.0)
# Current: Build from source (see Developer Setup below)
```

**Windows & Linux**: Planned for v1.1

### Create Your First Website

1. **Launch Anglesite** from your Applications folder
2. **Click "New Website"** and name your project (e.g., "my-blog")
3. **Start editing** with the built-in visual editor
4. **Preview instantly** at `https://my-blog.test` (automatic HTTPS!)
5. **Build & deploy** when ready

## 🏗️ What You Can Build

- **Personal Blogs**: Write, publish, and maintain your thoughts
- **Portfolio & Résumé Sites**: Showcase your work with style
- **Documentation Sites**: Technical docs with search and navigation
- **Business Sites**: Professional presence without the complexity or cost
- **eCommerce Sites**: Sell products online
- **Static Web Apps**: JAMstack applications with modern tooling

## 🎯 Perfect For

- **Content Creators** who want to focus on writing, not tooling
- **Designers** who need pixel-perfect control without code
- **Developers** who want a faster static site workflow
- **Privacy-conscious users** who prefer local-first tools
- **Small business** who don't want another bill for web hosting
- **Anyone** frustrated with complex static site generators

## 📸 Screenshots

> _Screenshots of the desktop application will be available with the v1.0 release_

## 🔧 Features

### ✅ Available Soon (v1.0)

- **Native Desktop Application** with multi-window support
- **Automatic HTTPS Development** with trusted certificates
- **Smart DNS Management** (`.test` domains with Touch ID setup)
- **Live Preview & Hot Reload** powered by Eleventy
- **Website Project Management** with validation and tools
- **Zero Configuration Setup** - works immediately
- **Security-First Design** with process isolation and CSP compliance
- **WYSIWYG Editors** for HTML, Markdown, CSS, and more

### 🚧 Planned Features (v1.1-1.2)

- **Plugin Marketplace** with community themes and starters
- **Windows & Linux Support** with platform-native features
- **Import Tools** for WordPress, Jekyll, Hugo migration
- **Publishing Integration** with Netlify, Vercel, GitHub Pages
- **Collaboration Features** for team workflows

## 🤝 Community

### Getting Help

- **📖 User Guide**: `docs/user-guide/` (Available with v1.0)
- **💬 GitHub Discussions**: Ask questions, share projects
- **🐛 Report Issues**: Use our issue templates for bugs
- **💡 Feature Requests**: Tell us what you need

### Contributing

We welcome all types of contributions:

- **🖼️ Share Your Sites**: Show us what you built!
- **📝 Improve Documentation**: Help others get started
- **🐛 Report Bugs**: Help us make Anglesite better
- **💻 Code Contributions**: See [CONTRIBUTING.md](CONTRIBUTING.md)
- **📋 View Open Tasks**: Check our [TODO.md](docs/TODO.md) for current priorities

**New to Open Source?** We're beginner-friendly! Look for `good first issue` labels.

## 📦 Project Structure

This monorepo contains:

- **`anglesite/`** - Main desktop application (Electron + TypeScript)
- **`anglesite-11ty/`** - Eleventy configuration package
- **`web-components/`** - Reusable WebC component library
- **`anglesite-starter/`** - Basic website template
- **`docs/`** - Project documentation

## 🛠️ Developer Setup

Want to contribute or build from source?

### Prerequisites

- Node.js 18+ and npm
- macOS (primary), Windows, or Linux
- Git

### Build & Run

```bash
# Clone the repository
git clone https://github.com/anglesite/anglesite.git
cd anglesite

# Install dependencies
npm install

# Start development
npm run start:anglesite

# Run tests
npm test
```

**Need help?** Check out [CONTRIBUTING.md](CONTRIBUTING.md) for detailed setup instructions.

## 📊 Project Status

- **Current Version**: v0.1.0-alpha
- **Development Phase**: Phase 1 Complete (Core App), Phase 2 Starting (WYSIWYG)
- **Platform Support**: macOS (primary), Windows/Linux (planned)
- **Test Coverage**: 90%+ maintained
- **Community**: Growing! Join us 🌱

## 📄 License

Anglesite is open source software licensed under the [ISC License](LICENSE).

## 🙏 Acknowledgments

Anglesite stands on the shoulders of giants:

- **[Eleventy](https://www.11ty.dev/)** - The static site generator that powers our builds
- **[Electron](https://www.electronjs.org/)** - Cross-platform desktop app framework
- **[Microsoft Fluent UI](https://developer.microsoft.com/en-us/fluentui/)** - Modern component system
- **All our contributors** - Thank you for making Anglesite better!

---

**Ready to create something amazing?**

[⬇️ Download Anglesite](https://github.com/anglesite/anglesite/releases) • [📖 Read the Docs](docs/) • [💬 Join Discussions](https://github.com/anglesite/anglesite/discussions)
