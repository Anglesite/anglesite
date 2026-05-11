// Stub wawoff2 for tests. The real package is a template devDependency; aliasing
// to this stub means "wawoff2" resolves to the same module ID regardless of
// whether `template/node_modules/wawoff2` is installed locally. Tests use
// `vi.mock("wawoff2")` to substitute behavior — this stub only needs to satisfy
// the import shape (default export with a `decompress` function).
export default {
  decompress(_input: Uint8Array): Promise<Uint8Array> {
    throw new Error("wawoff2 stub — vi.mock should intercept this in tests");
  },
};
