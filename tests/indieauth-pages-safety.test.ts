/**
 * auth-pages script-context safety (#363, problem 2). Values interpolated into
 * an inline <script> (the register token, the consent query) must be escaped so
 * a `</script>` in attacker-controlled input can't break out of the element.
 * The register token comes from searchParams.get() — decoded, literal `<` — so
 * /auth/register?token=</script><script>… is the exploitable vector.
 */
import { describe, it, expect } from "vitest";
import {
  renderRegisterPage,
  renderConsentPage,
} from "../template/worker/auth-pages.js";

const BREAKOUT = "</script><script>alert(1)</script>";

describe("auth page script-context safety", () => {
  it("escapes </script> in the register token so it can't break out", () => {
    const html = renderRegisterPage({ token: BREAKOUT });
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003C"); // escaped form inside the JSON string
  });

  it("escapes </script> in the consent query", () => {
    const url =
      "https://example.com/auth?client_id=https://app.example&x=" +
      encodeURIComponent(BREAKOUT);
    const html = renderConsentPage({ request: new Request(url) });
    expect(html).not.toContain("</script><script>alert(1)");
  });
});
