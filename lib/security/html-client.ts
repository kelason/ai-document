'use client';

import createDOMPurify from 'dompurify';
import { DOCUMENT_ATTRIBUTES, DOCUMENT_TAGS, isSafeDocumentHref, sanitizeDocumentStyle } from './html-policy';

let purifier: ReturnType<typeof createDOMPurify> | undefined;

/** Defense in depth before any editor DOM insertion; the server still sanitizes independently. */
export function sanitizeEditorHtml(html: string): string {
  if (typeof window === 'undefined') return '';
  if (!purifier) {
    purifier = createDOMPurify(window);
    purifier.addHook('uponSanitizeAttribute', (node, data) => {
      const tag = node.nodeName.toLowerCase();
      const permitted = [...DOCUMENT_ATTRIBUTES['*'], ...(DOCUMENT_ATTRIBUTES[tag] ?? [])];
      if (!permitted.includes(data.attrName)) data.keepAttr = false;
      if (data.attrName === 'href' && !isSafeDocumentHref(data.attrValue)) data.keepAttr = false;
      if (data.attrName === 'style') {
        data.attrValue = sanitizeDocumentStyle(data.attrValue);
        if (!data.attrValue) data.keepAttr = false;
      }
      if (['colspan', 'rowspan', 'span', 'start', 'value'].includes(data.attrName) && !/^\d{1,4}$/.test(data.attrValue)) data.keepAttr = false;
    });
  }
  return purifier.sanitize(html, {
    ALLOWED_TAGS: DOCUMENT_TAGS,
    ALLOWED_ATTR: [...new Set(Object.values(DOCUMENT_ATTRIBUTES).flat())],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}
