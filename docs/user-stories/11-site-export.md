# User Story 11: Static Site Export

**Priority:** P1 (High - Post-MVP)
**Story Points:** 5
**Estimated Duration:** 3-5 days
**Persona:** Alex (Technical Hobbyist), Emma (Privacy-Conscious Creator)
**Epic:** Publishing & Deployment

## Complexity Assessment

**Points Breakdown:**
- Production build configuration (reuses deployment build): 1 point
- Platform-specific configuration generation: 2 points
- ZIP archive creation: 1 point
- Export UI and README generation: 1 point

**Justification:** Moderate complexity reusing much of deployment infrastructure. Platform-specific configs (Netlify, Vercel, GitHub Pages) are well-documented. ZIP creation is straightforward. Main effort is generating helpful deployment instructions for each platform.

## Story

**As a** website owner who wants hosting flexibility
**I want to** export my site as static files
**So that** I can deploy to any hosting provider (not just CloudFlare Workers)

## Acceptance Criteria

### Given: User has a completed website
- [ ] "Export Site" option in deployment menu
- [ ] Export configuration panel available
- [ ] Preview of what will be exported

### When: User exports their site
- [ ] Application builds production-optimized version
- [ ] All assets included (HTML, CSS, JS, images)
- [ ] Output directory selectable
- [ ] Export includes deployment instructions
- [ ] Optional: Create deployment package (.zip)

### Then: Static files are ready
- [ ] All pages built as HTML files
- [ ] Assets optimized and organized
- [ ] Relative links work correctly
- [ ] Site functional without server
- [ ] README with deployment instructions included

## Technical Details

### Export Process

```
[Click Export]
    ↓
[Select Export Options]
    ↓
[Choose Output Directory]
    ↓
[Run Production Build] (11ty build)
    ↓
[Optimize Assets]
    ↓
[Generate Deployment Files]
    ↓
[Create ZIP (optional)]
    ↓
[Show Success + Instructions]
```

### Export Output Structure

```
my-site-export/
├── index.html
├── about.html
├── blog/
│   ├── index.html
│   ├── getting-started.html
│   └── another-post.html
├── assets/
│   ├── css/
│   │   └── main.min.css
│   ├── js/
│   │   └── bundle.min.js
│   └── images/
│       └── optimized-*.webp
├── feed.xml
├── sitemap.xml
├── robots.txt
├── .nojekyll                    # For GitHub Pages
└── README.md                    # Deployment instructions
```

### Export Configuration

```typescript
interface ExportConfig {
  outputDir: string;
  baseUrl: string;                  // Production URL
  minify: boolean;                  // Minify HTML/CSS/JS
  createZip: boolean;               // Create .zip archive
  includeSourceMaps: boolean;       // For debugging
  target: 'generic' | 'github-pages' | 'netlify' | 'vercel';

  optimizations: {
    images: boolean;                // Optimize images
    fonts: boolean;                 // Subset fonts
    criticalCSS: boolean;           // Inline critical CSS
  };
}
```

## Export Options UI

```
┌─────────────────────────────────────────┐
│  Export Static Site                     │
│                                         │
│  Export Location                        │
│  ┌─────────────────────────────────────┐│
│  │ /Users/sarah/Desktop/my-site-export ││
│  └─────────────────────────────────────┘│
│  [Choose Folder...]                     │
│                                         │
│  Base URL                               │
│  ┌─────────────────────────────────────┐│
│  │ https://sarahjohnson.com            ││
│  └─────────────────────────────────────┘│
│                                         │
│  Target Platform                        │
│  ○ Generic (any host)                   │
│  ○ GitHub Pages                         │
│  ○ Netlify                              │
│  ○ Vercel                               │
│                                         │
│  Options                                │
│  ☑ Minify HTML/CSS/JS                   │
│  ☑ Optimize images                      │
│  ☑ Create ZIP archive                   │
│  ☐ Include source maps                  │
│                                         │
│  [Cancel]  [Export]                     │
└─────────────────────────────────────────┘
```

## Export Progress

```
┌─────────────────────────────────────────┐
│  Exporting Site...                      │
│                                         │
│  ✓ Building pages (42 pages)            │
│  ✓ Optimizing images (87 images)        │
│  ✓ Minifying assets                     │
│  → Creating deployment files...         │
│    Generating ZIP archive               │
│                                         │
│  ████████████████░░░░ 78%               │
│                                         │
└─────────────────────────────────────────┘
```

## Success Message

```
┌─────────────────────────────────────────┐
│  ✓ Export Complete!                     │
│                                         │
│  Your site has been exported to:        │
│  /Users/sarah/Desktop/my-site-export/   │
│                                         │
│  Next Steps:                            │
│  1. Upload files to your hosting        │
│  2. Configure your domain (if needed)   │
│  3. Test your live site                 │
│                                         │
│  [View Deployment Guide]                │
│  [Open Export Folder]                   │
│  [Close]                                │
└─────────────────────────────────────────┘
```

## Deployment Instructions (Generated README)

```markdown
# Deployment Instructions

Your Anglesite project has been exported as static files.

## Quick Deploy Options

### GitHub Pages
1. Create a GitHub repository
2. Push these files to the `main` branch
3. Enable GitHub Pages in repository settings
4. Your site will be live at `https://username.github.io/repo-name`

### Netlify
1. Create a free account at netlify.com
2. Drag and drop this folder to Netlify
3. Your site will be live at `https://your-site.netlify.app`
4. Add custom domain in Netlify settings

### Vercel
1. Create a free account at vercel.com
2. Install Vercel CLI: `npm install -g vercel`
3. Run `vercel` in this directory
4. Follow the prompts to deploy

### Generic Hosting (FTP/cPanel)
1. Connect to your hosting via FTP
2. Upload all files to public_html/ (or www/)
3. Ensure index.html is in the root directory
4. Your site should be live at your domain

## Files Included

- 42 HTML pages
- Optimized images (2.3 MB → 890 KB)
- Minified CSS and JavaScript
- RSS feed (feed.xml)
- Sitemap (sitemap.xml)

## Configuration

Base URL: https://sarahjohnson.com
Generated: October 1, 2025
Anglesite Version: 1.0.0
```

## Platform-Specific Exports

### GitHub Pages
- Include `.nojekyll` file (skip Jekyll processing)
- Configure relative paths correctly
- Add CNAME file for custom domain
- 404.html for error handling

### Netlify
- Include `_redirects` file for routing
- Add `netlify.toml` for build settings
- Configure headers in `_headers` file

### Vercel
- Include `vercel.json` configuration
- Set up redirects and rewrites
- Configure custom domains

### CloudFlare Pages
- Add `_redirects` file
- Configure Workers if needed
- Set up custom domains

## Implementation Components

**Services:**
- `ExportService` - Orchestrates export process
- `BuildService` - Production build (reused from Story 03)
- `ZipService` - Archive creation
- `DeploymentGuideService` - Generate platform-specific instructions

**IPC Handlers:**
```typescript
'export:start'              // Begin export process
'export:configure'          // Set export options
'export:validate'           // Check export requirements
'export:open-folder'        // Open exported directory
```

## Success Metrics
- **Export Time**: < 60 seconds for typical site
- **Success Rate**: > 95% of exports complete successfully
- **Deployment Success**: 80% of users successfully deploy exported site

## Edge Cases & Error Handling

### 1. Output Directory Not Writable
```
Error: "Cannot write to selected directory"
Action: "Choose a different location"
Help: Suggest Documents/Anglesite-Exports/
```

### 2. Insufficient Disk Space
```
Error: "Not enough disk space (need 150 MB, have 50 MB)"
Action: "Free up space or choose different location"
```

### 3. Build Failures
```
Error: "Export failed during build step"
Details: [Show build log]
Action: "Fix build errors and try again"
```

### 4. Absolute URLs in Content
```
Warning: "Some links use absolute URLs (http://localhost:3000)"
Impact: "Links may not work in production"
Action: "Convert to relative URLs?"
```

## Advanced Features (Future)

### FTP/SFTP Integration
- Direct upload to hosting
- Save FTP credentials (encrypted)
- One-click re-deployment

### Git Integration
- Auto-commit and push to GitHub
- Create repository if needed
- Set up GitHub Actions deployment

### Hosting Provider APIs
- Direct deployment via APIs
- Netlify, Vercel, CloudFlare Pages
- Automatic SSL certificate setup

### Incremental Exports
- Only export changed files
- Faster re-exports
- Diff view of changes

## Related Stories
- [03 - CloudFlare Deployment](04-cloudflare-deployment.md) - Alternative deployment method
- [04 - Custom Domain Setup](05-custom-domain-setup.md) - Domain configuration

## Open Questions

- Q: Support for server-side functions export?
  - A: Post-MVP, generate CloudFlare Worker/Netlify Function templates

- Q: Include analytics in export?
  - A: Post-MVP, optional privacy-friendly analytics (Plausible, Fathom)

- Q: Version control for exports?
  - A: Post-MVP, track export history and diffs

## Testing Scenarios

1. **Happy Path**: Export to desktop, verify all files present
2. **Large Site**: Export 100+ page site
3. **Special Characters**: Export site with unicode filenames
4. **Network Drive**: Export to network location
5. **Disk Space**: Test with insufficient space
6. **Permissions**: Test on read-only directory
7. **Cancellation**: Cancel mid-export, verify cleanup
8. **Re-export**: Export same site twice, verify overwrite works
9. **Platform-Specific**: Test each platform preset
10. **Deployment**: Actually deploy to GitHub Pages, Netlify, Vercel

## Definition of Done
- [ ] Export functionality implemented
- [ ] All export options working
- [ ] Platform-specific configurations generated
- [ ] ZIP archive creation working
- [ ] README with instructions generated
- [ ] Performance: < 60s for typical site
- [ ] Error handling for all edge cases
- [ ] Documentation: Deployment guides for 5+ platforms
- [ ] QA: Successfully exported and deployed to 3 platforms
- [ ] User testing: 5 users export and deploy successfully
