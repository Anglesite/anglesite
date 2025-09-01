# Anglesite Project TODO List

ABOUTME: Comprehensive tracking of features, improvements, and technical debt across the Anglesite project
ABOUTME: Organized by priority and development phase with clear ownership and completion criteria

This document tracks all pending tasks, features, and technical improvements for the Anglesite project. Items are organized by priority and development phase.

## 🚨 Critical Priority (Blocking Release)

### v1.0 Release Blockers

- [ ] **Complete WYSIWYG Editor Implementation**
  - Status: In Progress
  - Owner: Core Team
  - Deadline: Q1 2024
  - Description: Finish visual editing capabilities for content creation

- [ ] **Website Duplication Functionality**
  - Status: Not Started
  - Location: `anglesite/app/ui/menu.ts:TODO`
  - Description: Allow users to duplicate existing websites as starting templates

- [ ] **Website Rename Functionality**
  - Status: Not Started
  - Location: `anglesite/app/ui/menu.ts:TODO`
  - Description: Enable renaming of existing website projects

## 🔥 High Priority (v1.0 Features)

### Core Functionality

- [ ] **Website Metadata Editing**
  - Status: Not Started
  - Location: `anglesite/app/ui/menu.ts:TODO`
  - Description: UI for editing website title, description, author, etc.

- [ ] **Theme Management System**
  - Status: Partially Implemented
  - Location: `anglesite/app/ui/menu.ts:TODO`
  - Tasks:
    - [ ] Theme changing functionality
    - [ ] Theme saving functionality
    - [ ] Theme marketplace integration (v1.1)

### Development Tools

- [ ] **Server Settings Dialog**
  - Status: Not Started
  - Location: `anglesite/app/ui/menu.ts:TODO`
  - Description: UI for configuring development server options

- [ ] **Language and Region Settings**
  - Status: Not Started
  - Location: `anglesite/app/ui/menu.ts:TODO`
  - Description: Internationalization and localization preferences

## 📋 Medium Priority (v1.1 Features)

### Collaboration & Sharing

- [ ] **Website Sharing Functionality**
  - Status: Not Started
  - Location: `anglesite/app/ui/menu.ts:TODO`
  - Description: Share websites with team members or collaborators

- [ ] **Website Publishing Integration**
  - Status: Not Started
  - Location: `anglesite/app/ui/menu.ts:TODO`
  - Description: One-click publishing to Netlify, Vercel, GitHub Pages

### Networking & Discovery

- [ ] **Bonjour Service Discovery**
  - Status: Not Started
  - Location: `anglesite/app/ui/menu.ts:TODO`
  - Description: Auto-discover Anglesite instances on local network

### Configuration Management

- [ ] **Settings Store Implementation**
  - Status: In Progress
  - Location: `anglesite/app/dns/hosts-manager.ts:TODO`
  - Description: Persistent settings storage for user preferences
  - Note: Currently using hardcoded values

- [ ] **PID Tracking for Website Servers**
  - Status: Not Started
  - Location: `anglesite/app/server/website-server-manager.ts:TODO`
  - Description: Track process IDs for better server management

## 📝 Documentation TODOs

### Technical Documentation

- [ ] **WebC Plugin Conflict Prevention Documentation**
  - Status: In Progress
  - Location: `docs/developer/features/webc-plugins.md:TODO`
  - Description: Document specific conflicts and resolution mechanisms
  - Details needed:
    - Technical conflict scenarios
    - Prevention mechanisms
    - Troubleshooting guide

### User Documentation

- [ ] **Complete User Guide**
  - Status: Planned
  - Target: v1.0 Release
  - Location: `docs/user-guide/`
  - Description: Comprehensive tutorials for end users

- [ ] **Migration Guides**
  - Status: Planned
  - Target: v1.1 Release
  - Description: Import from WordPress, Jekyll, Hugo, etc.

## 🐛 Technical Debt & Bug Fixes

### High Priority Fixes

- [ ] **Eleventy WebC Plugin Workaround**
  - Status: Workaround Implemented
  - Location: `anglesite/app/server/per-website-server.ts:FIXME`
  - Issue: [eleventy-plugin-webc/#86](https://github.com/11ty/eleventy-plugin-webc/issues/86)
  - Description: Remove workaround once upstream issue is resolved

- [ ] **Eleventy Configuration Workaround**
  - Status: Workaround Implemented
  - Location: `anglesite/app/eleventy/.eleventy.js:FIXME`
  - Issue: [eleventy-plugin-webc/#86](https://github.com/11ty/eleventy-plugin-webc/issues/86)
  - Description: Clean up configuration once WebC plugin is fixed

### Testing & Quality

- [ ] **Auto-Domains Settings Integration**
  - Status: Test Implementation Needed
  - Location: `anglesite/test/ui/settings-theme.test.ts:TODO`
  - Description: Implement settings store integration in tests

## 📋 Future Enhancements (v1.2+)

### Platform Expansion

- [ ] **Windows Support**
  - Status: Planned
  - Target: v1.1
  - Description: Full Windows platform support with native features

- [ ] **Linux Support**
  - Status: Planned
  - Target: v1.1
  - Description: Linux desktop environment integration

### Advanced Features

- [ ] **Plugin Marketplace**
  - Status: Designed
  - Target: v1.1
  - Description: Community themes, starters, and functionality plugins

- [ ] **Team Collaboration Features**
  - Status: Research Phase
  - Target: v1.2
  - Description: Real-time collaboration, version control integration

- [ ] **Advanced Publishing Options**
  - Status: Planned
  - Target: v1.2
  - Description: Custom deployment pipelines, CDN integration

## 🎯 Completion Criteria

### v1.0 Release Ready When

- [ ] All Critical Priority items completed
- [ ] High Priority core functionality implemented
- [ ] User documentation complete
- [ ] All major workarounds resolved
- [ ] 90%+ test coverage maintained
- [ ] Security audit completed

### v1.1 Release Ready When

- [ ] Platform support (Windows/Linux) completed
- [ ] Plugin marketplace launched
- [ ] Migration tools functional
- [ ] All Medium Priority items completed

## 📊 Progress Tracking

### Current Status (v0.1.0-alpha)

- **Phase 1**: Complete ✅ (Core desktop application)
- **Phase 2**: In Progress 🚧 (WYSIWYG editing)
- **Phase 3**: Planned 📋 (Platform expansion)

### Metrics

- **Test Coverage**: 90%+ maintained
- **Open TODOs**: 15+ items tracked
- **Critical Blockers**: 2 items
- **Documentation Coverage**: 80% complete

---

## 📝 Contributing to TODOs

### Adding New TODOs

1. Add inline comments in code: `// TODO: Description of task`
2. Update this document with the new item
3. Assign priority level and target version
4. Link to relevant issue if applicable

### Completing TODOs

1. ✅ Complete the implementation
2. ✅ Update tests and documentation
3. ✅ Check off the item in this document
4. ✅ Remove inline TODO comment
5. ✅ Create PR with changes

### Priority Guidelines

- **Critical**: Blocks release, breaks functionality
- **High**: Important features for user experience
- **Medium**: Nice-to-have improvements
- **Future**: Long-term enhancements

---

Last Updated: _2024 - This document is maintained alongside development progress_
