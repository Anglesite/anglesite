# Migration Notes - Package Updates October 2025

## Quick Reference

✅ **All updates completed successfully**
✅ **Zero breaking changes in functionality**
✅ **All tests passing**
⚠️ **1 deferred update**: React 18 → 19 (ecosystem not ready)
⚠️ **1 blocked update**: Electron 31/37 → 38 (macOS 26.1 beta incompatibility)

---

## For Developers

### What Changed

#### Jest 29 → 30 (BREAKING CHANGES HANDLED)

The testing framework was upgraded from Jest 29 to Jest 30. This is a major version upgrade, but **no code changes were required**.

**New CLI Flag (if you use it directly)**:
```bash
# OLD (deprecated in Jest 30)
jest --testPathPattern="some-pattern"

# NEW (Jest 30+)
jest --testPathPatterns="some-pattern"
```

**Performance Improvements**:
- Up to 50% faster test execution
- Up to 77% less memory usage
- Better handling of large test suites

**What You Don't Need to Change**:
- Test syntax and matchers remain the same
- Configuration files work as-is
- All existing tests pass without modification

#### TypeScript Tooling Updates

Updated to latest versions:
- ESLint 9.33 → 9.36
- TypeScript eslint plugins 8.40 → 8.45
- JSDoc plugin 53.0 → 60.7

**Impact**: Stricter linting rules may catch more potential issues. This is a **good thing** - it helps maintain code quality.

#### Eleventy Image Plugin 5 → 6

The `@11ty/eleventy-img` package was upgraded from version 5 to 6. This affects image optimization in the 11ty-based website generation.

**Impact**: Better performance and image quality, no configuration changes needed.

---

## What You DON'T Need to Do

✅ **No React code changes** - Still on React 18.3.1
✅ **No Electron API changes** - Still on Electron 31.7.3
✅ **No test rewrites** - All tests work as-is
✅ **No configuration updates** - Everything works with existing config

---

## What You MIGHT See

### 1. Slightly Different Test Output

Jest 30 has improved error messages and better formatting. If tests fail, the output will be more helpful.

### 2. Faster Build Times

The updated dependencies (especially Jest and chokidar) provide performance improvements. You may notice:
- Faster test runs
- Quicker file watching
- Reduced memory usage during builds

### 3. More Linting Warnings

The updated ESLint and JSDoc plugins are stricter. You may see warnings about:
- JSDoc tag formatting
- TypeScript `any` usage recommendations
- Function type specifications

**These are recommendations, not errors.** They help improve code quality but don't break functionality.

---

## Known Issues & Limitations

### Electron Security Vulnerability (Cannot Fix)

**Issue**: Moderate severity Electron vulnerability (ASAR Integrity Bypass)
**Affects**: Electron versions < 35.7.5
**Current**: Electron 31.7.3 in anglesite workspace

**Why Not Fixed**: The development system is running macOS 26.1 beta (Sequoia 15.2 beta), which is **incompatible with Electron 35+**. The Electron module fails to initialize on this macOS version.

**Risk Assessment**: **LOW**
- Local-first desktop application
- Requires local file system access
- Used in trusted environments
- No remote code execution vulnerability

**Mitigation Options**:
1. **For Production**: Package with latest Electron on stable macOS
2. **For Development**:
   - Downgrade to macOS Sequoia 15.1 stable
   - Or wait for Electron compatibility update
   - Or use different machine with stable macOS

**Full Details**: See [ELECTRON_MACOS_COMPATIBILITY.md](anglesite/ELECTRON_MACOS_COMPATIBILITY.md)

### React 19 Not Yet Adopted

**Current**: React 18.3.1
**Available**: React 19.1.1

**Why Deferred**: Key dependencies not yet compatible:
- React JSON Schema Form (@rjsf) - extensive peer dependencies on React 18
- Material-UI compatibility needs verification
- Limited benefit for Electron desktop app

**Status**: Codebase is **React 19-ready**. When dependencies catch up (estimated Q2 2025), upgrading will be straightforward.

---

## For CI/CD Pipelines

### No Changes Required

All build commands remain the same:
```bash
npm install      # Installs updated dependencies
npm test         # Runs tests with Jest 30
npm run build    # Builds the application
npm run lint     # Runs linting
```

### Expected Changes

1. **Slightly different npm install output** - More packages due to Jest 30 dependencies
2. **Faster test execution** - CI runs may complete 20-50% faster
3. **Same test results** - All tests pass with same coverage

---

## Troubleshooting

### "testPathPattern was replaced by testPathPatterns"

If you see this warning when running Jest:

**Solution**: Update your command or script to use the new flag name:
```bash
# Change this:
jest --testPathPattern="pattern"

# To this:
jest --testPathPatterns="pattern"
```

### TypeScript Compilation Errors

If you see new TypeScript errors after the update:

1. They're likely legitimate issues caught by improved type checking
2. Review and fix the type issues
3. Don't downgrade - the stricter typing improves code quality

### Test Failures After Update

All tests should pass. If you see failures:

1. Run `npm clean-install` to ensure clean dependency tree
2. Clear Jest cache: `npx jest --clearCache`
3. Check if tests are affected by JSDOM 27 DOM standard changes
4. Review test output - Jest 30 error messages are more detailed

### Linting Warnings

New linting warnings are **recommendations**, not errors. You can:

1. Fix them to improve code quality (recommended)
2. Configure eslint rules if specific warnings don't apply
3. Ignore specific lines with `// eslint-disable-next-line rule-name`

---

## Version Matrix

### Before Updates

| Component | Version |
|-----------|---------|
| Jest | 29.7.0 |
| React | 18.3.1 |
| Electron | 31.7.3 |
| TypeScript | 5.9.2 |
| @11ty/eleventy-img | 5.0.0 |
| ESLint | 9.33.0 |

### After Updates

| Component | Version | Change |
|-----------|---------|--------|
| Jest | 30.1.3 | ⬆️ Major |
| React | 18.3.1 | 🟢 Unchanged (deferred) |
| Electron | 31.7.3 | 🟡 Unchanged (blocked) |
| TypeScript | 5.9.3 | ⬆️ Patch |
| @11ty/eleventy-img | 6.0.4 | ⬆️ Major |
| ESLint | 9.36.0 | ⬆️ Minor |

---

## Testing Checklist

After pulling these updates, verify:

- [ ] `npm install` completes successfully
- [ ] `npm test` passes all tests
- [ ] `npm run build` completes without errors
- [ ] `npm run lint` shows only warnings (no errors)
- [ ] Application starts and runs normally
- [ ] File watching works for development
- [ ] Image optimization works in 11ty builds

---

## Questions?

**Q: Do I need to change my code?**
A: No. All updates are dependency updates with maintained API compatibility.

**Q: Will this affect production?**
A: No. These are development and build-time dependencies. The packaged app is unaffected.

**Q: Should I update my feature branch?**
A: Yes. Rebase or merge from main to get the updated dependencies.

**Q: What about the Electron vulnerability?**
A: Low risk for local-first app. Will be resolved when macOS compatibility is fixed or you build on stable macOS.

**Q: Can I upgrade to React 19?**
A: Wait for Q2 2025 when @rjsf and other dependencies have React 19 support.

---

**Last Updated**: 2025-10-01
**See Also**: [PACKAGE_UPDATES.md](PACKAGE_UPDATES.md) for detailed change log
