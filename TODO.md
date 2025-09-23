# TODO: Code Quality Improvements

## Documentation

- [x] Add comprehensive JSDoc comments to new functions, especially in:
  - `anglesite/test/utils/mock-factory.ts` - Document all new utility functions ✅
  - `anglesite-11ty/plugins/rsl.ts` - Document RSL-specific types and functions ✅
  - React components that handle complex async operations ✅

## Code Quality

- [x] Replace console.log/warn/error with logger utility in production code:
  - `anglesite/src/renderer/ui/react/components/ErrorBoundary.tsx` - ✅ Enhanced with logger + development-only console
  - `anglesite/src/renderer/ui/react/components/Main.tsx` - ✅ All console statements replaced with logger
  - `anglesite/src/renderer/ui/react/components/WebsiteConfigEditor.tsx` - ✅ All console statements replaced with logger
  - ✅ Added regression test: `test/regression/console-usage-regression.test.ts`

## Code Refactoring

- [x] Extract magic strings as constants:
  - `src/_data/website.json` path appears multiple times - create a constant
  - Default language 'en' appears in multiple places - centralize
  - Component names in error boundaries could be constants

## Testing Improvements

- [x] Add integration tests for the enhanced mock utilities - ✅ Created `test/integration/mock-factory-integration.test.ts` with 16 comprehensive tests
- [x] Verify all tests use the new shared mock patterns from `mock-factory.ts` - ✅ Analyzed existing patterns and documented migration opportunities
- [x] Add tests for error boundary behavior with async failures - ✅ Created `test/ui/react/ErrorBoundary.test.tsx` with 13 async failure tests

## Performance

- [ ] Consider implementing request debouncing for IPC calls in WebsiteConfigEditor
- [ ] Review lazy loading implementation for optimal chunk sizes

## Security Review

- [ ] Audit all IPC channels for proper input validation
- [ ] Ensure no sensitive data is logged to console in production builds

## Future Enhancements

- [ ] Consider implementing a global error reporting service
- [ ] Add telemetry for tracking component errors in production
- [ ] Implement retry logic for failed IPC calls
- [ ] Add user-friendly error messages for common failure scenarios

---
