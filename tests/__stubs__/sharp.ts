// See satori.ts — same rationale. Real `sharp` is a template devDependency;
// tests intercept via `vi.mock("sharp")`.
export default function sharp() {
  throw new Error("sharp stub — vi.mock should intercept this in tests");
}
