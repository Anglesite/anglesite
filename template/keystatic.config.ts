/**
 * Keystatic CMS configuration — defines the content schema for the
 * visual editor at `/keystatic`.
 *
 * Blog posts are stored as Markdoc files in `src/content/posts/`.
 * The schema here must stay in sync with the Zod schema in
 * `src/content/config.ts`; both validate the same frontmatter fields.
 *
 * Tags are customized per business during `/anglesite:design-interview`.
 *
 * @see https://keystatic.com/docs/configuration
 * @module
 */

import { config, fields, collection } from "@keystatic/core";

export default config({
  storage: { kind: "local" },
  collections: {
    posts: collection({
      label: "Blog Posts",
      slugField: "title",
      path: "src/content/posts/*",
      format: { contentField: "content" },
      schema: {
        title: fields.slug({ name: { label: "Title" } }),
        description: fields.text({
          label: "Description",
          description: "For search engines and social sharing (1–2 sentences)",
        }),
        publishDate: fields.date({
          label: "Publish Date",
          validation: { isRequired: true },
        }),
        image: fields.text({
          label: "Image",
          description: "Path relative to public/ (e.g., /images/blog/photo.webp)",
        }),
        imageAlt: fields.text({
          label: "Image Alt Text",
          description: "Required if image is set",
        }),
        // Tags are updated by /design-interview to match the business
        tags: fields.multiselect({
          label: "Tags",
          options: [
            { label: "News", value: "news" },
            { label: "Update", value: "update" },
            { label: "Event", value: "event" },
          ],
        }),
        draft: fields.checkbox({
          label: "Draft",
          description: "Drafts are not published to the live site",
          defaultValue: false,
        }),
        syndication: fields.array(fields.url({ label: "URL" }), {
          label: "Syndication Links",
          description: "URLs where this post was shared (added after posting to social media)",
          itemLabel: (props) => props.value || "Add URL",
        }),
        content: fields.markdoc({ label: "Content" }),
      },
    }),
  },
});
