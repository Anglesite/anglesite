// ESM resolution hook that simulates `sharp` being absent from node_modules,
// reproducing the ERR_MODULE_NOT_FOUND a stale/partial checkout hits (#361).
// Used via `node --import ./register.mjs <probe>` in optimize-images-sharp-optional.test.js.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "sharp") {
    const err = new Error(
      "Cannot find package 'sharp' imported from optimize-images.mjs (simulated absent)",
    );
    err.code = "ERR_MODULE_NOT_FOUND";
    throw err;
  }
  return nextResolve(specifier, context);
}
