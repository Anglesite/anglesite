import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyEdit } from "../server/apply-edit-dispatcher.mjs";
import { fileVersion } from "../server/file-version.mjs";

const CARD = `---
interface Props {
  title: string;
}
const { title } = Astro.props;
---
<article class="card"><h2>{title}</h2></article>

<script>
  console.log("card mounted");
</script>
`;

function parseContent(response) {
  return JSON.parse(response.content[0].text);
}

describe("applyEdit — component-frontmatter ops", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "anglesite-aed-fm-"));
    mkdirSync(join(tmpDir, "src", "components"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), CARD);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects a component-frontmatter op with no component payload", async () => {
    const response = await applyEdit(tmpDir, { id: "1", path: "x", op: "set-props-interface", value: {} });
    expect(response.isError).toBe(true);
    expect(parseContent(response).reason).toBe("invalid-input");
  });

  it("applies set-props-interface and piggybacks a fresh model", async () => {
    const baseVersion = fileVersion(CARD);
    const response = await applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Card.astro",
      op: "set-props-interface",
      component: {
        path: "src/components/Card.astro",
        baseVersion,
        props: [
          { name: "title", type: "string", optional: false, default: null },
          { name: "subtitle", type: "string", optional: true, default: null },
        ],
      },
    });
    expect(response.isError).toBeFalsy();
    const body = parseContent(response);
    expect(body.type).toBe("anglesite:edit-applied");
    expect(body.model).toBeDefined();
    expect(body.model.frontmatter.props).toEqual([
      { name: "title", type: "string", optional: false, default: null },
      { name: "subtitle", type: "string", optional: true, default: null },
    ]);
  });

  it("applies set-script-zone against the client zone and piggybacks a fresh model", async () => {
    const baseVersion = fileVersion(CARD);
    const response = await applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Card.astro",
      op: "set-script-zone",
      component: { path: "src/components/Card.astro", baseVersion, zone: "client", source: 'console.log("remounted");' },
    });
    expect(response.isError).toBeFalsy();
    const body = parseContent(response);
    expect(body.model.clientScript.source).toContain("remounted");
  });

  it("surfaces stale as a failed reply", async () => {
    const response = await applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Card.astro",
      op: "set-props-interface",
      component: { path: "src/components/Card.astro", baseVersion: "sha256:000000000000", props: [] },
    });
    expect(response.isError).toBe(true);
    expect(parseContent(response).reason).toBe("stale");
  });

  it("re-checks staleness after set-script-zone's async gap, refusing a concurrent write race", async () => {
    const baseVersion = fileVersion(CARD);

    const editPromise = applyEdit(tmpDir, {
      id: "1",
      path: "src/components/Card.astro",
      op: "set-script-zone",
      component: { path: "src/components/Card.astro", baseVersion, zone: "client", source: 'console.log("remounted");' },
    });

    // Same race shape as apply-edit-dispatcher-component-style.test.ts: a second edit
    // lands while this call is suspended at resolveComponentFrontmatter's own
    // (synchronous) work — here the resolver itself doesn't await before the client-zone
    // branch's `await parse(...)`, so this write races the dispatcher's second baseVersion
    // check the same way.
    writeFileSync(join(tmpDir, "src", "components", "Card.astro"), CARD.replace("card mounted", "card remounted twice"));

    const response = await editPromise;
    expect(response.isError).toBe(true);
    expect(parseContent(response).reason).toBe("stale");

    const onDisk = readFileSync(join(tmpDir, "src", "components", "Card.astro"), "utf-8");
    expect(onDisk).toContain("card remounted twice");
  });
});
