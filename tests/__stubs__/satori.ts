// Stub satori for tests. The real package is a template devDependency; aliasing
// to this stub means "satori" resolves to the same module ID regardless of
// whether `template/node_modules/satori` is installed locally. Tests use
// `vi.mock("satori")` to substitute behavior — this stub only needs to satisfy
// the import shape (default export = function).
export default function satori() {
  throw new Error("satori stub — vi.mock should intercept this in tests");
}
