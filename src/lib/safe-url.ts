/**
 * Safe Media URL allow-list validator.
 *
 * SECURITY: All mediaUrl values returned from upstream MUST be validated
 * against this allow-list before being set as src/href or passed to
 * window.open(). This prevents javascript: URLs and open redirects once
 * a real upstream is wired in.
 */

/**
 * Hosts explicitly allowed to serve media content.
 * Add entries here when integrating a real CDN.
 */
const ALLOWED_MEDIA_HOSTS: ReadonlySet<string> = new Set([
  // External demo sources used by the mock upstream (dev only)
  "commondatastorage.googleapis.com",
  "www.soundhelix.com",
  "images.unsplash.com",
  // Production CDN placeholder — replace with real CDN hostname
  // "cdn.zyka.ai",
]);

/**
 * Validates that a raw URL is safe to use as a media source:
 * - Must be a string of reasonable length
 * - Must parse as a valid URL
 * - Scheme must be `https:`
 * - Host must be in ALLOWED_MEDIA_HOSTS
 *
 * Returns the validated URL string, or null if invalid.
 */
export function toSafeMediaUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    return null;
  }
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    if (!ALLOWED_MEDIA_HOSTS.has(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}
