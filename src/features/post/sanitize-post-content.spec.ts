import { sanitizePostContent } from './sanitize-post-content';

describe('sanitizePostContent', () => {
  it('keeps the supported editorial markup', () => {
    expect(
      sanitizePostContent(
        '<h2>Port update</h2><img src="https://cdn.example.test/a.jpg" alt="Vessel">',
      ),
    ).toBe(
      '<h2>Port update</h2><img src="https://cdn.example.test/a.jpg" alt="Vessel" />',
    );
  });

  it('removes scripts, event handlers and unsafe URL schemes', () => {
    const sanitized = sanitizePostContent(
      '<script>alert(1)</script><a href="javascript:alert(2)" onclick="alert(3)">Open</a><img src="data:text/html,x">',
    );

    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('javascript:');
    expect(sanitized).not.toContain('onclick');
    expect(sanitized).not.toContain('data:');
    expect(sanitized).toContain('<a>Open</a>');
  });

  it('isolates links that open a new browsing context', () => {
    expect(
      sanitizePostContent(
        '<a href="https://example.test" target="_blank">External</a>',
      ),
    ).toContain('rel="noopener noreferrer"');
  });
});
