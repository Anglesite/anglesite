import Foundation

public extension IntegrationDescriptor {
    /// Structural self-check (no I/O): conditions reference real fields/providers, choices are
    /// non-empty, provider-driven CSP ops only appear when providers exist. Empty == valid.
    func validate() -> [String] {
        var problems: [String] = []
        let fieldKeys = Set(fields.map(\.key))
        let providerIDs = Set(providers.map(\.id))

        func check(_ condition: Condition, _ context: String) {
            switch condition {
            case .always: break
            case .providerIs(let p) where !providerIDs.contains(p):
                problems.append("\(context): condition references unknown provider \"\(p)\"")
            case .fieldEquals(let key, _) where !fieldKeys.contains(key):
                problems.append("\(context): condition references unknown field \"\(key)\"")
            case .fieldIn(let key, _) where !fieldKeys.contains(key):
                problems.append("\(context): condition references unknown field \"\(key)\"")
            case .fieldIn(_, let values) where values.isEmpty:
                problems.append("\(context): fieldIn condition has an empty values list (always false)")
            default: break
            }
        }
        for f in fields {
            check(f.visibleWhen, "field \(f.key)")
            if case .choice(let choices) = f.kind, choices.isEmpty {
                problems.append("field \(f.key): choice has no options")
            }
        }
        for (i, op) in operations.enumerated() {
            switch op {
            case .copyFile(_, _, let w), .copyTemplatedFile(_, _, let w), .writeConfig(_, let w), .injectAtAnchor(_, _, _, let w, _), .appendLine(_, _, let w):
                check(w, "operation \(i)")
            case .addCSPDomains(let fromProvider, _, let fromFieldHost, let w):
                check(w, "operation \(i)")
                if fromProvider && providers.isEmpty {
                    problems.append("operation \(i): addCSPDomains(fromProvider:) but integration has no providers")
                }
                if let key = fromFieldHost, !fieldKeys.contains(key) {
                    problems.append("operation \(i): addCSPDomains(fromFieldHost:) references unknown field \"\(key)\"")
                }
            }
        }
        return problems
    }
}

public enum IntegrationCatalog {
    public static let all: [IntegrationDescriptor] = [
        booking, contact, donations, giscus, newsletter, consent, pwa, redirects,
        tracking, share, podcast,
        indieweb, menu,
        buyButton, lemonSqueezy, paddle, snipcart, shopifyBuyButton,
        inbox, membership, carbonTxt, greenHostCheck, co2Badge,
    ]

    public static func descriptor(for id: IntegrationID) -> IntegrationDescriptor {
        guard let d = all.first(where: { $0.id == id }) else {
            fatalError("Unregistered integration: \(id)")
        }
        return d
    }

    // MARK: booking
    static let booking = IntegrationDescriptor(
        id: .booking,
        displayName: "Booking",
        summary: "Let visitors book a time with you (Cal.com or Calendly).",
        providers: [
            Provider(id: "cal", displayName: "Cal.com", cspDomains: ["app.cal.com"]),
            Provider(id: "calendly", displayName: "Calendly", cspDomains: ["assets.calendly.com", "calendly.com"]),
        ],
        fields: [
            Field(key: "username", label: "Username / slug", kind: .text,
                  help: "Your Cal.com or Calendly username."),
            Field(key: "eventSlug", label: "Event type", kind: .text, isOptional: true,
                  help: "Optional event slug, e.g. \u{201C}30min\u{201D}."),
            Field(key: "style", label: "Placement", kind: .choice([
                Choice(value: "inline", label: "On a /book page"),
                Choice(value: "floating", label: "Floating button (site-wide)"),
                Choice(value: "button", label: "Button on the home page"),
            ]), defaultValue: "inline"),
            Field(key: "buttonText", label: "Button text", kind: .text, isOptional: true,
                  defaultValue: "Book a time",
                  visibleWhen: .fieldIn(key: "style", values: ["floating", "button"])),
        ],
        operations: [
            .copyFile(from: TemplateRef("integrations/components/BookingWidget.astro"),
                      to: "src/components/BookingWidget.astro",
                      when: .always),
            .copyFile(from: TemplateRef("integrations/pages/book.astro"),
                      to: "src/pages/book.astro", when: .fieldEquals(key: "style", value: "inline")),
            // No readConfig re-import here: BaseLayout.astro already imports it unconditionally
            // at the top of the file (added for WEBMENTION_RECEIVE_ENABLED), and astro check
            // rejects a duplicate identifier — see the co2Badge fix (#686).
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "// anglesite:imports",
                            snippet: "import BookingWidget from \"../components/BookingWidget.astro\";",
                            when: .fieldEquals(key: "style", value: "floating"), style: .line),
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "<!-- anglesite:body-end -->",
                            snippet: "{readConfig(\"BOOKING_STYLE\") === \"floating\" && (<BookingWidget provider={readConfig(\"BOOKING_PROVIDER\")} username={readConfig(\"BOOKING_USERNAME\")} eventSlug={readConfig(\"BOOKING_EVENT_SLUG\")} buttonText={readConfig(\"BOOKING_BUTTON_TEXT\")} style=\"floating\" />)}",
                            when: .fieldEquals(key: "style", value: "floating"), style: .html),
            .injectAtAnchor(file: "src/pages/index.astro", anchor: "// anglesite:imports",
                            snippet: "import BookingWidget from \"../components/BookingWidget.astro\";\nimport { readConfig } from \"../../scripts/config\";",
                            when: .fieldEquals(key: "style", value: "button"), style: .line),
            .injectAtAnchor(file: "src/pages/index.astro", anchor: "<!-- anglesite:hero-cta -->",
                            snippet: "{readConfig(\"BOOKING_STYLE\") === \"button\" && (<BookingWidget provider={readConfig(\"BOOKING_PROVIDER\")} username={readConfig(\"BOOKING_USERNAME\")} eventSlug={readConfig(\"BOOKING_EVENT_SLUG\")} buttonText={readConfig(\"BOOKING_BUTTON_TEXT\")} style=\"button\" />)}",
                            when: .fieldEquals(key: "style", value: "button"), style: .html),
            .writeConfig([
                ConfigEntry(key: "BOOKING_PROVIDER", value: "{{provider}}"),
                ConfigEntry(key: "BOOKING_USERNAME", value: "{{username}}"),
                ConfigEntry(key: "BOOKING_STYLE", value: "{{style}}"),
                ConfigEntry(key: "BOOKING_EVENT_SLUG", value: "{{eventSlug}}"),
                ConfigEntry(key: "BOOKING_BUTTON_TEXT", value: "{{buttonText}}"),
            ], when: .always),
            .addCSPDomains(fromProvider: true, extra: [], fromFieldHost: nil, when: .always),
        ])

    // MARK: contact
    static let contact = IntegrationDescriptor(
        id: .contact,
        displayName: "Contact Form",
        summary: "Let visitors reach you with a form (Formspree) or a plain email link.",
        providers: [
            Provider(id: "formspree", displayName: "Formspree", cspDomains: ["formspree.io"]),
            Provider(id: "mailto", displayName: "Plain email link", cspDomains: []),
        ],
        fields: [
            Field(key: "formEndpoint", label: "Form URL", kind: .url,
                  help: "Your Formspree form endpoint, e.g. https://formspree.io/f/xxxxxxx.",
                  visibleWhen: .providerIs("formspree")),
            Field(key: "email", label: "Your email address", kind: .email,
                  help: "Messages open in the visitor's email client, addressed to you.",
                  visibleWhen: .providerIs("mailto")),
            Field(key: "buttonText", label: "Button text", kind: .text, isOptional: true, defaultValue: "Send Message"),
        ],
        operations: [
            .copyFile(from: TemplateRef("integrations/components/ContactForm.astro"),
                      to: "src/components/ContactForm.astro", when: .always),
            .copyFile(from: TemplateRef("integrations/pages/contact.astro"),
                      to: "src/pages/contact.astro", when: .always),
            .writeConfig([
                ConfigEntry(key: "CONTACT_PROVIDER", value: "{{provider}}"),
                ConfigEntry(key: "CONTACT_FORM_ENDPOINT", value: "{{formEndpoint}}"),
                ConfigEntry(key: "CONTACT_EMAIL", value: "{{email}}"),
                ConfigEntry(key: "CONTACT_BUTTON_TEXT", value: "{{buttonText}}"),
            ], when: .always),
            .addCSPDomains(fromProvider: true, extra: [], fromFieldHost: nil, when: .always),
        ])

    // MARK: donations
    static let donations = IntegrationDescriptor(
        id: .donations,
        displayName: "Donations",
        summary: "Add a donation button (Stripe, Liberapay, or GitHub Sponsors).",
        providers: [
            Provider(id: "stripe", displayName: "Stripe", cspDomains: ["js.stripe.com"]),
            Provider(id: "liberapay", displayName: "Liberapay", cspDomains: ["liberapay.com"]),
            Provider(id: "github-sponsors", displayName: "GitHub Sponsors", cspDomains: ["github.com"]),
        ],
        fields: [
            Field(key: "link", label: "Donation link", kind: .url,
                  help: "Your Stripe Payment Link, Liberapay, or GitHub Sponsors URL."),
            Field(key: "buttonText", label: "Button text", kind: .text, isOptional: true, defaultValue: "Donate"),
        ],
        operations: [
            .copyFile(from: TemplateRef("integrations/components/DonationButton.astro"),
                      to: "src/components/DonationButton.astro", when: .always),
            .copyFile(from: TemplateRef("integrations/pages/donate.astro"),
                      to: "src/pages/donate.astro", when: .always),
            .writeConfig([
                ConfigEntry(key: "DONATIONS_PROVIDER", value: "{{provider}}"),
                ConfigEntry(key: "DONATIONS_LINK", value: "{{link}}"),
                ConfigEntry(key: "DONATIONS_BUTTON_TEXT", value: "{{buttonText}}"),
            ], when: .always),
            .addCSPDomains(fromProvider: true, extra: [], fromFieldHost: nil, when: .always),
        ])

    // MARK: giscus
    static let giscus = IntegrationDescriptor(
        id: .giscus,
        displayName: "Comments (giscus)",
        summary: "Add GitHub-Discussions-backed comments to blog posts.",
        providers: [],
        fields: [
            Field(key: "repo", label: "Repository", kind: .text, help: "owner/repo for the discussions backend."),
            Field(key: "repoId", label: "Repository ID", kind: .text),
            Field(key: "category", label: "Discussion category", kind: .text, defaultValue: "Announcements"),
            Field(key: "categoryId", label: "Category ID", kind: .text),
            Field(key: "mapping", label: "Mapping", kind: .choice([
                Choice(value: "pathname", label: "By page pathname"),
                Choice(value: "title", label: "By page title"),
            ]), defaultValue: "pathname"),
        ],
        operations: [
            .copyFile(from: TemplateRef("integrations/components/Comments.astro"),
                      to: "src/components/Comments.astro", when: .always),
            // No readConfig re-import here: BlogPost.astro already imports it unconditionally at
            // the top of the file (so giscus and share can share it without colliding), and astro
            // check rejects a duplicate identifier — see the co2Badge fix (#686).
            .injectAtAnchor(file: "src/layouts/BlogPost.astro", anchor: "// anglesite:imports",
                            snippet: "import Comments from \"../components/Comments.astro\";",
                            when: .always, style: .line),
            .injectAtAnchor(file: "src/layouts/BlogPost.astro", anchor: "<!-- anglesite:comments -->",
                            snippet: "{!!readConfig(\"GISCUS_REPO\") && (<Comments repo={readConfig(\"GISCUS_REPO\")} repoId={readConfig(\"GISCUS_REPO_ID\")} category={readConfig(\"GISCUS_CATEGORY\")} categoryId={readConfig(\"GISCUS_CATEGORY_ID\")} mapping={readConfig(\"GISCUS_MAPPING\")} />)}",
                            when: .always, style: .html),
            .writeConfig([
                ConfigEntry(key: "GISCUS_REPO", value: "{{repo}}"),
                ConfigEntry(key: "GISCUS_CATEGORY", value: "{{category}}"),
                ConfigEntry(key: "GISCUS_REPO_ID", value: "{{repoId}}"),
                ConfigEntry(key: "GISCUS_CATEGORY_ID", value: "{{categoryId}}"),
                ConfigEntry(key: "GISCUS_MAPPING", value: "{{mapping}}"),
            ], when: .always),
            .addCSPDomains(fromProvider: false, extra: ["giscus.app"], fromFieldHost: nil, when: .always),
        ])

    // MARK: newsletter
    static let newsletter = IntegrationDescriptor(
        id: .newsletter,
        displayName: "Newsletter",
        summary: "Let visitors subscribe to email updates (Buttondown or Mailchimp), via a Worker that keeps your API key off the client.",
        providers: [
            Provider(id: "buttondown", displayName: "Buttondown", cspDomains: []),
            Provider(id: "mailchimp", displayName: "Mailchimp", cspDomains: []),
        ],
        fields: [
            Field(key: "workerUrl", label: "Subscribe Worker URL", kind: .url,
                  help: "The Cloudflare Worker URL that proxies subscribe requests to your newsletter platform — see docs/newsletter-setup.md, included in this site, for how to deploy it."),
            Field(key: "buttonText", label: "Button text", kind: .text, isOptional: true, defaultValue: "Subscribe"),
        ],
        operations: [
            .copyFile(from: TemplateRef("integrations/components/NewsletterForm.astro"),
                      to: "src/components/NewsletterForm.astro", when: .always),
            .copyFile(from: TemplateRef("integrations/pages/subscribe.astro"),
                      to: "src/pages/subscribe.astro", when: .always),
            .copyFile(from: TemplateRef("integrations/pages/subscribe/thanks.astro"),
                      to: "src/pages/subscribe/thanks.astro", when: .always),
            .copyFile(from: TemplateRef("integrations/worker/subscribe-worker.js"),
                      to: "worker/subscribe-worker.js", when: .always),
            .copyFile(from: TemplateRef("integrations/worker/subscribe-wrangler.toml"),
                      to: "worker/subscribe-wrangler.toml", when: .always),
            .copyFile(from: TemplateRef("integrations/docs/newsletter-setup.md"),
                      to: "docs/newsletter-setup.md", when: .always),
            .writeConfig([
                ConfigEntry(key: "NEWSLETTER_PLATFORM", value: "{{provider}}"),
                ConfigEntry(key: "NEWSLETTER_WORKER_URL", value: "{{workerUrl}}"),
                ConfigEntry(key: "NEWSLETTER_BUTTON_TEXT", value: "{{buttonText}}"),
            ], when: .always),
            // The Worker's own domain isn't a fixed per-provider CSP domain (it's a per-site
            // deployment) — extract it from the workerUrl field instead of a static list.
            .addCSPDomains(fromProvider: false, extra: [], fromFieldHost: "workerUrl", when: .always),
        ])

    // MARK: consent
    static let consent = IntegrationDescriptor(
        id: .consent,
        displayName: "Cookie Consent",
        summary: "Add a category-based cookie consent banner that gates analytics, embeds, or ad-tech until visitors opt in.",
        providers: [],
        fields: [
            Field(key: "analytics", label: "Analytics (Plausible, GA4, Fathom, etc.)", kind: .bool, defaultValue: "false"),
            Field(key: "embeds", label: "Embeds (YouTube, Vimeo, Spotify, social)", kind: .bool, defaultValue: "false"),
            Field(key: "ads", label: "Ads / marketing pixels", kind: .bool, defaultValue: "false"),
            Field(key: "defaultPolicy", label: "Default for first-time visitors", kind: .choice([
                Choice(value: "geo", label: "Geo — default-deny in the EU/UK, default-allow elsewhere"),
                Choice(value: "strict", label: "Strict — default-deny everywhere"),
            ]), defaultValue: "strict"),
        ],
        operations: [
            .copyFile(from: TemplateRef("integrations/components/ConsentBanner.astro"),
                      to: "src/components/ConsentBanner.astro", when: .always),
            // No readConfig re-import here: BaseLayout.astro already imports it unconditionally
            // at the top of the file (added for WEBMENTION_RECEIVE_ENABLED), and astro check
            // rejects a duplicate identifier — see the co2Badge fix (#686).
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "// anglesite:imports",
                            snippet: "import ConsentBanner from \"../components/ConsentBanner.astro\";",
                            when: .always, style: .line),
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "<!-- anglesite:body-end -->",
                            snippet: "<ConsentBanner analytics={readConfig(\"CONSENT_ANALYTICS\") === \"true\"} embeds={readConfig(\"CONSENT_EMBEDS\") === \"true\"} ads={readConfig(\"CONSENT_ADS\") === \"true\"} defaultPolicy={readConfig(\"CONSENT_DEFAULT\")} version={readConfig(\"CONSENT_VERSION\")} />",
                            when: .always, style: .html),
            .writeConfig([
                ConfigEntry(key: "CONSENT_ANALYTICS", value: "{{analytics}}"),
                ConfigEntry(key: "CONSENT_EMBEDS", value: "{{embeds}}"),
                ConfigEntry(key: "CONSENT_ADS", value: "{{ads}}"),
                ConfigEntry(key: "CONSENT_DEFAULT", value: "{{defaultPolicy}}"),
                ConfigEntry(key: "CONSENT_VERSION", value: "1"),
            ], when: .always),
        ])

    // MARK: pwa
    static let pwa = IntegrationDescriptor(
        id: .pwa,
        displayName: "Progressive Web App",
        summary: "Make the site installable with offline support — a manifest, service worker, and offline page.",
        providers: [],
        fields: [
            Field(key: "description", label: "Description", kind: .text, isOptional: true, defaultValue: "",
                  help: "One-sentence description shown in install prompts."),
            Field(key: "installPrompt", label: "Show an install prompt to first-time visitors", kind: .bool, defaultValue: "true"),
        ],
        operations: [
            .copyFile(from: TemplateRef("integrations/pages/manifest.webmanifest.ts"),
                      to: "src/pages/manifest.webmanifest.ts", when: .always),
            .copyFile(from: TemplateRef("integrations/public/sw.js"),
                      to: "public/sw.js", when: .always),
            .copyFile(from: TemplateRef("integrations/pages/offline.astro"),
                      to: "src/pages/offline.astro", when: .always),
            .copyFile(from: TemplateRef("integrations/components/InstallPrompt.astro"),
                      to: "src/components/InstallPrompt.astro", when: .always),
            .copyFile(from: TemplateRef("integrations/docs/pwa-setup.md"),
                      to: "docs/pwa-setup.md", when: .always),
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "<!-- anglesite:head-end -->",
                            snippet: "<link rel=\"manifest\" href=\"/manifest.webmanifest\" />\n<meta name=\"theme-color\" content={readConfig(\"PWA_THEME_COLOR\")} />",
                            when: .always, style: .html),
            // No readConfig re-import here: BaseLayout.astro already imports it unconditionally
            // at the top of the file (added for WEBMENTION_RECEIVE_ENABLED), and astro check
            // rejects a duplicate identifier — see the co2Badge fix (#686).
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "// anglesite:imports",
                            snippet: "import InstallPrompt from \"../components/InstallPrompt.astro\";",
                            when: .always, style: .line),
            // The install prompt's install-prompt on/off toggle is resolved at Astro build time
            // via readConfig, the same way booking's floating-vs-button variants are — not by
            // gating this operation itself, so it can share the body-end anchor with the
            // sw-registration script in one combined block.
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "<!-- anglesite:body-end -->",
                            snippet: "<script is:inline>if(\"serviceWorker\" in navigator){navigator.serviceWorker.register(\"/sw.js\");}</script>\n{readConfig(\"PWA_INSTALL_PROMPT\") === \"true\" && (<InstallPrompt appName={readConfig(\"PWA_SITE_NAME\")} />)}",
                            when: .always, style: .html),
            .writeConfig([
                ConfigEntry(key: "PWA_DESCRIPTION", value: "{{description}}"),
                ConfigEntry(key: "PWA_INSTALL_PROMPT", value: "{{installPrompt}}"),
                ConfigEntry(key: "PWA_THEME_COLOR", value: "{{brandColor}}"),
                ConfigEntry(key: "PWA_SITE_NAME", value: "{{siteName}}"),
            ], when: .always),
            // No appendLine to public/_headers here: scripts/csp.ts's prebuild step
            // unconditionally regenerates that whole file every build, so anything appended
            // outside it would be silently wiped on the next build. buildHeaders() instead
            // derives the /sw.js cache rule from whether public/sw.js exists on disk.
        ])

    // MARK: redirects
    static let redirects = IntegrationDescriptor(
        id: .redirects,
        displayName: "Redirect",
        summary: "Add a redirect so an old URL keeps working after a page moves or is renamed.",
        providers: [],
        fields: [
            Field(key: "fromPath", label: "Old path", kind: .path,
                  help: "The path that's about to break, e.g. /old-page. No spaces."),
            Field(key: "toPath", label: "New destination", kind: .path,
                  help: "Where visitors should land now, e.g. /about or a full https:// URL. No spaces."),
            Field(key: "status", label: "Type", kind: .choice([
                Choice(value: "301", label: "Permanent — the old page is gone for good"),
                Choice(value: "302", label: "Temporary — it might come back"),
            ]), defaultValue: "301"),
        ],
        operations: [
            .appendLine(file: "public/_redirects", line: "{{fromPath}} {{toPath}} {{status}}", when: .always),
        ])

    // MARK: tracking
    static let tracking = IntegrationDescriptor(
        id: .tracking,
        displayName: "Analytics",
        summary: "Add privacy-friendly visitor analytics (Plausible, Fathom, or Google Analytics 4).",
        providers: [
            Provider(id: "plausible", displayName: "Plausible", cspDomains: ["plausible.io"]),
            Provider(id: "fathom", displayName: "Fathom", cspDomains: ["cdn.usefathom.com"]),
            // gtag.js loads from googletagmanager.com, but GA4's actual event beacons
            // (/g/collect) go to google-analytics.com / regional analytics.google.com hosts —
            // without these, connect-src silently drops every hit once the generated CSP is
            // enforced (see PR #473 review).
            Provider(id: "ga4", displayName: "Google Analytics 4",
                     cspDomains: ["www.googletagmanager.com", "*.google-analytics.com", "*.analytics.google.com"]),
        ],
        fields: [
            Field(key: "domain", label: "Site domain", kind: .text,
                  help: "Your site's domain as registered with Plausible, e.g. example.com.",
                  visibleWhen: .providerIs("plausible")),
            Field(key: "siteId", label: "Fathom Site ID", kind: .text,
                  help: "Found in your Fathom site settings, e.g. ABCDEFGH.",
                  visibleWhen: .providerIs("fathom")),
            Field(key: "measurementId", label: "Measurement ID", kind: .text,
                  help: "Your GA4 measurement ID, e.g. G-XXXXXXX.",
                  visibleWhen: .providerIs("ga4")),
        ],
        operations: [
            .copyFile(from: TemplateRef("integrations/components/TrackingScript.astro"),
                      to: "src/components/TrackingScript.astro", when: .always),
            // readConfig itself isn't re-imported here: BaseLayout.astro already imports it
            // unconditionally at the top of the file (added for WEBMENTION_RECEIVE_ENABLED), and
            // astro check rejects a duplicate identifier — see the co2Badge fix (#686).
            // asTrackingProvider is unique to this integration and still needs importing.
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "// anglesite:imports",
                            snippet: "import TrackingScript from \"../components/TrackingScript.astro\";\nimport { asTrackingProvider } from \"../../scripts/config\";",
                            when: .always, style: .line),
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "<!-- anglesite:head-end -->",
                            snippet: "{!!readConfig(\"TRACKING_PROVIDER\") && (<TrackingScript provider={asTrackingProvider(readConfig(\"TRACKING_PROVIDER\"))} domain={readConfig(\"TRACKING_DOMAIN\")} siteId={readConfig(\"TRACKING_SITE_ID\")} measurementId={readConfig(\"TRACKING_MEASUREMENT_ID\")} />)}",
                            when: .always, style: .html),
            .writeConfig([
                ConfigEntry(key: "TRACKING_PROVIDER", value: "{{provider}}"),
                ConfigEntry(key: "TRACKING_DOMAIN", value: "{{domain}}"),
                ConfigEntry(key: "TRACKING_SITE_ID", value: "{{siteId}}"),
                ConfigEntry(key: "TRACKING_MEASUREMENT_ID", value: "{{measurementId}}"),
            ], when: .always),
            .addCSPDomains(fromProvider: true, extra: [], fromFieldHost: nil, when: .always),
        ])

    // MARK: share
    static let share = IntegrationDescriptor(
        id: .share,
        displayName: "Share Buttons",
        summary: "Let readers share a blog post to X, Mastodon, or LinkedIn, or copy its link.",
        providers: [],
        fields: [
            Field(key: "twitter", label: "Share to X (Twitter)", kind: .bool, defaultValue: "true"),
            Field(key: "mastodon", label: "Share to Mastodon", kind: .bool, defaultValue: "true"),
            Field(key: "linkedin", label: "Share to LinkedIn", kind: .bool, defaultValue: "false"),
            Field(key: "copyLink", label: "Copy-link button", kind: .bool, defaultValue: "true"),
        ],
        operations: [
            .copyFile(from: TemplateRef("integrations/components/ShareButtons.astro"),
                      to: "src/components/ShareButtons.astro", when: .always),
            // No readConfig re-import here: BlogPost.astro already imports it unconditionally at
            // the top of the file (so giscus and share can share it without colliding), and astro
            // check rejects a duplicate identifier — see the co2Badge fix (#686).
            .injectAtAnchor(file: "src/layouts/BlogPost.astro", anchor: "// anglesite:imports",
                            snippet: "import ShareButtons from \"../components/ShareButtons.astro\";",
                            when: .always, style: .line),
            .injectAtAnchor(file: "src/layouts/BlogPost.astro", anchor: "<!-- anglesite:share -->",
                            snippet: "<ShareButtons title={title} twitter={readConfig(\"SHARE_TWITTER\") === \"true\"} mastodon={readConfig(\"SHARE_MASTODON\") === \"true\"} linkedin={readConfig(\"SHARE_LINKEDIN\") === \"true\"} copyLink={readConfig(\"SHARE_COPY_LINK\") === \"true\"} />",
                            when: .always, style: .html),
            .writeConfig([
                ConfigEntry(key: "SHARE_TWITTER", value: "{{twitter}}"),
                ConfigEntry(key: "SHARE_MASTODON", value: "{{mastodon}}"),
                ConfigEntry(key: "SHARE_LINKEDIN", value: "{{linkedin}}"),
                ConfigEntry(key: "SHARE_COPY_LINK", value: "{{copyLink}}"),
            ], when: .always),
        ])

    // MARK: podcast
    static let podcast = IntegrationDescriptor(
        id: .podcast,
        displayName: "Podcast",
        summary: "Embed your podcast's episode player (Spotify or Transistor.fm) on a /podcast page.",
        providers: [
            Provider(id: "spotify", displayName: "Spotify", cspDomains: ["open.spotify.com"]),
            Provider(id: "transistor", displayName: "Transistor.fm", cspDomains: ["share.transistor.fm"]),
        ],
        fields: [
            Field(key: "showId", label: "Show ID", kind: .text,
                  help: "Spotify: the show ID from open.spotify.com/show/XXXX. Transistor: the share ID from share.transistor.fm/s/XXXX."),
            Field(key: "rssUrl", label: "RSS feed URL", kind: .url, isOptional: true,
                  help: "Optional link to your podcast's raw RSS feed, for other podcast apps."),
        ],
        operations: [
            .copyFile(from: TemplateRef("integrations/components/PodcastPlayer.astro"),
                      to: "src/components/PodcastPlayer.astro", when: .always),
            .copyFile(from: TemplateRef("integrations/pages/podcast.astro"),
                      to: "src/pages/podcast.astro", when: .always),
            .writeConfig([
                ConfigEntry(key: "PODCAST_PROVIDER", value: "{{provider}}"),
                ConfigEntry(key: "PODCAST_SHOW_ID", value: "{{showId}}"),
                ConfigEntry(key: "PODCAST_RSS_URL", value: "{{rssUrl}}"),
            ], when: .always),
            .addCSPDomains(fromProvider: true, extra: [], fromFieldHost: nil, when: .always),
        ])

    // MARK: indieweb
    static let indieweb = IntegrationDescriptor(
        id: .indieweb,
        displayName: "IndieWeb",
        summary: "Add rel=me identity links and webmention/pingback endpoint discovery.",
        providers: [],
        fields: [
            Field(key: "relMe1", label: "Profile link #1", kind: .url, isOptional: true,
                  help: "e.g. your Mastodon profile — proves you own both."),
            Field(key: "relMe2", label: "Profile link #2", kind: .url, isOptional: true),
            Field(key: "relMe3", label: "Profile link #3", kind: .url, isOptional: true),
            Field(key: "webmentionUsername", label: "webmention.io username", kind: .text, isOptional: true,
                  help: "Usually your domain, e.g. example.com — enables webmention/pingback discovery via webmention.io."),
        ],
        operations: [
            // No imports-anchor injection needed: this integration adds no component, and
            // BaseLayout.astro already imports readConfig unconditionally at the top of the file
            // (added for WEBMENTION_RECEIVE_ENABLED) — see the co2Badge fix (#686).
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "<!-- anglesite:head-end -->",
                            snippet: "{!!readConfig(\"INDIEWEB_REL_ME_1\") && (<link rel=\"me\" href={readConfig(\"INDIEWEB_REL_ME_1\")} />)}\n{!!readConfig(\"INDIEWEB_REL_ME_2\") && (<link rel=\"me\" href={readConfig(\"INDIEWEB_REL_ME_2\")} />)}\n{!!readConfig(\"INDIEWEB_REL_ME_3\") && (<link rel=\"me\" href={readConfig(\"INDIEWEB_REL_ME_3\")} />)}\n{!!readConfig(\"INDIEWEB_WEBMENTION_USERNAME\") && (<link rel=\"webmention\" href={`https://webmention.io/${readConfig(\"INDIEWEB_WEBMENTION_USERNAME\")}/webmention`} />)}\n{!!readConfig(\"INDIEWEB_WEBMENTION_USERNAME\") && (<link rel=\"pingback\" href={`https://webmention.io/${readConfig(\"INDIEWEB_WEBMENTION_USERNAME\")}/xmlrpc`} />)}",
                            when: .always, style: .html),
            .writeConfig([
                ConfigEntry(key: "INDIEWEB_REL_ME_1", value: "{{relMe1}}"),
                ConfigEntry(key: "INDIEWEB_REL_ME_2", value: "{{relMe2}}"),
                ConfigEntry(key: "INDIEWEB_REL_ME_3", value: "{{relMe3}}"),
                ConfigEntry(key: "INDIEWEB_WEBMENTION_USERNAME", value: "{{webmentionUsername}}"),
            ], when: .always),
        ])

    // MARK: menu
    static let menu = IntegrationDescriptor(
        id: .menu,
        displayName: "Navigation Menu",
        summary: "Add a configurable top navigation with up to four links.",
        providers: [],
        fields: [
            Field(key: "item1Label", label: "Item 1 label", kind: .text, isOptional: true, defaultValue: "Home"),
            Field(key: "item1Path", label: "Item 1 path", kind: .path, isOptional: true, defaultValue: "/"),
            Field(key: "item2Label", label: "Item 2 label", kind: .text, isOptional: true, defaultValue: "Blog"),
            Field(key: "item2Path", label: "Item 2 path", kind: .path, isOptional: true, defaultValue: "/blog"),
            Field(key: "item3Label", label: "Item 3 label", kind: .text, isOptional: true),
            Field(key: "item3Path", label: "Item 3 path", kind: .path, isOptional: true),
            Field(key: "item4Label", label: "Item 4 label", kind: .text, isOptional: true),
            Field(key: "item4Path", label: "Item 4 path", kind: .path, isOptional: true),
        ],
        operations: [
            .copyFile(from: TemplateRef("integrations/components/Nav.astro"),
                      to: "src/components/Nav.astro", when: .always),
            // No readConfig re-import here: BaseLayout.astro already imports it unconditionally
            // at the top of the file (added for WEBMENTION_RECEIVE_ENABLED), and astro check
            // rejects a duplicate identifier — see the co2Badge fix (#686).
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "// anglesite:imports",
                            snippet: "import Nav from \"../components/Nav.astro\";",
                            when: .always, style: .line),
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "<!-- anglesite:nav -->",
                            snippet: "<Nav item1Label={readConfig(\"MENU_ITEM_1_LABEL\")} item1Path={readConfig(\"MENU_ITEM_1_PATH\")} item2Label={readConfig(\"MENU_ITEM_2_LABEL\")} item2Path={readConfig(\"MENU_ITEM_2_PATH\")} item3Label={readConfig(\"MENU_ITEM_3_LABEL\")} item3Path={readConfig(\"MENU_ITEM_3_PATH\")} item4Label={readConfig(\"MENU_ITEM_4_LABEL\")} item4Path={readConfig(\"MENU_ITEM_4_PATH\")} />",
                            when: .always, style: .html),
            .writeConfig([
                ConfigEntry(key: "MENU_ITEM_1_LABEL", value: "{{item1Label}}"),
                ConfigEntry(key: "MENU_ITEM_1_PATH", value: "{{item1Path}}"),
                ConfigEntry(key: "MENU_ITEM_2_LABEL", value: "{{item2Label}}"),
                ConfigEntry(key: "MENU_ITEM_2_PATH", value: "{{item2Path}}"),
                ConfigEntry(key: "MENU_ITEM_3_LABEL", value: "{{item3Label}}"),
                ConfigEntry(key: "MENU_ITEM_3_PATH", value: "{{item3Path}}"),
                ConfigEntry(key: "MENU_ITEM_4_LABEL", value: "{{item4Label}}"),
                ConfigEntry(key: "MENU_ITEM_4_PATH", value: "{{item4Path}}"),
            ], when: .always),
        ])

    // MARK: buyButton
    static let buyButton = IntegrationDescriptor(
        id: .buyButton,
        displayName: "Buy Button",
        summary: "Sell a single product, service, or digital good with a Stripe or Polar checkout link.",
        providers: [
            Provider(id: "stripe", displayName: "Stripe", cspDomains: ["js.stripe.com", "buy.stripe.com"]),
            Provider(id: "polar", displayName: "Polar", cspDomains: ["polar.sh", "buy.polar.sh"]),
        ],
        fields: [
            Field(key: "checkoutUrl", label: "Checkout link", kind: .url,
                  help: "Your Stripe Payment Link or Polar checkout URL."),
            Field(key: "buttonText", label: "Button text", kind: .text, isOptional: true, defaultValue: "Buy Now"),
        ],
        operations: [
            .copyFile(from: TemplateRef("integrations/components/BuyButton.astro"),
                      to: "src/components/BuyButton.astro", when: .always),
            .copyFile(from: TemplateRef("integrations/pages/buy.astro"),
                      to: "src/pages/buy.astro", when: .always),
            .writeConfig([
                ConfigEntry(key: "BUY_BUTTON_PROVIDER", value: "{{provider}}"),
                ConfigEntry(key: "BUY_BUTTON_CHECKOUT_URL", value: "{{checkoutUrl}}"),
                ConfigEntry(key: "BUY_BUTTON_TEXT", value: "{{buttonText}}"),
            ], when: .always),
            .addCSPDomains(fromProvider: true, extra: [], fromFieldHost: nil, when: .always),
        ])

    // MARK: lemonSqueezy
    static let lemonSqueezy = IntegrationDescriptor(
        id: .lemonSqueezy,
        displayName: "Lemon Squeezy",
        summary: "Sell digital products with a Lemon Squeezy overlay checkout.",
        providers: [],
        fields: [
            Field(key: "checkoutUrl", label: "Checkout URL", kind: .url,
                  help: "Your Lemon Squeezy checkout URL, e.g. https://your-store.lemonsqueezy.com/checkout/buy/xxxx."),
            Field(key: "buttonText", label: "Button text", kind: .text, isOptional: true, defaultValue: "Buy Now"),
        ],
        operations: [
            .copyFile(from: TemplateRef("integrations/components/LemonSqueezyButton.astro"),
                      to: "src/components/LemonSqueezyButton.astro", when: .always),
            .copyFile(from: TemplateRef("integrations/pages/shop.astro"),
                      to: "src/pages/shop.astro", when: .always),
            .writeConfig([
                ConfigEntry(key: "LEMON_SQUEEZY_CHECKOUT_URL", value: "{{checkoutUrl}}"),
                ConfigEntry(key: "LEMON_SQUEEZY_BUTTON_TEXT", value: "{{buttonText}}"),
            ], when: .always),
            .addCSPDomains(fromProvider: false, extra: ["assets.lemonsqueezy.com", "app.lemonsqueezy.com"],
                           fromFieldHost: nil, when: .always),
        ])

    // MARK: paddle
    static let paddle = IntegrationDescriptor(
        id: .paddle,
        displayName: "Paddle",
        summary: "Set up Paddle checkout for software licensing, SaaS subscriptions, or metered billing.",
        providers: [],
        fields: [
            Field(key: "clientToken", label: "Client-side token", kind: .text,
                  help: "Paddle > Developer Tools > Authentication > client-side token."),
            Field(key: "priceId", label: "Price ID", kind: .text,
                  help: "The Paddle price ID to check out, e.g. pri_xxxxxxxxx."),
            Field(key: "buttonText", label: "Button text", kind: .text, isOptional: true, defaultValue: "Subscribe"),
        ],
        operations: [
            .copyFile(from: TemplateRef("integrations/components/PaddleCheckout.astro"),
                      to: "src/components/PaddleCheckout.astro", when: .always),
            .copyFile(from: TemplateRef("integrations/pages/pricing.astro"),
                      to: "src/pages/pricing.astro", when: .always),
            .writeConfig([
                ConfigEntry(key: "PADDLE_CLIENT_TOKEN", value: "{{clientToken}}"),
                ConfigEntry(key: "PADDLE_PRICE_ID", value: "{{priceId}}"),
                ConfigEntry(key: "PADDLE_BUTTON_TEXT", value: "{{buttonText}}"),
            ], when: .always),
            .addCSPDomains(fromProvider: false,
                           extra: ["cdn.paddle.com", "checkout.paddle.com", "buy.paddle.com"],
                           fromFieldHost: nil, when: .always),
        ])

    // MARK: snipcart
    static let snipcart = IntegrationDescriptor(
        id: .snipcart,
        displayName: "Snipcart",
        summary: "Set up Snipcart ecommerce for a small physical product catalog.",
        providers: [],
        fields: [
            Field(key: "apiKey", label: "Snipcart public API key", kind: .text,
                  help: "Found in Snipcart dashboard > Account > API Keys > Public test/live key."),
        ],
        operations: [
            .copyFile(from: TemplateRef("integrations/components/SnipcartButton.astro"),
                      to: "src/components/SnipcartButton.astro", when: .always),
            .copyFile(from: TemplateRef("integrations/pages/store.astro"),
                      to: "src/pages/store.astro", when: .always),
            // No imports-anchor injection needed: this integration adds no component, and
            // BaseLayout.astro already imports readConfig unconditionally at the top of the file
            // (added for WEBMENTION_RECEIVE_ENABLED) — see the co2Badge fix (#686).
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "<!-- anglesite:body-end -->",
                            snippet: "{!!readConfig(\"SNIPCART_API_KEY\") && (<div hidden id=\"snipcart\" data-api-key={readConfig(\"SNIPCART_API_KEY\")} data-config-modal-style=\"side\"></div>)}\n{!!readConfig(\"SNIPCART_API_KEY\") && (<script async src=\"https://cdn.snipcart.com/themes/v3.7.3/default/snipcart.js\"></script>)}",
                            when: .always, style: .html),
            .writeConfig([
                ConfigEntry(key: "SNIPCART_API_KEY", value: "{{apiKey}}"),
            ], when: .always),
            .addCSPDomains(fromProvider: false,
                           extra: ["cdn.snipcart.com", "app.snipcart.com"],
                           fromFieldHost: nil, when: .always),
        ])

    // MARK: shopifyBuyButton
    static let shopifyBuyButton = IntegrationDescriptor(
        id: .shopifyBuyButton,
        displayName: "Shopify Buy Button",
        summary: "Set up Shopify Buy Button for a full physical product catalog with dashboard.",
        providers: [],
        fields: [
            Field(key: "shopDomain", label: "Shop domain", kind: .text,
                  help: "e.g. your-store.myshopify.com"),
            Field(key: "storefrontAccessToken", label: "Storefront access token", kind: .text,
                  help: "Shopify Admin > Apps > Headless / Storefront API > create a storefront access token."),
            Field(key: "productId", label: "Product ID", kind: .text,
                  help: "The Shopify product ID to feature, e.g. gid://shopify/Product/1234567890 or its numeric id."),
        ],
        operations: [
            .copyFile(from: TemplateRef("integrations/components/ShopifyBuyButton.astro"),
                      to: "src/components/ShopifyBuyButton.astro", when: .always),
            .copyFile(from: TemplateRef("integrations/pages/products.astro"),
                      to: "src/pages/products.astro", when: .always),
            .writeConfig([
                ConfigEntry(key: "SHOPIFY_DOMAIN", value: "{{shopDomain}}"),
                ConfigEntry(key: "SHOPIFY_STOREFRONT_TOKEN", value: "{{storefrontAccessToken}}"),
                ConfigEntry(key: "SHOPIFY_PRODUCT_ID", value: "{{productId}}"),
            ], when: .always),
            .addCSPDomains(fromProvider: false,
                           extra: ["sdks.shopifycdn.com", "cdn.shopify.com"],
                           fromFieldHost: nil, when: .always),
        ])

    // MARK: inbox
    static let inbox = IntegrationDescriptor(
        id: .inbox,
        displayName: "Inbox",
        summary: "Review and curate visitor messages through a built-in admin UI (Keystatic).",
        providers: [],
        fields: [],
        operations: [
            .injectAtAnchor(file: "keystatic.config.ts", anchor: "// anglesite:keystatic-collections",
                            snippet: "inbox: collection({\n  label: \"Inbox\",\n  path: \"src/content/inbox/*\",\n  format: { contentField: \"message\" },\n  slugField: \"subject\",\n  schema: {\n    subject: fields.slug({ name: { label: \"Subject\" } }),\n    from: fields.text({ label: \"From\" }),\n    receivedDate: fields.date({ label: \"Received\", validation: { isRequired: true } }),\n    status: fields.select({\n      label: \"Status\",\n      options: [\n        { label: \"New\", value: \"new\" },\n        { label: \"Reviewed\", value: \"reviewed\" },\n        { label: \"Archived\", value: \"archived\" },\n      ],\n      defaultValue: \"new\",\n    }),\n    message: fields.markdoc({ label: \"Message\" }),\n  },\n}),",
                            when: .always, style: .line),
            .copyFile(from: TemplateRef("integrations/docs/inbox-setup.md"),
                      to: "docs/inbox-setup.md", when: .always),
        ])

    // MARK: membership
    static let membership = IntegrationDescriptor(
        id: .membership,
        displayName: "Member Directory",
        summary: "A public list of members you curate through a built-in admin UI (Keystatic).",
        providers: [],
        fields: [
            Field(key: "directoryTitle", label: "Directory title", kind: .text, isOptional: true, defaultValue: "Our Members"),
        ],
        operations: [
            .injectAtAnchor(file: "keystatic.config.ts", anchor: "// anglesite:keystatic-collections",
                            snippet: "members: collection({\n  label: \"Members\",\n  path: \"src/content/members/*\",\n  format: { contentField: \"bio\" },\n  slugField: \"name\",\n  schema: {\n    name: fields.slug({ name: { label: \"Name\" } }),\n    role: fields.text({ label: \"Role\" }),\n    joinedDate: fields.date({ label: \"Joined\", validation: { isRequired: true } }),\n    photo: fields.image({ label: \"Photo\", directory: \"src/content/members\" }),\n    links: fields.array(fields.url({ label: \"Link\" }), { label: \"Links\", itemLabel: (props) => props.value || \"Link\" }),\n    bio: fields.markdoc({ label: \"Bio\" }),\n  },\n}),",
                            when: .always, style: .line),
            .copyFile(from: TemplateRef("integrations/pages/members.astro"),
                      to: "src/pages/members.astro", when: .always),
            .copyFile(from: TemplateRef("integrations/components/MemberCard.astro"),
                      to: "src/components/MemberCard.astro", when: .always),
            .writeConfig([
                ConfigEntry(key: "MEMBERSHIP_DIRECTORY_TITLE", value: "{{directoryTitle}}"),
            ], when: .always),
        ])

    // MARK: carbon.txt
    static let carbonTxt = IntegrationDescriptor(
        id: .carbonTxt,
        displayName: "carbon.txt",
        summary: "Publish a machine-readable sustainability disclosure at /carbon.txt.",
        providers: [],
        fields: [
            Field(key: "hostingProvider", label: "Hosting provider", kind: .text,
                  defaultValue: "Cloudflare",
                  help: "The provider responsible for hosting this site."),
            Field(key: "hostingProviderDomain", label: "Hosting provider domain", kind: .text,
                  defaultValue: "cloudflare.com",
                  help: "The provider’s public domain, without https:// or a path."),
            Field(key: "provenanceURL", label: "Hosting sustainability source", kind: .url,
                  help: "A link to the provider’s sustainability report, certification, or Green Web Check result."),
            Field(key: "disclosureURL", label: "Organisation disclosure URL", kind: .url,
                  isOptional: true,
                  help: "Optional link to your organisation’s own sustainability disclosure."),
        ],
        operations: [
            .copyTemplatedFile(from: TemplateRef("integrations/public/carbon.txt"),
                               to: "public/carbon.txt", when: .always),
        ])

    // MARK: greenHostCheck
    // No user-facing fields: the check result (`green`/`hostname`/`checkedAt`) is resolved by an
    // async Greencheck API call in IntegrationOperations.plan (Task 5) and folded into `answers`
    // before this descriptor’s operations run — so `.wizard` visits `.fields` with zero fields
    // and falls straight through to `.review` (IntegrationWizardModel.canContinue is vacuously
    // true for an empty `visibleFields` list).
    //
    // The badge component and its render snippet are always applied (`when: .always`), mirroring
    // PWA’s InstallPrompt/booking’s floating-widget precedent: the runtime `readConfig(...)
    // === "true"` conditional inside the injected snippet does the gating, not the Operation
    // itself — this avoids needing "green" declared as a Field (which validate() would otherwise
    // require, and which would render as an editable GUI control, wrong for an app-computed value).
    static let greenHostCheck = IntegrationDescriptor(
        id: .greenHostCheck,
        displayName: "Green Web Check",
        summary: "Verify your deploy host is on the Green Web Foundation’s green hosting directory, and show a badge if it is.",
        providers: [],
        fields: [],
        operations: [
            .copyFile(from: TemplateRef("integrations/components/GreenHostBadge.astro"),
                      to: "src/components/GreenHostBadge.astro", when: .always),
            // No readConfig re-import here: BaseLayout.astro already imports it unconditionally
            // at the top of the file (added for WEBMENTION_RECEIVE_ENABLED), and astro check
            // rejects a duplicate identifier — see the co2Badge fix (#686).
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "// anglesite:imports",
                            snippet: "import GreenHostBadge from \"../components/GreenHostBadge.astro\";",
                            when: .always, style: .line),
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "<!-- anglesite:body-end -->",
                            snippet: "{readConfig(\"GREEN_HOST_VERIFIED\") === \"true\" && (<GreenHostBadge hostname={readConfig(\"GREEN_HOST_NAME\")} checkedAt={readConfig(\"GREEN_HOST_CHECKED_AT\")} />)}",
                            when: .always, style: .html),
            .writeConfig([
                ConfigEntry(key: "GREEN_HOST_VERIFIED", value: "{{green}}"),
                ConfigEntry(key: "GREEN_HOST_NAME", value: "{{hostname}}"),
                ConfigEntry(key: "GREEN_HOST_CHECKED_AT", value: "{{checkedAt}}"),
            ], when: .always),
        ])

    // MARK: co2Badge
    // No providers, no async check (contrast with greenHostCheck/#684): the estimate must be
    // fresh on every build, not a one-time wizard-time snapshot, so all computation lives in the
    // Astro-side co2-badge.ts integration (scripts/co2-badge.ts's astro:build:done hook) — this
    // descriptor only ships the static plumbing (component, optional dedicated page, one config
    // key for placement).
    static let co2Badge = IntegrationDescriptor(
        id: .co2Badge,
        displayName: "Carbon Footprint Badge",
        summary: "Show an estimated per-page CO2 footprint, computed at build time from each page's weight (CO2.js).",
        providers: [],
        fields: [
            Field(key: "style", label: "Placement", kind: .choice([
                Choice(value: "footer", label: "Footer (site-wide)"),
                Choice(value: "page", label: "Dedicated page"),
            ]), defaultValue: "footer"),
        ],
        operations: [
            .copyFile(from: TemplateRef("integrations/components/CO2Badge.astro"),
                      to: "src/components/CO2Badge.astro", when: .always),
            .copyFile(from: TemplateRef("integrations/pages/carbon-footprint.astro"),
                      to: "src/pages/carbon-footprint.astro", when: .fieldEquals(key: "style", value: "page")),
            // No readConfig re-import here (contrast with booking/pwa/greenHostCheck's snippets):
            // BaseLayout.astro already imports it unconditionally at the top of the file (added
            // for WEBMENTION_RECEIVE_ENABLED), and a real deployed site's copy of that file is
            // typed by `astro check`, which rejects a duplicate identifier — re-importing it here
            // would break `npm run build` for any site with the footer placement installed.
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "// anglesite:imports",
                            snippet: "import CO2Badge from \"../components/CO2Badge.astro\";",
                            when: .fieldEquals(key: "style", value: "footer"), style: .line),
            .injectAtAnchor(file: "src/layouts/BaseLayout.astro", anchor: "<!-- anglesite:body-end -->",
                            snippet: "{readConfig(\"CO2_BADGE_STYLE\") === \"footer\" && (<CO2Badge />)}",
                            when: .fieldEquals(key: "style", value: "footer"), style: .html),
            .writeConfig([
                ConfigEntry(key: "CO2_BADGE_STYLE", value: "{{style}}"),
            ], when: .always),
        ])
}
