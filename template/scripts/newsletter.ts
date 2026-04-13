/**
 * Newsletter utilities — email formatting, subscribe form generation,
 * and subscriber reporting.
 *
 * Used by /anglesite:newsletter and the deploy skill for auto-syndication.
 */

/**
 * Format a blog post for email newsletter delivery.
 * Converts relative image paths to absolute URLs and adds a read-more link.
 *
 * @param title - The blog post title
 * @param description - Short summary of the post
 * @param body - Markdown body content with possible relative image paths
 * @param siteUrl - Absolute site URL (no trailing slash) for resolving paths
 * @param slug - URL slug for the blog post
 * @returns Formatted Markdown string ready for email delivery
 */
export function formatPostForEmail(
  title: string,
  description: string,
  body: string,
  siteUrl: string,
  slug: string,
): string {
  const postUrl = `${siteUrl}/blog/${slug}`;

  // Convert relative image paths to absolute (skips http/https URLs)
  const absoluteBody = body.replace(
    /!\[([^\]]*)\]\((?:\.\/|\/)([^)]+)\)/g,
    `![$1](${siteUrl}/$2)`,
  );

  return [
    `# ${title}`,
    "",
    description,
    "",
    absoluteBody,
    "",
    "---",
    "",
    `Read the full post: ${postUrl}`,
  ].join("\n");
}

/**
 * Escape HTML special characters to prevent injection.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Generate HTML for a newsletter subscribe form.
 *
 * @param provider - Newsletter service name (e.g., "buttondown", "mailchimp")
 * @param actionUrl - Form submission endpoint URL
 * @returns HTML string containing the subscribe form
 */
export function generateSubscribeFormHtml(
  provider: string,
  actionUrl: string,
): string {
  const safeUrl = escapeHtml(actionUrl);
  return `<form method="POST" action="${safeUrl}" class="subscribe-form">
  <div class="form-field">
    <label for="email">Email address</label>
    <input type="email" id="email" name="email" required autocomplete="email" placeholder="you@example.com" />
  </div>
  <button type="submit">Subscribe</button>
</form>`;
}

/**
 * Format subscriber count for plain-language reporting.
 *
 * @param count - Current subscriber count
 * @param previousCount - Previous subscriber count for comparison (omit to skip delta)
 * @returns Human-readable subscriber summary with optional change indicator
 */
export function formatSubscriberReport(
  count: number,
  previousCount?: number,
): string {
  const label = `${count} subscriber${count !== 1 ? "s" : ""}`;

  if (previousCount === undefined) {
    return `Newsletter: ${label}.`;
  }

  const diff = count - previousCount;
  if (diff === 0) return `Newsletter: ${label} (no change).`;
  if (diff > 0) return `Newsletter: ${label} (up ${diff} since last check).`;
  return `Newsletter: ${label} (down ${Math.abs(diff)} since last check).`;
}
