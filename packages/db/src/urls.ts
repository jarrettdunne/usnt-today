/** True for an absolute http: or https: URL. Anything else (javascript:, data:, relative) is rejected. */
export function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

/** The URL if it's safe to put in an href, otherwise null (render the text without a link). */
export function safeHref(value: string | null | undefined): string | null {
  return value && isHttpUrl(value) ? value : null;
}
