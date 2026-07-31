import sanitizeHtml from 'sanitize-html';

export function sanitizePostContent(content: string): string {
  return sanitizeHtml(content ?? '', {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'img',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'span',
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt', 'title', 'width', 'height'],
      a: ['href', 'name', 'target', 'rel'],
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs:
          attribs.target === '_blank'
            ? { ...attribs, rel: 'noopener noreferrer' }
            : attribs,
      }),
    },
    // Data URLs can carry active or misleading content and are never needed
    // because post media is stored on an HTTPS-backed asset service.
    allowedSchemes: ['http', 'https', 'mailto'],
  });
}
