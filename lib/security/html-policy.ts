/** Pure policy shared by the server boundary and the browser insertion guard. */
export const DOCUMENT_TAGS = ['p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'a', 'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td'];
export const DOCUMENT_ATTRIBUTES: Record<string, string[]> = {
  '*': ['style'], a: ['href', 'title'], ol: ['start'], li: ['value'],
  th: ['colspan', 'rowspan', 'scope'], td: ['colspan', 'rowspan'], col: ['span'],
};
const color = '(?:#[0-9a-fA-F]{3,8}|(?:rgb|rgba)\\([0-9.,% ]+\\)|black|white|red|blue|green|gray|grey|transparent|var\\(--border-color\\))';
const length = '(?:0|[0-9]{1,4}(?:\\.[0-9]{1,2})?(?:px|pt|em|rem|%))';
export const DOCUMENT_STYLES: Record<string, RegExp[]> = {
  'text-align': [/^(?:left|right|center|justify)$/],
  'font-weight': [/^(?:normal|bold|[1-9]00)$/],
  'font-style': [/^(?:normal|italic)$/],
  'text-decoration': [/^(?:none|underline|line-through|underline line-through)$/],
  'color': [new RegExp(`^${color}$`, 'i')],
  'background-color': [new RegExp(`^${color}$`, 'i')],
  'background': [new RegExp(`^${color}$`, 'i')],
  'width': [new RegExp(`^${length}$`)],
  'border-collapse': [/^(?:collapse|separate)$/],
  'border': [new RegExp(`^(?:0|${length} (?:solid|dashed|dotted|double) ${color})$`, 'i')],
  'padding': [new RegExp(`^${length}(?: ${length}){0,3}$`)],
  'margin': [new RegExp(`^${length}(?: ${length}){0,3}$`)],
};

export function sanitizeDocumentStyle(style: string): string {
  return style.split(';').flatMap((declaration) => {
    const colon = declaration.indexOf(':');
    if (colon < 0) return [];
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    return DOCUMENT_STYLES[property]?.some((rule) => rule.test(value)) ? [`${property}:${value}`] : [];
  }).join(';');
}

export function isSafeDocumentHref(value: string): boolean {
  return /^(?:https?:\/\/|mailto:)[^\u0000-\u0020\u007f<>"\\]*$/i.test(value);
}
