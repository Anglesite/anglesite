// See satori.ts — same rationale. Real `@resvg/resvg-js` is a template
// devDependency; tests intercept via `vi.mock("@resvg/resvg-js")`.
export class Resvg {
  constructor(_svg: string) {
    throw new Error("resvg stub — vi.mock should intercept this in tests");
  }
  render() {
    throw new Error("resvg stub — vi.mock should intercept this in tests");
  }
}
