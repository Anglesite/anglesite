# Contributing to Anglesite

Thank you for your interest in contributing to Anglesite! We welcome contributions from everyone, whether you're fixing bugs, adding features, improving documentation, or helping with community support.

## Quick Start for Contributors

### Prerequisites

- Node.js 18+ and npm
- Git
- macOS (primary support), Windows, or Linux

### Development Setup (5 minutes)

1. **Fork and Clone**

   ```bash
   git clone https://github.com/YOUR_USERNAME/anglesite.git
   cd anglesite
   ```

2. **Install Dependencies**

   ```bash
   npm install  # Installs all monorepo dependencies
   ```

3. **Verify Setup**

   ```bash
   npm test     # Run all tests
   npm run lint # Check code quality
   ```

4. **Start Development**

   ```bash
   npm run start:anglesite  # Launch Anglesite app
   ```

You're ready to contribute! 🎉

## Code Contribution Process

### 1. Choose What to Work On

**Good First Issues**: Look for issues labeled `good first issue` or `help wanted`

**High Priority Areas**:

- **WYSIWYG Editors** (Phase 2) - HTML, Markdown, CSS visual editors
- **Cross-Platform Support** - Windows and Linux compatibility
- **Plugin System** - NPM-based starter templates
- **Testing** - Expand test coverage in any package
- **Documentation** - User guides, tutorials, API examples

### 2. Development Workflow

1. **Create Feature Branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Follow Our Standards**
   - **Code Style**: ESLint + Prettier (run `npm run lint`)
   - **TypeScript**: Strict mode compliance required
   - **Testing**: 90% coverage minimum for new code
   - **Commits**: Conventional commits preferred

3. **Write Tests First (TDD)**

   ```bash
   # Write failing test
   npm test -- --watch

   # Implement feature to make test pass
   # Refactor while keeping tests green
   ```

4. **Ensure Quality**

   ```bash
   npm test              # All tests pass
   npm run lint         # No linting errors
   npm run typecheck    # No TypeScript errors
   npm run test:coverage # 90% coverage maintained
   ```

5. **Submit Pull Request**
   - Use our PR template
   - Link to related issues
   - Include screenshots for UI changes
   - Request review from maintainers

### 3. Code Review Process

- **Automated Checks**: All CI checks must pass
- **Peer Review**: At least one maintainer approval required
- **Testing**: Manual testing for UI/UX changes
- **Documentation**: Updates required for new features

## Development Guidelines

### Project Structure

```text
anglesite/           # Main Electron desktop app
anglesite-11ty/      # Eleventy configuration package
anglesite-starter/   # Basic website template
web-components/      # Reusable WebC components
docs/                # Project documentation
```

### Code Standards

**TypeScript**:

- Use strict mode
- Prefer interfaces over types for objects
- Document all exported functions with JSDoc

**Testing**:

- Jest for unit/integration tests
- 90% coverage requirement
- Test files: `*.test.ts` or `*.spec.ts`
- Mock external dependencies

**Documentation**:

- JSDoc for all public APIs with `@example` sections
- Update relevant documentation for feature changes
- Include migration guides for breaking changes

### Coding Patterns

**File Headers**:

```typescript
// ABOUTME: Brief description of what this file does
// ABOUTME: More details about the file's purpose
```

**Error Handling**:

- Use custom error types from `core/errors/`
- Provide helpful error messages
- Log errors appropriately

**Async Operations**:

- Prefer async/await over promises
- Handle race conditions properly
- Use atomic operations for file system changes

## Areas We Need Help

### 🔥 High Priority (Phase 2)

**WYSIWYG Editors** (0% complete):

- Markdown editor with live preview
- HTML visual editor
- CSS editor with syntax highlighting
- SVG visual editor

**Plugin System** (25% complete):

- NPM-based starter template system
- Plugin discovery and installation
- Community marketplace

### 🚀 Medium Priority

**Cross-Platform Support**:

- Windows DNS management
- Linux certificate handling
- Platform-specific installers

**User Experience**:

- Onboarding flow improvements
- Error message clarity
- Performance optimizations

### 📖 Always Welcome

**Documentation**:

- User tutorials and guides
- API documentation improvements
- Translation into other languages
- Video walkthroughs

**Testing**:

- End-to-end test scenarios
- Performance test cases
- Cross-platform testing
- Edge case coverage

## Getting Help

### Community Support

- **GitHub Discussions**: Ask questions, share ideas
- **GitHub Issues**: Report bugs, request features
- **Discord** (Coming Soon): Real-time chat with maintainers

### For Contributors

- **Architecture Questions**: See `docs/developer/architecture/`
- **Testing Help**: See `docs/developer/testing/strategy.md`
- **API Documentation**: Auto-generated at `docs/api/`

### Mentorship

New to open source? We're here to help!

- Tag @davidwkeith in issues for guidance
- Start with `good first issue` labels
- Pair programming sessions available for complex features

## Recognition

Contributors are recognized in:

- Release notes for each version
- GitHub contributors page
- Project README credits section
- Special thanks in commit messages

## Release Process

- **Regular Releases**: Monthly minor releases, quarterly majors
- **Contributor Involvement**: Community input on roadmap priorities
- **Beta Testing**: Early access for active contributors

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code. Report issues to [git@dwk.io](mailto:git@dwk.io).

## Questions?

- **General Questions**: Open a GitHub Discussion
- **Bugs**: Create an Issue with our bug report template
- **Security Issues**: Email [git@dwk.io](mailto:git@dwk.io) privately

---

**Ready to contribute?** Check out our [good first issues](https://github.com/anglesite/anglesite/labels/good%20first%20issue) and let's build something amazing together! 🚀
