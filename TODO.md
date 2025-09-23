# TODO: Code Quality Improvements

## Documentation

- [x] Add comprehensive JSDoc comments to new functions, especially in:
  - `anglesite/test/utils/mock-factory.ts` - Document all new utility functions ✅
  - `anglesite-11ty/plugins/rsl.ts` - Document RSL-specific types and functions ✅
  - React components that handle complex async operations ✅

## Code Quality

- [ ] Replace console.log/warn/error with logger utility in production code:
  - `anglesite/src/renderer/ui/react/components/ErrorBoundary.tsx` - Lines 45-51 (keep for debugging but use logger)
  - `anglesite/src/renderer/ui/react/components/Main.tsx` - Multiple console.log statements
  - Search for other instances with: `grep -r "console\." --include="*.tsx" --include="*.ts" --exclude-dir=test`

## Code Refactoring

- [ ] Extract magic strings as constants:
  - `src/_data/website.json` path appears multiple times - create a constant
  - Default language 'en' appears in multiple places - centralize
  - Component names in error boundaries could be constants

## Testing Improvements

- [ ] Add integration tests for the enhanced mock utilities
- [ ] Verify all tests use the new shared mock patterns from `mock-factory.ts`
- [ ] Add tests for error boundary behavior with async failures

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
