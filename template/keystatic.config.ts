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
    products: collection({
      label: "Products",
      slugField: "name",
      path: "src/content/products/*",
      format: { contentField: "content" },
      schema: {
        name: fields.slug({ name: { label: "Product Name" } }),
        description: fields.text({
          label: "Description",
          description: "Short description for product listings",
        }),
        price: fields.integer({
          label: "Price (cents)",
          description: "Price in cents (e.g., 4500 = $45.00)",
          validation: { isRequired: true, min: 0 },
        }),
        image: fields.text({
          label: "Image",
          description: "Path relative to public/ (e.g., /images/products/photo.webp)",
        }),
        imageAlt: fields.text({ label: "Image Alt Text" }),
        weight: fields.integer({
          label: "Weight (grams)",
          description: "Product weight for shipping calculation",
        }),
        order: fields.integer({
          label: "Display Order",
          description: "Lower numbers appear first",
          defaultValue: 0,
        }),
        content: fields.markdoc({ label: "Full Description" }),
      },
    }),
    menus: collection({
      label: "Menus",
      slugField: "name",
      path: "src/content/menus/*",
      format: { contentField: "content" },
      schema: {
        name: fields.slug({ name: { label: "Menu Name" } }),
        description: fields.text({
          label: "Description",
          description: "When this menu is available (e.g., Available weekdays 11am–3pm)",
        }),
        order: fields.integer({
          label: "Display Order",
          description: "Lower numbers appear first",
          defaultValue: 0,
        }),
        content: fields.markdoc({ label: "Introduction" }),
      },
    }),
    menuSections: collection({
      label: "Menu Sections",
      slugField: "name",
      path: "src/content/menuSections/*",
      format: { contentField: "content" },
      schema: {
        name: fields.slug({ name: { label: "Section Name" } }),
        menu: fields.relationship({
          label: "Menu",
          description: "Which menu this section belongs to",
          collection: "menus",
        }),
        description: fields.text({
          label: "Description",
          description: "Optional section description",
        }),
        order: fields.integer({
          label: "Display Order",
          description: "Lower numbers appear first",
          defaultValue: 0,
        }),
        content: fields.markdoc({ label: "Section Notes" }),
      },
    }),
    menuItems: collection({
      label: "Menu Items",
      slugField: "name",
      path: "src/content/menuItems/*",
      format: { contentField: "content" },
      schema: {
        name: fields.slug({ name: { label: "Item Name" } }),
        section: fields.relationship({
          label: "Section",
          description: "Which menu section this item belongs to",
          collection: "menuSections",
        }),
        description: fields.text({
          label: "Description",
          description: "Dish description",
        }),
        price: fields.text({
          label: "Price",
          description: "Price or range (e.g., $12, $12–$16, Market Price)",
        }),
        image: fields.text({
          label: "Image",
          description: "Path relative to public/ (e.g., /images/menu/photo.webp)",
        }),
        imageAlt: fields.text({
          label: "Image Alt Text",
          description: "Required if image is set",
        }),
        dietary: fields.multiselect({
          label: "Dietary Tags",
          options: [
            { label: "Vegetarian", value: "vegetarian" },
            { label: "Vegan", value: "vegan" },
            { label: "Gluten-Free", value: "gluten-free" },
            { label: "Dairy-Free", value: "dairy-free" },
            { label: "Nut-Free", value: "nut-free" },
            { label: "Halal", value: "halal" },
            { label: "Kosher", value: "kosher" },
            { label: "Spicy", value: "spicy" },
            { label: "Raw", value: "raw" },
          ],
        }),
        customTags: fields.array(
          fields.object({
            label: fields.text({ label: "Label" }),
            icon: fields.text({
              label: "Icon",
              description: "Emoji or symbol (optional)",
            }),
            color: fields.text({
              label: "Color",
              description: "CSS color value (optional)",
            }),
          }),
          {
            label: "Custom Tags",
            description: "Restaurant-specific tags (e.g., spice levels, house specialties)",
            itemLabel: (props) => props.fields.label.value || "New tag",
          },
        ),
        available: fields.checkbox({
          label: "Available",
          description: "Uncheck to hide seasonal or sold-out items without deleting",
          defaultValue: true,
        }),
        order: fields.integer({
          label: "Display Order",
          description: "Lower numbers appear first",
          defaultValue: 0,
        }),
        content: fields.markdoc({ label: "Details" }),
      },
    }),
    experiments: collection({
      label: "Experiments",
      slugField: "title",
      path: "src/content/experiments/*",
      format: { contentField: "content" },
      schema: {
        title: fields.slug({ name: { label: "Title" } }),
        description: fields.text({
          label: "Description",
          description: "Short description for the gallery",
        }),
        date: fields.date({
          label: "Date",
          validation: { isRequired: true },
        }),
        tags: fields.multiselect({
          label: "Tags",
          options: [
            { label: "p5.js", value: "p5" },
            { label: "Three.js", value: "three" },
            { label: "GSAP", value: "gsap" },
            { label: "Audio", value: "audio" },
            { label: "D3", value: "d3" },
          ],
        }),
        library: fields.text({ label: "Library" }),
        thumbnail: fields.text({
          label: "Thumbnail",
          description: "Path relative to public/ (e.g., /images/experiments/thumb.webp)",
        }),
        draft: fields.checkbox({
          label: "Draft",
          description: "Hide from the gallery",
          defaultValue: false,
        }),
        content: fields.markdoc({ label: "Content" }),
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
