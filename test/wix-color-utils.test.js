import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  rgbToHex,
  luminance,
  saturation,
  isGray,
  isBrowserDefault,
  topColors,
  classifyTokens,
} from '../scripts/import/wix/color-utils.js';

describe('rgbToHex', () => {
  it('converts standard RGB values', () => {
    assert.equal(rgbToHex(255, 0, 0), '#ff0000');
    assert.equal(rgbToHex(0, 128, 0), '#008000');
    assert.equal(rgbToHex(0, 0, 255), '#0000ff');
  });

  it('converts white and black', () => {
    assert.equal(rgbToHex(255, 255, 255), '#ffffff');
    assert.equal(rgbToHex(0, 0, 0), '#000000');
  });

  it('pads single-digit hex values with zero', () => {
    assert.equal(rgbToHex(1, 2, 3), '#010203');
  });

  it('parses rgb() string format', () => {
    assert.equal(rgbToHex('rgb(17, 109, 255)'), '#116dff');
    assert.equal(rgbToHex('rgb(243, 243, 243)'), '#f3f3f3');
  });
});

describe('luminance', () => {
  it('returns 1 for white', () => {
    assert.ok(Math.abs(luminance('#ffffff') - 1) < 0.001);
  });

  it('returns 0 for black', () => {
    assert.ok(Math.abs(luminance('#000000') - 0) < 0.001);
  });

  it('returns intermediate values for grays', () => {
    const mid = luminance('#808080');
    assert.ok(mid > 0.2 && mid < 0.3);
  });
});

describe('saturation', () => {
  it('returns 0 for pure grays', () => {
    assert.equal(saturation('#808080'), 0);
    assert.equal(saturation('#f3f3f3'), 0);
    assert.equal(saturation('#000000'), 0);
    assert.equal(saturation('#ffffff'), 0);
  });

  it('returns high saturation for pure colors', () => {
    assert.ok(saturation('#ff0000') > 0.9);
    assert.ok(saturation('#0000ff') > 0.9);
    assert.ok(saturation('#00ff00') > 0.9);
  });

  it('returns moderate saturation for muted colors', () => {
    const s = saturation('#116dff'); // bright blue
    assert.ok(s > 0.5);
  });
});

describe('isGray', () => {
  it('classifies grays with saturation < 0.15', () => {
    assert.ok(isGray('#808080'));
    assert.ok(isGray('#f3f3f3'));
    assert.ok(isGray('#4a4a4a'));
    assert.ok(isGray('#6b6b6b'));
  });

  it('rejects saturated colors', () => {
    assert.ok(!isGray('#116dff'));
    assert.ok(!isGray('#ff0000'));
    assert.ok(!isGray('#156600'));
  });
});

describe('isBrowserDefault', () => {
  it('identifies default link blue', () => {
    assert.ok(isBrowserDefault('#0000ee'));
  });

  it('identifies default visited purple', () => {
    assert.ok(isBrowserDefault('#551a8b'));
  });

  it('identifies pure black as default', () => {
    assert.ok(isBrowserDefault('#000000'));
  });

  it('identifies pure white as default', () => {
    assert.ok(isBrowserDefault('#ffffff'));
  });

  it('rejects brand colors', () => {
    assert.ok(!isBrowserDefault('#116dff'));
    assert.ok(!isBrowserDefault('#156600'));
    assert.ok(!isBrowserDefault('#d97706'));
  });
});

describe('topColors', () => {
  it('returns colors sorted by frequency', () => {
    const samples = [
      '#116dff', '#116dff', '#116dff',
      '#4a4a4a', '#4a4a4a',
      '#f3f3f3',
    ];
    const result = topColors(samples, 3);
    assert.equal(result[0], '#116dff');
    assert.equal(result[1], '#4a4a4a');
    assert.equal(result[2], '#f3f3f3');
  });

  it('limits to requested count', () => {
    const samples = ['#aaa', '#bbb', '#ccc', '#ddd'];
    assert.equal(topColors(samples, 2).length, 2);
  });

  it('filters out browser defaults', () => {
    const samples = ['#0000ee', '#0000ee', '#0000ee', '#116dff'];
    const result = topColors(samples, 5);
    assert.ok(!result.includes('#0000ee'));
    assert.ok(result.includes('#116dff'));
  });
});

describe('classifyTokens', () => {
  it('classifies the prototype color set correctly', () => {
    const colorSamples = {
      bg: ['#f3f3f3', '#f3f3f3', '#ffffff'],
      text: ['#4a4a4a', '#4a4a4a', '#6b6b6b', '#116dff', '#156600'],
      heading: ['#4a4a4a', '#4a4a4a'],
    };
    const fontSamples = {
      heading: ['Open Sans', 'Open Sans', 'Arial'],
      body: ['Open Sans', 'Open Sans'],
    };

    const tokens = classifyTokens(colorSamples, fontSamples);

    assert.equal(tokens['--color-bg'], '#f3f3f3');
    assert.equal(tokens['--color-text'], '#4a4a4a');
    assert.equal(tokens['--font-heading'], '"Open Sans"');
    assert.equal(tokens['--font-body'], '"Open Sans"');
  });

  it('picks the most frequent brand color as primary', () => {
    const colorSamples = {
      bg: ['#ffffff'],
      text: ['#333333', '#116dff', '#116dff', '#116dff', '#156600'],
      heading: ['#333333'],
    };
    const fontSamples = { heading: ['Arial'], body: ['Arial'] };

    const tokens = classifyTokens(colorSamples, fontSamples);

    assert.equal(tokens['--color-primary'], '#116dff');
  });

  it('picks the second brand color as accent', () => {
    const colorSamples = {
      bg: ['#ffffff'],
      text: ['#333333', '#116dff', '#116dff', '#156600', '#156600'],
      heading: ['#333333'],
    };
    const fontSamples = { heading: ['Arial'], body: ['Arial'] };

    const tokens = classifyTokens(colorSamples, fontSamples);

    assert.equal(tokens['--color-accent'], '#156600');
  });

  it('picks a gray different from text as muted', () => {
    const colorSamples = {
      bg: ['#ffffff'],
      text: ['#333333', '#6b6b6b', '#6b6b6b', '#999999'],
      heading: ['#333333'],
    };
    const fontSamples = { heading: ['Arial'], body: ['Arial'] };

    const tokens = classifyTokens(colorSamples, fontSamples);

    // text is #6b6b6b (most frequent gray in text), muted should be different
    assert.equal(tokens['--color-text'], '#6b6b6b');
    assert.notEqual(tokens['--color-muted'], tokens['--color-text']);
    assert.ok(isGray(tokens['--color-muted']));
  });

  it('quotes font families with spaces', () => {
    const colorSamples = { bg: ['#fff'], text: ['#333'], heading: ['#333'] };
    const fontSamples = {
      heading: ['Playfair Display'],
      body: ['Source Sans Pro'],
    };

    const tokens = classifyTokens(colorSamples, fontSamples);

    assert.equal(tokens['--font-heading'], '"Playfair Display"');
    assert.equal(tokens['--font-body'], '"Source Sans Pro"');
  });

  it('does not quote single-word font names', () => {
    const colorSamples = { bg: ['#fff'], text: ['#333'], heading: ['#333'] };
    const fontSamples = { heading: ['Georgia'], body: ['Arial'] };

    const tokens = classifyTokens(colorSamples, fontSamples);

    assert.equal(tokens['--font-heading'], 'Georgia');
    assert.equal(tokens['--font-body'], 'Arial');
  });

  it('picks the lightest bg color, not a brand-colored section header', () => {
    // Simulates shilohballard.com: #0f5ac0 header bg appears frequently,
    // but #f3f3f3 is the actual page content background
    const colorSamples = {
      bg: ['#0f5ac0', '#0f5ac0', '#0f5ac0', '#f3f3f3', '#f3f3f3'],
      text: ['#4a4a4a'],
      heading: ['#4a4a4a'],
    };
    const fontSamples = { heading: ['Arial'], body: ['Arial'] };

    const tokens = classifyTokens(colorSamples, fontSamples);

    assert.equal(tokens['--color-bg'], '#f3f3f3');
  });

  it('returns null for missing categories', () => {
    const tokens = classifyTokens(
      { bg: [], text: [], heading: [] },
      { heading: [], body: [] },
    );

    assert.equal(tokens['--color-bg'], null);
    assert.equal(tokens['--color-text'], null);
    assert.equal(tokens['--color-primary'], null);
    assert.equal(tokens['--font-heading'], null);
  });
});
