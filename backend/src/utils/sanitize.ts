/**
 * HTML sanitization utilities (issue #407).
 *
 * DukaPay's backend is JSON-only (no HTML rendering), but user-provided text
 * (loan descriptions, dispute messages, display names) is stored and later
 * rendered by the frontend. If any downstream consumer renders this content as
 * HTML — even accidentally via a CMS or admin dashboard — stored XSS is
 * possible. These helpers strip dangerous tags/attributes at the API boundary
 * so the payload is safe regardless of how it's later consumed.
 *
 * Uses a regex-based allowlist approach that doesn't require a native DOM.
 * For the React frontend, `isomorphic-dompurify` is the primary defence;
 * these backend helpers are defense-in-depth.
 */

/** Tags that are considered safe for user-generated content. */
const ALLOWED_TAGS = ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li'] as const;

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
const ATTR_RE = /\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/g;

/**
 * Strip any HTML tags not in the allowlist, and remove all attributes from
 * allowed tags. This is a defense-in-depth measure — React escapes by
 * default, but this guards against accidental `dangerouslySetInnerHTML` or
 * non-React consumers.
 */
function stripDisallowed(html: string): string {
  return html.replace(TAG_RE, (match, tagName: string) => {
    const lower = tagName.toLowerCase();
    if (!(ALLOWED_TAGS as readonly string[]).includes(lower)) {
      // Disallowed tag: strip the entire tag (open + close)
      return '';
    }
    // Allowed tag: strip all attributes, keep the tag itself
    const selfClosing = match.endsWith('/>');
    const openMatch = match.match(/^<[^>]+>/);
    if (!openMatch) return '';
    const cleaned = openMatch[0].replace(ATTR_RE, '').replace(/\s+$/, '');
    return selfClosing ? `${cleaned.slice(0, -1)} />` : cleaned;
  });
}

/**
 * Sanitize a user-provided string for safe storage and later rendering.
 * Strips disallowed HTML tags and all attributes from allowed tags.
 */
export function sanitizeHtml(input: string): string {
  if (!input) return input;
  return stripDisallowed(input);
}

/**
 * Sanitize every string value in a nested object (recursively).
 * Non-string values are left untouched. Useful for sanitizing entire
 * request bodies before persistence.
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj };
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string') {
      (result as Record<string, unknown>)[key] = sanitizeHtml(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      (result as Record<string, unknown>)[key] = sanitizeObject(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      (result as Record<string, unknown>)[key] = value.map((item) =>
        typeof item === 'string'
          ? sanitizeHtml(item)
          : item && typeof item === 'object'
            ? sanitizeObject(item as Record<string, unknown>)
            : item,
      );
    }
  }
  return result;
}
