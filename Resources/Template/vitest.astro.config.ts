import { getViteConfig } from "astro/config";

export default getViteConfig({
  test: {
    include: ["src/lib/animations-catalog.spec.ts"],
  },
});
