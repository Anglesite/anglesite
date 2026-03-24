/**
 * Keystatic CMS configuration — defines the content schema for the
 * visual editor at `/keystatic`.
 *
 * Content collections are stored as Markdoc files in `src/content/`.
 * The schema here must stay in sync with the Zod schema in
 * `src/content.config.ts`; both validate the same frontmatter fields.
 *
 * Collections enabled during `/anglesite:start` depend on the business
 * type. Collections with no content don't generate pages.
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
    services: collection({
      label: "Services",
      slugField: "name",
      path: "src/content/services/*",
      format: { contentField: "content" },
      schema: {
        name: fields.slug({ name: { label: "Service Name" } }),
        description: fields.text({
          label: "Description",
          description: "Short description for listings and search engines",
        }),
        price: fields.text({
          label: "Price",
          description: "Price or range (e.g., $50, $25–$75, Free)",
        }),
        image: fields.text({
          label: "Image",
          description: "Path relative to public/ (e.g., /images/services/photo.webp)",
        }),
        imageAlt: fields.text({ label: "Image Alt Text" }),
        order: fields.integer({
          label: "Display Order",
          description: "Lower numbers appear first",
          defaultValue: 0,
        }),
        content: fields.markdoc({ label: "Details" }),
      },
    }),
    team: collection({
      label: "Team",
      slugField: "name",
      path: "src/content/team/*",
      format: { contentField: "content" },
      schema: {
        name: fields.slug({ name: { label: "Name" } }),
        role: fields.text({ label: "Role / Title" }),
        bio: fields.text({
          label: "Short Bio",
          description: "1–2 sentences for the team listing page",
        }),
        photo: fields.text({
          label: "Photo",
          description: "Path relative to public/ (e.g., /images/team/photo.webp)",
        }),
        photoAlt: fields.text({ label: "Photo Alt Text" }),
        order: fields.integer({
          label: "Display Order",
          description: "Lower numbers appear first",
          defaultValue: 0,
        }),
        content: fields.markdoc({ label: "Full Bio" }),
      },
    }),
    testimonials: collection({
      label: "Testimonials",
      slugField: "author",
      path: "src/content/testimonials/*",
      format: { contentField: "content" },
      schema: {
        author: fields.slug({ name: { label: "Author Name" } }),
        quote: fields.text({
          label: "Quote",
          description: "The testimonial text (1–3 sentences)",
          multiline: true,
        }),
        attribution: fields.text({
          label: "Attribution",
          description: "Author's business or role (e.g., Owner, Acme Co.)",
        }),
        date: fields.date({ label: "Date" }),
        rating: fields.integer({
          label: "Rating",
          description: "Star rating from 1–5",
        }),
        content: fields.markdoc({ label: "Full Testimonial" }),
      },
    }),
    gallery: collection({
      label: "Gallery",
      slugField: "alt",
      path: "src/content/gallery/*",
      format: { contentField: "content" },
      schema: {
        image: fields.text({
          label: "Image",
          description: "Path relative to public/ (e.g., /images/gallery/photo.webp)",
          validation: { isRequired: true },
        }),
        alt: fields.slug({
          name: {
            label: "Alt Text",
            description: "Describe the image for accessibility",
          },
        }),
        caption: fields.text({ label: "Caption" }),
        category: fields.text({
          label: "Category",
          description: "For filtering (e.g., Interior, Food, Events)",
        }),
        order: fields.integer({
          label: "Display Order",
          description: "Lower numbers appear first",
          defaultValue: 0,
        }),
        content: fields.markdoc({ label: "Description" }),
      },
    }),
    events: collection({
      label: "Events",
      slugField: "title",
      path: "src/content/events/*",
      format: { contentField: "content" },
      schema: {
        title: fields.slug({ name: { label: "Event Title" } }),
        date: fields.date({
          label: "Date",
          validation: { isRequired: true },
        }),
        time: fields.text({
          label: "Start Time",
          description: "e.g., 7:00 PM",
        }),
        endTime: fields.text({
          label: "End Time",
          description: "e.g., 9:00 PM",
        }),
        location: fields.text({ label: "Location" }),
        description: fields.text({
          label: "Description",
          description: "Short summary for listings and search engines",
        }),
        recurring: fields.text({
          label: "Recurring",
          description: "e.g., weekly, monthly, or leave empty for one-time",
        }),
        image: fields.text({
          label: "Image",
          description: "Path relative to public/ (e.g., /images/events/photo.webp)",
        }),
        imageAlt: fields.text({ label: "Image Alt Text" }),
        content: fields.markdoc({ label: "Details" }),
      },
    }),
    faq: collection({
      label: "FAQ",
      slugField: "question",
      path: "src/content/faq/*",
      format: { contentField: "content" },
      schema: {
        question: fields.slug({ name: { label: "Question" } }),
        answer: fields.text({
          label: "Short Answer",
          description: "Brief answer for the FAQ listing (full answer in content body)",
          multiline: true,
        }),
        category: fields.text({
          label: "Category",
          description: "Group related questions (e.g., Pricing, Hours, Policies)",
        }),
        order: fields.integer({
          label: "Display Order",
          description: "Lower numbers appear first",
          defaultValue: 0,
        }),
        content: fields.markdoc({ label: "Full Answer" }),
      },
    }),
  },
});
