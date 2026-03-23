import { describe, it, expect } from 'vitest';

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
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(0, 128, 0)).toBe('#008000');
    expect(rgbToHex(0, 0, 255)).toBe('#0000ff');
  });

  it('converts white and black', () => {
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
  });

  it('pads single-digit hex values with zero', () => {
    expect(rgbToHex(1, 2, 3)).toBe('#010203');
  });

  it('parses rgb() string format', () => {
    expect(rgbToHex('rgb(17, 109, 255)')).toBe('#116dff');
    expect(rgbToHex('rgb(243, 243, 243)')).toBe('#f3f3f3');
  });
});

describe('luminance', () => {
  it('returns 1 for white', () => {
    expect(Math.abs(luminance('#ffffff') - 1)).toBeLessThan(0.001);
  });

  it('returns 0 for black', () => {
    expect(Math.abs(luminance('#000000') - 0)).toBeLessThan(0.001);
  });

  it('returns intermediate values for grays', () => {
    const mid = luminance('#808080');
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.3);
  });
});

describe('saturation', () => {
  it('returns 0 for pure grays', () => {
    expect(saturation('#808080')).toBe(0);
    expect(saturation('#f3f3f3')).toBe(0);
    expect(saturation('#000000')).toBe(0);
    expect(saturation('#ffffff')).toBe(0);
  });

  it('returns high saturation for pure colors', () => {
    expect(saturation('#ff0000')).toBeGreaterThan(0.9);
    expect(saturation('#0000ff')).toBeGreaterThan(0.9);
    expect(saturation('#00ff00')).toBeGreaterThan(0.9);
  });

  it('returns moderate saturation for muted colors', () => {
    expect(saturation('#116dff')).toBeGreaterThan(0.5);
  });
});

describe('isGray', () => {
  it('classifies grays with saturation < 0.15', () => {
    expect(isGray('#808080')).toBe(true);
    expect(isGray('#f3f3f3')).toBe(true);
    expect(isGray('#4a4a4a')).toBe(true);
    expect(isGray('#6b6b6b')).toBe(true);
  });

  it('rejects saturated colors', () => {
    expect(isGray('#116dff')).toBe(false);
    expect(isGray('#ff0000')).toBe(false);
    expect(isGray('#156600')).toBe(false);
  });
});

describe('isBrowserDefault', () => {
  it('identifies default link blue', () => {
    expect(isBrowserDefault('#0000ee')).toBe(true);
  });

  it('identifies default visited purple', () => {
    expect(isBrowserDefault('#551a8b')).toBe(true);
  });

  it('identifies pure black as default', () => {
    expect(isBrowserDefault('#000000')).toBe(true);
  });

  it('identifies pure white as default', () => {
    expect(isBrowserDefault('#ffffff')).toBe(true);
  });

  it('rejects brand colors', () => {
    expect(isBrowserDefault('#116dff')).toBe(false);
    expect(isBrowserDefault('#156600')).toBe(false);
    expect(isBrowserDefault('#d97706')).toBe(false);
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
    expect(result[0]).toBe('#116dff');
    expect(result[1]).toBe('#4a4a4a');
    expect(result[2]).toBe('#f3f3f3');
  });

  it('limits to requested count', () => {
    const samples = ['#aaa', '#bbb', '#ccc', '#ddd'];
    expect(topColors(samples, 2)).toHaveLength(2);
  });

  it('filters out browser defaults', () => {
    const samples = ['#0000ee', '#0000ee', '#0000ee', '#116dff'];
    const result = topColors(samples, 5);
    expect(result).not.toContain('#0000ee');
    expect(result).toContain('#116dff');
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

    expect(tokens['--color-bg']).toBe('#f3f3f3');
    expect(tokens['--color-text']).toBe('#4a4a4a');
    expect(tokens['--font-heading']).toBe('"Open Sans"');
    expect(tokens['--font-body']).toBe('"Open Sans"');
  });

  it('picks the most frequent brand color as primary', () => {
    const colorSamples = {
      bg: ['#ffffff'],
      text: ['#333333', '#116dff', '#116dff', '#116dff', '#156600'],
      heading: ['#333333'],
    };
    const fontSamples = { heading: ['Arial'], body: ['Arial'] };

    const tokens = classifyTokens(colorSamples, fontSamples);

    expect(tokens['--color-primary']).toBe('#116dff');
  });

  it('picks the second brand color as accent', () => {
    const colorSamples = {
      bg: ['#ffffff'],
      text: ['#333333', '#116dff', '#116dff', '#156600', '#156600'],
      heading: ['#333333'],
    };
    const fontSamples = { heading: ['Arial'], body: ['Arial'] };

    const tokens = classifyTokens(colorSamples, fontSamples);

    expect(tokens['--color-accent']).toBe('#156600');
  });

  it('picks a gray different from text as muted', () => {
    const colorSamples = {
      bg: ['#ffffff'],
      text: ['#333333', '#6b6b6b', '#6b6b6b', '#999999'],
      heading: ['#333333'],
    };
    const fontSamples = { heading: ['Arial'], body: ['Arial'] };

    const tokens = classifyTokens(colorSamples, fontSamples);

    expect(tokens['--color-text']).toBe('#6b6b6b');
    expect(tokens['--color-muted']).not.toBe(tokens['--color-text']);
    expect(isGray(tokens['--color-muted'])).toBe(true);
  });

  it('quotes font families with spaces', () => {
    const colorSamples = { bg: ['#fff'], text: ['#333'], heading: ['#333'] };
    const fontSamples = {
      heading: ['Playfair Display'],
      body: ['Source Sans Pro'],
    };

    const tokens = classifyTokens(colorSamples, fontSamples);

    expect(tokens['--font-heading']).toBe('"Playfair Display"');
    expect(tokens['--font-body']).toBe('"Source Sans Pro"');
  });

  it('does not quote single-word font names', () => {
    const colorSamples = { bg: ['#fff'], text: ['#333'], heading: ['#333'] };
    const fontSamples = { heading: ['Georgia'], body: ['Arial'] };

    const tokens = classifyTokens(colorSamples, fontSamples);

    expect(tokens['--font-heading']).toBe('Georgia');
    expect(tokens['--font-body']).toBe('Arial');
  });

  it('picks the lightest bg color, not a brand-colored section header', () => {
    const colorSamples = {
      bg: ['#0f5ac0', '#0f5ac0', '#0f5ac0', '#f3f3f3', '#f3f3f3'],
      text: ['#4a4a4a'],
      heading: ['#4a4a4a'],
    };
    const fontSamples = { heading: ['Arial'], body: ['Arial'] };

    const tokens = classifyTokens(colorSamples, fontSamples);

    expect(tokens['--color-bg']).toBe('#f3f3f3');
  });

  it('returns null for missing categories', () => {
    const tokens = classifyTokens(
      { bg: [], text: [], heading: [] },
      { heading: [], body: [] },
    );

    expect(tokens['--color-bg']).toBeNull();
    expect(tokens['--color-text']).toBeNull();
    expect(tokens['--color-primary']).toBeNull();
    expect(tokens['--font-heading']).toBeNull();
  });
});
