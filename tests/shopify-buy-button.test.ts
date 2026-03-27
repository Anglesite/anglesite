import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildShopifyCSP,
  parseShopifyEmbed,
} from "../template/scripts/shopify-buy-button.js";

const templateDir = resolve(import.meta.dirname!, "..", "template");

// ---------------------------------------------------------------------------
// parseShopifyEmbed
// ---------------------------------------------------------------------------

describe("parseShopifyEmbed", () => {
  it("extracts domain and product ID from a standard embed snippet", () => {
    const embed = `<div id="product-component-123"></div>
<script type="text/javascript">
/*<![CDATA[*/
(function () {
  var scriptURL = 'https://sdks.shopifycdn.com/buy-button/latest/buy-button-storefront.min.js';
  if (window.ShopifyBuy) {
    if (window.ShopifyBuy.UI) {
      ShopifyBuyInit();
    } else {
      loadScript();
    }
  } else {
    loadScript();
  }
  function loadScript() {
    var script = document.createElement('script');
    script.async = true;
    script.src = scriptURL;
    (document.getElementsByTagName('head')[0] || document.getElementsByTagName('body')[0]).appendChild(script);
    script.onload = ShopifyBuyInit;
  }
  function ShopifyBuyInit() {
    var client = ShopifyBuy.buildClient({
      domain: 'my-cool-store.myshopify.com',
      storefrontAccessToken: 'abc123def456',
    });
    ShopifyBuy.UI.onReady(client).then(function (ui) {
      ui.createComponent('product', {
        id: '7654321098765',
        node: document.getElementById('product-component-123'),
      });
    });
  }
})();
/*]]>*/
</script>`;

    const result = parseShopifyEmbed(embed);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("my-cool-store.myshopify.com");
    expect(result!.storefrontAccessToken).toBe("abc123def456");
    expect(result!.productId).toBe("7654321098765");
  });

  it("returns null for invalid embed code", () => {
    expect(parseShopifyEmbed("not a shopify embed")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseShopifyEmbed("")).toBeNull();
  });

  it("extracts from embed with single quotes", () => {
    const embed = `domain: 'test-shop.myshopify.com', storefrontAccessToken: 'token789', id: '1234567890123'`;
    const result = parseShopifyEmbed(embed);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("test-shop.myshopify.com");
    expect(result!.storefrontAccessToken).toBe("token789");
    expect(result!.productId).toBe("1234567890123");
  });

  it("extracts from embed with double quotes", () => {
    const embed = `domain: "another-shop.myshopify.com", storefrontAccessToken: "tokenABC", id: "9876543210987"`;
    const result = parseShopifyEmbed(embed);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("another-shop.myshopify.com");
    expect(result!.storefrontAccessToken).toBe("tokenABC");
    expect(result!.productId).toBe("9876543210987");
  });
});

// ---------------------------------------------------------------------------
// buildShopifyCSP
// ---------------------------------------------------------------------------

describe("buildShopifyCSP", () => {
  it("includes cdn.shopify.com in script-src", () => {
    const csp = buildShopifyCSP();
    expect(csp["script-src"]).toContain("cdn.shopify.com");
  });

  it("includes sdks.shopifycdn.com in script-src", () => {
    const csp = buildShopifyCSP();
    expect(csp["script-src"]).toContain("sdks.shopifycdn.com");
  });

  it("includes monorail-edge.shopifysvc.com in connect-src", () => {
    const csp = buildShopifyCSP();
    expect(csp["connect-src"]).toContain("monorail-edge.shopifysvc.com");
  });

  it("includes cdn.shopify.com in img-src", () => {
    const csp = buildShopifyCSP();
    expect(csp["img-src"]).toContain("cdn.shopify.com");
  });

  it("includes *.myshopify.com in connect-src for storefront API", () => {
    const csp = buildShopifyCSP();
    expect(csp["connect-src"]).toContain("*.myshopify.com");
  });
});

// ---------------------------------------------------------------------------
// ShopifyBuyButton component
// ---------------------------------------------------------------------------

describe("ShopifyBuyButton component", () => {
  const componentPath = resolve(
    templateDir,
    "src/components/ShopifyBuyButton.astro",
  );

  it("exists", () => {
    expect(existsSync(componentPath)).toBe(true);
  });

  it("accepts domain, storefrontAccessToken, and productId props", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("domain");
    expect(src).toContain("storefrontAccessToken");
    expect(src).toContain("productId");
  });

  it("loads the Shopify Buy Button SDK from sdks.shopifycdn.com", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("sdks.shopifycdn.com/buy-button");
  });

  it("calls ShopifyBuy.buildClient with domain and token", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("ShopifyBuy.buildClient");
  });

  it("calls createComponent with the product ID", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).toContain("createComponent");
  });

  it("does not import a layout (it is embedded in pages)", () => {
    const src = readFileSync(componentPath, "utf-8");
    expect(src).not.toContain("import BaseLayout");
  });
});

// ---------------------------------------------------------------------------
// Pre-deploy scan allows cdn.shopify.com and sdks.shopifycdn.com
// ---------------------------------------------------------------------------

describe("pre-deploy scan allows Shopify scripts", () => {
  it("includes cdn.shopify.com in allowedScripts", async () => {
    const { allowedScripts } = await import(
      "../template/scripts/pre-deploy-check.js"
    );
    expect(allowedScripts).toContain("cdn.shopify.com");
  });

  it("includes sdks.shopifycdn.com in allowedScripts", async () => {
    const { allowedScripts } = await import(
      "../template/scripts/pre-deploy-check.js"
    );
    expect(allowedScripts).toContain("sdks.shopifycdn.com");
  });

  it("does not flag Shopify Buy Button SDK script", async () => {
    const { scanScripts } = await import(
      "../template/scripts/pre-deploy-check.js"
    );
    const html =
      '<script src="https://sdks.shopifycdn.com/buy-button/latest/buy-button-storefront.min.js"></script>';
    expect(scanScripts(html)).toEqual([]);
  });

  it("does not flag cdn.shopify.com script", async () => {
    const { scanScripts } = await import(
      "../template/scripts/pre-deploy-check.js"
    );
    const html =
      '<script src="https://cdn.shopify.com/shopifycloud/buy-button/assets/buy-button-storefront.min.js"></script>';
    expect(scanScripts(html)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CSP headers
// ---------------------------------------------------------------------------

describe("CSP headers allow Shopify", () => {
  it("includes cdn.shopify.com in script-src", () => {
    const headers = readFileSync(
      resolve(templateDir, "public/_headers"),
      "utf-8",
    );
    expect(headers).toContain("cdn.shopify.com");
  });

  it("includes sdks.shopifycdn.com in script-src", () => {
    const headers = readFileSync(
      resolve(templateDir, "public/_headers"),
      "utf-8",
    );
    expect(headers).toContain("sdks.shopifycdn.com");
  });
});
