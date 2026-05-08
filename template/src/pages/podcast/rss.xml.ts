/**
 * Podcast RSS 2.0 feed with iTunes and Podcast namespaces.
 *
 * Submit this URL (`/podcast/rss.xml`) to Apple Podcasts, Spotify,
 * Overcast, Pocket Casts, and Podcast Index.
 *
 * Show-level metadata is read from `.site-config` style env vars at
 * build time via `import.meta.env`. Set these in `astro.config.ts` or
 * the build environment:
 *
 * - PUBLIC_PODCAST_TITLE
 * - PUBLIC_PODCAST_DESCRIPTION
 * - PUBLIC_PODCAST_AUTHOR
 * - PUBLIC_PODCAST_OWNER_NAME
 * - PUBLIC_PODCAST_OWNER_EMAIL
 * - PUBLIC_PODCAST_IMAGE  (path under public/, e.g. /images/podcast/cover.jpg)
 * - PUBLIC_PODCAST_CATEGORY  (Apple category, e.g. "Technology")
 * - PUBLIC_PODCAST_LANGUAGE  (e.g. en-us)
 * - PUBLIC_PODCAST_EXPLICIT  ("true" or "false")
 *
 * @module
 */

import { getCollection } from "astro:content";
import type { APIContext } from "astro";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cdata(text: string): string {
  return `<![CDATA[${text.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

function isoDuration(d?: string): string | undefined {
  // Apple expects HH:MM:SS or seconds — we pass through the friendly form.
  return d;
}

export async function GET(context: APIContext) {
  const env = import.meta.env as Record<string, string | undefined>;

  const showTitle = env.PUBLIC_PODCAST_TITLE || "Podcast";
  const showDescription =
    env.PUBLIC_PODCAST_DESCRIPTION || "Latest episodes";
  const author = env.PUBLIC_PODCAST_AUTHOR || "";
  const ownerName = env.PUBLIC_PODCAST_OWNER_NAME || author;
  const ownerEmail = env.PUBLIC_PODCAST_OWNER_EMAIL || "";
  const image = env.PUBLIC_PODCAST_IMAGE || "";
  const category = env.PUBLIC_PODCAST_CATEGORY || "Technology";
  const language = env.PUBLIC_PODCAST_LANGUAGE || "en-us";
  const explicit = env.PUBLIC_PODCAST_EXPLICIT === "true";

  const site = context.site!;
  const showUrl = new URL("/podcast/", site).toString();
  const feedUrl = new URL("/podcast/rss.xml", site).toString();
  const imageUrl = image ? new URL(image, site).toString() : "";

  const episodes = (
    await getCollection("episodes", ({ data }) => !data.draft)
  ).sort(
    (a, b) => b.data.publishDate.getTime() - a.data.publishDate.getTime(),
  );

  const items = episodes
    .map((episode) => {
      const link = new URL(`/podcast/${episode.id}/`, site).toString();
      const audioSrc = /^https?:\/\//.test(episode.data.audioUrl)
        ? episode.data.audioUrl
        : new URL(episode.data.audioUrl, site).toString();
      const guid = link;
      const pubDate = episode.data.publishDate.toUTCString();
      const epImage = episode.data.image
        ? new URL(episode.data.image, site).toString()
        : imageUrl;

      return `    <item>
      <title>${escapeXml(episode.data.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(guid)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${cdata(episode.data.description)}</description>
      <enclosure url="${escapeXml(audioSrc)}" type="${escapeXml(episode.data.audioType)}"${episode.data.audioLength ? ` length="${episode.data.audioLength}"` : ""} />
      <itunes:author>${escapeXml(author)}</itunes:author>
      <itunes:summary>${escapeXml(episode.data.description)}</itunes:summary>
      <itunes:explicit>${episode.data.explicit ? "true" : "false"}</itunes:explicit>
      <itunes:episodeType>${episode.data.episodeType}</itunes:episodeType>
${episode.data.episodeNumber !== undefined ? `      <itunes:episode>${episode.data.episodeNumber}</itunes:episode>\n` : ""}${episode.data.season !== undefined ? `      <itunes:season>${episode.data.season}</itunes:season>\n` : ""}${isoDuration(episode.data.duration) ? `      <itunes:duration>${escapeXml(isoDuration(episode.data.duration)!)}</itunes:duration>\n` : ""}${epImage ? `      <itunes:image href="${escapeXml(epImage)}" />\n` : ""}    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>${escapeXml(showTitle)}</title>
    <link>${escapeXml(showUrl)}</link>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <description>${cdata(showDescription)}</description>
    <language>${escapeXml(language)}</language>
    <copyright>© ${new Date().getFullYear()} ${escapeXml(ownerName)}</copyright>
    <itunes:author>${escapeXml(author)}</itunes:author>
    <itunes:summary>${escapeXml(showDescription)}</itunes:summary>
    <itunes:type>episodic</itunes:type>
    <itunes:explicit>${explicit ? "true" : "false"}</itunes:explicit>
    <itunes:category text="${escapeXml(category)}" />
${imageUrl ? `    <itunes:image href="${escapeXml(imageUrl)}" />\n    <image><url>${escapeXml(imageUrl)}</url><title>${escapeXml(showTitle)}</title><link>${escapeXml(showUrl)}</link></image>\n` : ""}${ownerEmail ? `    <itunes:owner>\n      <itunes:name>${escapeXml(ownerName)}</itunes:name>\n      <itunes:email>${escapeXml(ownerEmail)}</itunes:email>\n    </itunes:owner>\n` : ""}${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
