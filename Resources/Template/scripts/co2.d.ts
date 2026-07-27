// @tgwf/co2 ships no type declarations (no `types` field, no .d.ts files in the published
// package) — without this, `astro check` fails with ts(7016) on co2-badge.ts's import, and
// since co2-badge.ts is unconditionally loaded by astro.config.ts, that breaks `npm run build`
// (which runs `astro check` first) for every site, not just ones with the co2Badge integration
// installed. Typed to the one surface this template actually uses.
declare module "@tgwf/co2" {
  export interface CO2Options {
    model?: "1byte" | "swd";
  }
  export class co2 {
    constructor(options?: CO2Options);
    perByte(bytes: number, greenHosting?: boolean): number;
  }
}
