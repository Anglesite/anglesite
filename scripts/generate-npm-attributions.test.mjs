import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findLicenseText, extractLicenseId, extractHomepage, collectPackages, generate,
} from "./generate-npm-attributions.mjs";

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "attr-npm-test-"));
}

function writePackage(root, name, { version = "1.0.0", license, licenses, homepage, repository, licenseFile } = {}) {
  const dir = name.startsWith("@") ? join(root, ...name.split("/")) : join(root, name);
  mkdirSync(dir, { recursive: true });
  const pkg = { name, version };
  if (license !== undefined) pkg.license = license;
  if (licenses !== undefined) pkg.licenses = licenses;
  if (homepage !== undefined) pkg.homepage = homepage;
  if (repository !== undefined) pkg.repository = repository;
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  if (licenseFile) writeFileSync(join(dir, licenseFile.name), licenseFile.text);
  return dir;
}

test("findLicenseText finds LICENSE and both LICENCE spellings, else null", () => {
  const root = makeTempDir();
  try {
    const withLicense = join(root, "a");
    mkdirSync(withLicense);
    writeFileSync(join(withLicense, "LICENSE"), "MIT text");
    assert.equal(findLicenseText(withLicense), "MIT text");

    const withLicence = join(root, "b");
    mkdirSync(withLicence);
    writeFileSync(join(withLicence, "LICENCE.md"), "British spelling text");
    assert.equal(findLicenseText(withLicence), "British spelling text");

    const withNeither = join(root, "c");
    mkdirSync(withNeither);
    assert.equal(findLicenseText(withNeither), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("extractLicenseId handles string, object, and legacy array shapes", () => {
  assert.equal(extractLicenseId({ license: "MIT" }), "MIT");
  assert.equal(extractLicenseId({ license: { type: "Apache-2.0" } }), "Apache-2.0");
  assert.equal(extractLicenseId({ licenses: [{ type: "ISC" }] }), "ISC");
  assert.equal(extractLicenseId({}), null);
});

test("extractHomepage prefers homepage, falls back to repository, strips git+ and .git", () => {
  assert.equal(extractHomepage({ homepage: "https://example.com" }), "https://example.com");
  assert.equal(extractHomepage({ repository: "https://github.com/a/b" }), "https://github.com/a/b");
  assert.equal(
    extractHomepage({ repository: { url: "git+https://github.com/a/b.git" } }),
    "https://github.com/a/b"
  );
  assert.equal(extractHomepage({}), null);
});

test("collectPackages walks scoped and nested node_modules and dedupes by name@version", () => {
  const root = makeTempDir();
  try {
    writePackage(join(root, "node_modules"), "left-pad", { version: "1.3.0" });
    writePackage(join(root, "node_modules"), "@scope/thing", { version: "2.0.0" });
    // Nested (unhoisted) transitive dependency:
    writePackage(join(root, "node_modules", "left-pad", "node_modules"), "nested-dep", { version: "0.1.0" });

    const found = collectPackages(join(root, "node_modules"));
    assert.equal(found.size, 3);
    assert.ok(found.has("left-pad@1.3.0"));
    assert.ok(found.has("@scope/thing@2.0.0"));
    assert.ok(found.has("nested-dep@0.1.0"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generate produces sorted entries with license text, id, and homepage", () => {
  const root = makeTempDir();
  try {
    const nm = join(root, "node_modules");
    writePackage(nm, "zeta-pkg", {
      version: "1.0.0", license: "MIT", homepage: "https://zeta.example",
      licenseFile: { name: "LICENSE", text: "MIT License text for zeta" },
    });
    writePackage(nm, "alpha-pkg", {
      version: "2.0.0", license: { type: "Apache-2.0" },
      licenseFile: { name: "LICENCE.md", text: "Apache text for alpha" },
    });
    const overridesPath = join(root, "overrides.json");
    writeFileSync(overridesPath, "{}");

    const entries = generate(nm, overridesPath);
    assert.deepEqual(entries.map((e) => e.name), ["alpha-pkg", "zeta-pkg"]);
    assert.equal(entries[0].licenseSPDXId, "Apache-2.0");
    assert.equal(entries[1].licenseText, "MIT License text for zeta");
    assert.equal(entries[1].homepage, "https://zeta.example");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generate throws listing packages with no license file and no override", () => {
  const root = makeTempDir();
  try {
    const nm = join(root, "node_modules");
    writePackage(nm, "no-license-pkg", { version: "1.0.0" }); // no license field, no LICENSE file
    const overridesPath = join(root, "overrides.json");
    writeFileSync(overridesPath, "{}");

    assert.throws(() => generate(nm, overridesPath), /no-license-pkg/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an override supplies license text for a package that ships none", () => {
  const root = makeTempDir();
  try {
    const nm = join(root, "node_modules");
    writePackage(nm, "no-license-pkg", { version: "1.0.0" });
    const overridesPath = join(root, "overrides.json");
    writeFileSync(overridesPath, JSON.stringify({
      "no-license-pkg@1.0.0": { licenseText: "Confirmed MIT text.", licenseSPDXId: "MIT" },
    }));

    const entries = generate(nm, overridesPath);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].licenseText, "Confirmed MIT text.");
    assert.equal(entries[0].licenseSPDXId, "MIT");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
