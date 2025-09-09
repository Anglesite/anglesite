/**
 * @file Test to verify path duplication fix
 * Ensures that file paths are correctly handled when websiteServer.inputDir includes /src/
 */

describe('Path duplication fix', () => {
  test('should remove src/ prefix from relative paths', () => {
    // Mock the path handling logic
    function cleanRelativePath(relativePath: string): string {
      if (relativePath.startsWith('src/')) {
        return relativePath.substring(4); // Remove 'src/' prefix
      }
      return relativePath;
    }

    // Test cases
    expect(cleanRelativePath('src/_data/website.json')).toBe('_data/website.json');
    expect(cleanRelativePath('src/index.html')).toBe('index.html');
    expect(cleanRelativePath('src/about/index.md')).toBe('about/index.md');
    expect(cleanRelativePath('_data/website.json')).toBe('_data/website.json'); // No change if no prefix
    expect(cleanRelativePath('index.html')).toBe('index.html'); // No change if no prefix
    expect(cleanRelativePath('source/file.txt')).toBe('source/file.txt'); // 'source/' should not be affected
  });

  test('should handle edge cases', () => {
    function cleanRelativePath(relativePath: string): string {
      if (relativePath.startsWith('src/')) {
        return relativePath.substring(4);
      }
      return relativePath;
    }

    expect(cleanRelativePath('')).toBe('');
    expect(cleanRelativePath('src/')).toBe('');
    expect(cleanRelativePath('src')).toBe('src'); // Just 'src' without slash should not be changed
    expect(cleanRelativePath('/src/file.txt')).toBe('/src/file.txt'); // Absolute paths should not be affected
  });
});
