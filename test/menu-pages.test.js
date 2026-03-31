import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const menuPage = readFileSync(
  join(root, 'template', 'src', 'pages', 'menu.astro'),
  'utf-8',
);
const slugPage = readFileSync(
  join(root, 'template', 'src', 'pages', 'menu', '[slug].astro'),
  'utf-8',
);

// ---------------------------------------------------------------------------
// Schema.org JSON-LD — menu-specific structured data contracts
// ---------------------------------------------------------------------------
describe('menu Schema.org structured data', () => {
  it('uses Menu → MenuSection → MenuItem type hierarchy', () => {
    for (const page of [menuPage, slugPage]) {
      expect(page).toContain('"@type": "Menu"');
      expect(page).toContain('"@type": "MenuSection"');
      expect(page).toContain('"@type": "MenuItem"');
      expect(page).toContain('hasMenuSection');
      expect(page).toContain('hasMenuItem');
    }
  });

  it('maps dietary tags to schema.org diet URLs', () => {
    const diets = [
      'VegetarianDiet',
      'VeganDiet',
      'GlutenFreeDiet',
      'HalalDiet',
      'KosherDiet',
    ];
    for (const page of [menuPage, slugPage]) {
      for (const diet of diets) {
        expect(page).toContain(`https://schema.org/${diet}`);
      }
      expect(page).toContain('suitableForDiet');
    }
  });

  it('conditionally includes Offer only when price exists', () => {
    for (const page of [menuPage, slugPage]) {
      expect(page).toMatch(/if\s*\(i\.data\.price\)/);
      expect(page).toContain('"@type": "Offer"');
    }
  });

  it('wraps multiple menus in @graph on main page', () => {
    expect(menuPage).toContain('"@graph"');
    // [slug].astro renders a single menu — no @graph needed
    expect(slugPage).not.toContain('"@graph"');
  });
});

// ---------------------------------------------------------------------------
// Menu-specific accessibility
// ---------------------------------------------------------------------------
describe('menu accessibility', () => {
  it('menu-selector and menu-nav have descriptive aria-labels', () => {
    for (const page of [menuPage, slugPage]) {
      expect(page).toMatch(/class="menu-nav"[^>]*aria-label="Menu sections"/);
      expect(page).toMatch(/class="menu-selector"[^>]*aria-label="Menu selection"/);
    }
  });

  it('sections link heading id to aria-labelledby', () => {
    for (const page of [menuPage, slugPage]) {
      expect(page).toMatch(/aria-labelledby=\{`heading-\$\{/);
      expect(page).toMatch(/id=\{`heading-\$\{/);
    }
  });

  it('[slug].astro marks the active menu link with aria-current', () => {
    expect(slugPage).toMatch(/aria-current=.*"page"/);
  });

  it('dietary badges have aria-label for screen readers', () => {
    for (const page of [menuPage, slugPage]) {
      expect(page).toMatch(/class="dietary-badge"[^>]*aria-label=/);
    }
  });
});

// ---------------------------------------------------------------------------
// Conditional rendering — menu-specific display logic
// ---------------------------------------------------------------------------
describe('menu conditional rendering', () => {
  it('shows empty state when no menus exist', () => {
    expect(menuPage).toContain('menus.length === 0');
    expect(menuPage).toMatch(/coming soon/i);
  });

  it('menu selector only renders for multiple menus', () => {
    expect(menuPage).toContain('menus.length > 1');
    expect(slugPage).toContain('otherMenus.length > 1');
  });

  it('jump nav only renders for multiple sections', () => {
    expect(menuPage).toContain('allAnchors.length > 1');
    expect(slugPage).toContain('anchors.length > 1');
  });

  it('menu name as h2 only when multiple menus on main page', () => {
    expect(menuPage).toMatch(/menus\.length > 1[\s\S]*?<h2/);
  });

  it('[slug].astro has back link to /menu', () => {
    expect(slugPage).toContain('href="/menu"');
  });

  it('price, image, description, and dietary are conditionally rendered', () => {
    for (const page of [menuPage, slugPage]) {
      expect(page).toContain('item.data.price &&');
      expect(page).toContain('item.data.image &&');
      expect(page).toContain('item.data.dietary.length > 0');
    }
    expect(menuPage).toContain('menu.data.description &&');
    expect(slugPage).toContain('menu.data.description &&');
  });

  it('filters out unavailable items', () => {
    for (const page of [menuPage, slugPage]) {
      expect(page).toContain('.data.available');
    }
  });
});
