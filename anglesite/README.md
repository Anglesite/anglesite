# Anglesite 💎

Anglesite is a local-first, Electron-based static site generator that combines the power of [Eleventy](https://www.11ty.dev/) with an intuitive WYSIWYG editing experience. It provides a seamless local development environment featuring automatic HTTPS support, smart DNS management, biometric authentication, and real-time preview capabilities.

## Features

### Core Desktop Application ✅ **COMPLETED**

- **Native Desktop Application**: Full Electron application with native integrations
- **Automatic HTTPS Support**: Local SSL certificates with trusted CA installation (no admin required)
- **Smart DNS Management**: Automatic .test domain configuration via /etc/hosts with Touch ID support (admin access required)
- **Live Preview**: Real-time preview with hot reload powered by Eleventy
- **Multi-Window Architecture**: Dedicated editing windows for each website project
- **Enhanced Website Management**: Real-time validation for standards and best practices.
- **First Launch Assistant**: Guided setup for custom host mode selection
- **Developer Tools**: Built-in Chrome Developer Tools for debugging and inspection
- **Zero Configuration**: Works out of the box with sensible defaults

### Upcoming Features (Phase 2+)

- **WYSIWYG Editors**: Extensible visual editors for HTML, Markdown, CSS, SVG, and XML
- **Plugin System**: Angular-style API for UI and behavior extension
- **Syndication Engine**: Built-in RSS, JSONFeed, and ActivityPub support
- **Import & Migration**: WordPress, Wix, Jekyll, Hugo importers with domain verification
- **Social Publishing**: Git-centric content with BlueSky/Mastodon integration
- **Deployment Integration**: First-class Cloudflare Pages support with plugin interface

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- macOS (primary support), Windows, or Linux

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/anglesite/anglesite.git
   cd anglesite
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the application:

   ```bash
   npm run build
   ```

4. Start Anglesite:

   ```bash
   npm start
   ```

## Usage

### Creating a Website

1. Click **File → New Website** or use `Cmd+N`
2. Enter a name for your website (e.g., "portfolio")
3. Anglesite automatically:
   - Creates the website directory with starter content
   - Configures the domain (portfolio.test)
   - Updates /etc/hosts with biometric authentication (Touch ID/password)
   - Opens a dedicated editing window with live preview

### Multi-Window Editing

- **Dedicated Windows**: Each website opens in its own editing window
- **Context-Aware Menus**: Menu bar adapts based on focused window type
- **Website Management**: Right-click websites for rename/delete options
- **Window State Tracking**: Prevents duplicate windows, manages window focus

### Website Structure

Websites are stored in:

```text
~/Library/Application Support/Anglesite/websites/
└── your-site/
    └── index.md
```

Each website uses Markdown files that are automatically converted to HTML by Eleventy.

### Previewing Your Site

- **Local Preview**: Your site is available at `https://sitename.test:8080` (HTTPS mode) or `http://localhost:8081` (HTTP mode)
- **Live Reload**: Changes to your files automatically refresh the preview
- **DevTools**: Toggle developer tools with `Cmd+Option+I`
- **External Browser**: Open in your default browser with `Cmd+Shift+O`

### Building for Production

Click **Build** or use `Cmd+B` to generate the static HTML files. The built site will be placed in your website's directory.

## Development

### Project Structure

```text
app/                        # Electron application source
├── main.ts                 # Main process entry point
├── certificates.ts         # SSL certificate management
├── dns/                    # DNS and hosts file management
│   └── hosts-manager.ts    # Touch ID + hosts file integration
├── server/                 # Eleventy and HTTPS proxy servers
├── ui/                     # Window and UI components
│   ├── window-manager.ts   # WebContentsView management
│   ├── multi-window-manager.ts # Multi-window architecture
│   └── menu.ts             # Context-aware menus
├── ipc/                    # Inter-process communication
│   └── handlers.ts         # IPC message routing
└── utils/                  # Website management utilities
    └── website-manager.ts  # Creation, validation, operations

dist/                       # Compiled output
docs/                       # Complete project documentation
├── architecture.md         # Technical architecture diagrams
├── plan.md                 # Project roadmap and milestones
└── requirements.md         # Product requirements document
test/                       # Comprehensive test suite (49 tests)
```

### Available Scripts

- `npm start` - Launch the application
- `npm run build` - Build Eleventy sites
- `npm test` - Run Jest tests
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run typecheck` - Run TypeScript type checking

### Architecture

Anglesite uses a modern multi-process, multi-window architecture:

- **Main Process**: Manages application lifecycle, authentication, servers, and system integration
- **Multi-Window Renderer**: Dedicated windows for help and website editing
- **Biometric Authentication**: Touch ID integration with sudo-prompt for secure privilege escalation
- **DNS Management**: Cross-platform hosts file management with automatic cleanup
- **Certificate Management**: Self-contained CA with user keychain integration
- **Eleventy Server**: Serves website content with hot reload (port 8081)
- **HTTPS Proxy**: Provides SSL termination for .test domains (port 8080)
- **WebContentsView**: Secure preview integration with CSP compliance

For detailed architecture documentation with Mermaid diagrams, see [docs/architecture.md](docs/architecture.md).

## Security

- **Local Only**: All servers bind to 127.0.0.1 (localhost only)
- **Modern Authentication**: Touch ID/biometric support with secure fallback
- **User Keychain**: CA certificates installed in user keychain (no admin required)
- **Privilege Escalation**: Uses sudo-prompt (replaced deprecated electron-sudo)
- **Sandboxed**: Websites isolated in application data directory
- **Content Security Policy**: Strict CSP without unsafe-inline
- **Process Isolation**: Multi-process architecture with secure IPC
- **No External Access**: No network requests or telemetry
- **Automated Security**: Smart cleanup prevents orphaned system entries

## Troubleshooting

### Certificate Issues

If you encounter SSL certificate errors:

1. Open Keychain Access
2. Search for "Anglesite Development"
3. If found, delete it
4. Restart Anglesite to regenerate

### Hosts File Permissions

Updating /etc/hosts requires administrator privileges. Anglesite uses modern authentication:

- **Touch ID Support**: Biometric authentication on supported macOS systems
- **Intelligent Fallback**: Password prompt when Touch ID unavailable
- **Batch Operations**: Single authentication for multiple changes
- **Smart Cleanup**: Automatic removal of orphaned .test domains

You'll be prompted for authentication when:

- Creating a new website
- Starting the application (for automatic cleanup)
- Touch ID setup guidance provided if available but not configured

### Reset First Launch

To reset the first launch flow:

1. Quit Anglesite
2. Delete the settings file:

   ```bash
   rm ~/Library/Application\ Support/Anglesite/settings.json
   ```

3. Restart Anglesite

## Contributing

Anglesite is designed for active contribution and community involvement. We welcome contributors!

### How to Contribute

1. Fork the repository
2. Create a feature branch
3. Follow TypeScript + JSDoc conventions
4. Add comprehensive tests (Jest + mocks)
5. Ensure 100% ESLint compliance
6. Submit a pull request

### Development Standards

- **TDD-First**: All features require tests (CLI, UI, build outputs)
- **TypeScript**: Strict typing with comprehensive JSDoc documentation
- **Architecture**: Modular plugin system with Angular-style API
- **Testing**: Jest with comprehensive Electron mocking (49 tests current)
- **Code Quality**: ESLint + Prettier with zero disable comments

### Contribution Areas

- **Phase 2**: WYSIWYG editors, plugin system, theme development
- **Cross-Platform**: Windows/Linux certificate and DNS management
- **Integrations**: Hosting providers, social platforms, import/export
- **Documentation**: Tutorials, API documentation, user guides

For detailed contributing guidelines, see:

- [docs/requirements.md](docs/requirements.md) - Product requirements and vision
- [docs/plan.md](docs/plan.md) - Development roadmap and phases
- [docs/architecture.md](docs/architecture.md) - Technical architecture and design

## Roadmap

### ✅ Phase 1: Core Desktop Application (COMPLETED)

- [x] Native Electron desktop application with multi-window architecture
- [x] Automatic HTTPS development environment with CA management
- [x] Smart DNS management with Touch ID authentication
- [x] Live preview system with hot reload and WebContentsView
- [x] Enhanced website management with validation and context menus
- [x] Comprehensive test coverage (49 tests) and documentation

### 🎯 Phase 2: Content Management & WYSIWYG Editors (Next)

- [ ] Extensible visual editors for HTML, Markdown, CSS, SVG, XML
- [ ] Standards-compliant output with built-in SEO and accessibility
- [ ] Plugin system foundation with Angular-style API
- [ ] Theme system with community framework integration

### 📋 Phase 3: Syndication & Publishing Platform

- [ ] Syndication engine (RSS, JSONFeed, ActivityPub)
- [ ] Import & migration framework (WordPress, Wix, Jekyll, Hugo)
- [ ] Developer-focused social publishing (Git + BlueSky/Mastodon)
- [ ] Deployment targets (Cloudflare Pages, plugin interface)

### 🌍 Phase 4: Collaboration & Multi-Platform

- [ ] Multi-platform support (Windows and Linux)
- [ ] Real-time collaboration with conflict resolution
- [ ] Cloud storage integration (Dropbox/iCloud/Drive)
- [ ] Advanced deployment with CI/CD pipeline integration

For detailed roadmap and contributing information, see [docs/plan.md](docs/plan.md) and [docs/requirements.md](docs/requirements.md).

## License

Anglesite is licensed under the ISC License. See the [LICENSE](LICENSE) file for details.

## Technology Stack

### Core Dependencies

- **[Eleventy](https://www.11ty.dev/)**: Static site generator engine
- **[Electron](https://www.electronjs.org/)**: Desktop application framework
- **[TypeScript](https://www.typescriptlang.org/)**: Type-safe development
- **[Jest](https://jestjs.io/)**: Testing framework with comprehensive mocking

### Security & Authentication

- **[sudo-prompt](https://www.npmjs.com/package/sudo-prompt)**: Modern privilege escalation with Touch ID
- **[native-is-elevated](https://www.npmjs.com/package/native-is-elevated)**: Cross-platform privilege detection
- **[hostile](https://www.npmjs.com/package/hostile)**: Cross-platform hosts file management
- **[mkcert](https://www.npmjs.com/package/mkcert)**: SSL certificate generation

### UI & Architecture

- **WebContentsView**: Modern Electron preview integration
- **Multi-Process Architecture**: Secure IPC with process isolation
- **Context Security Policy**: Strict CSP without unsafe-inline

## Acknowledgments

Anglesite stands on the shoulders of giants and is inspired by the need for accessible, local-first web development tools that democratize website creation while maintaining developer-grade capabilities.
