/**
 * Social media post formatters for POSSE syndication.
 *
 * Generates ready-to-copy text for each platform from a blog post's
 * frontmatter. Used by the /anglesite:syndicate skill.
 */

export interface PostInput {
  title: string;
  description: string;
  url: string;
  tags: string[];
  businessType?: string;
}

/**
 * Convert tags to hashtags: "local food" → "#localfood"
 */
function tagsToHashtags(tags: string[]): string[] {
  return tags.map((t) => "#" + t.replace(/\s+/g, "").toLowerCase());
}

/**
 * Truncate text to a max length, adding ellipsis if needed.
 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

/**
 * Instagram caption — no links (they're not clickable), hashtags at the end.
 * Max 2200 characters.
 */
export function formatInstagram(post: PostInput): string {
  const hashtags = tagsToHashtags(post.tags).join(" ");
  const body = `${post.title}\n\n${post.description}`;
  const full = hashtags ? `${body}\n\n${hashtags}` : body;
  return truncate(full, 2200);
}

/**
 * Facebook post — short text with link for preview card.
 * Best engagement under 500 characters.
 */
export function formatFacebook(post: PostInput): string {
  const body = `${post.title}\n\n${post.description}\n\n${post.url}`;
  return truncate(body, 500);
}

/**
 * Google Business Profile "What's New" post.
 * Max 1500 characters.
 */
export function formatGoogleBusiness(post: PostInput): string {
  const body = `${post.title}\n\n${post.description}\n\nRead more: ${post.url}`;
  return truncate(body, 1500);
}

/**
 * Nextdoor — conversational, neighborhood-friendly tone.
 * No strict character limit but keep it concise.
 */
export function formatNextdoor(post: PostInput): string {
  return `${post.title}\n\n${post.description}\n\n${post.url}`;
}

/**
 * Short-form post for X (280 chars) or Bluesky (300 chars).
 * Title + URL, truncating title if needed.
 */
export function formatShortPost(post: PostInput, charLimit: number): string {
  const urlPart = `\n\n${post.url}`;
  const available = charLimit - urlPart.length;

  if (available <= 0) {
    return truncate(post.url, charLimit);
  }

  return truncate(post.title, available) + urlPart;
}

/**
 * Generate all platform formats at once.
 */
export function formatAll(post: PostInput): {
  instagram: string;
  facebook: string;
  googleBusiness: string;
  nextdoor: string;
  x: string;
  bluesky: string;
} {
  return {
    instagram: formatInstagram(post),
    facebook: formatFacebook(post),
    googleBusiness: formatGoogleBusiness(post),
    nextdoor: formatNextdoor(post),
    x: formatShortPost(post, 280),
    bluesky: formatShortPost(post, 300),
  };
}
