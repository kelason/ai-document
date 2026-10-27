import sanitizeHtml from 'sanitize-html';
import { DOCUMENT_ATTRIBUTES, DOCUMENT_TAGS, isSafeDocumentHref, sanitizeDocumentStyle } from './html-policy';

/** Authoritative security boundary for writes, restores, imports, and legacy reads. */
export function sanitizeDocumentHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: DOCUMENT_TAGS,
    allowedAttributes: DOCUMENT_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'svg', 'math', 'iframe', 'object', 'embed', 'template', 'noscript', 'xmp'],
    // Values have a strict, complete-value allowlist; never accept CSS URLs or arbitrary variables.
    parseStyleAttributes: false,
    transformTags: {
      '*': (tagName, attributes) => {
        const attribs = { ...attributes };
        if (attribs.href && !isSafeDocumentHref(attribs.href)) delete attribs.href;
        if (attribs.style) {
          attribs.style = sanitizeDocumentStyle(attribs.style);
          if (!attribs.style) delete attribs.style;
        }
        for (const numeric of ['colspan', 'rowspan', 'span', 'start', 'value']) {
          if (attribs[numeric] && !/^\d{1,4}$/.test(attribs[numeric])) delete attribs[numeric];
        }
        return { tagName, attribs };
      },
    },
  });
}
