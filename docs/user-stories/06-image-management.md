# User Story 06: Image Upload and Optimization

**Priority:** P0 (Critical - MVP)
**Story Points:** 5
**Estimated Duration:** 3-5 days
**Persona:** Sarah (Personal Brand Builder), Mike (Small Business Owner)
**Epic:** Content Creation & Editing

## Complexity Assessment

**Points Breakdown:**
- Sharp library integration for image processing: 2 points
- Multi-size generation and WebP conversion: 2 points
- Drag-drop UI and upload handling: 1 point

**Justification:** Moderate complexity using well-established Sharp library. Image processing is CPU-intensive but library handles heavy lifting. Native module compilation for Sharp may require pre-built binaries for all platforms. Testing across different image formats and sizes is time-consuming but straightforward.

## Story

**As a** website creator adding visual content
**I want to** easily upload, insert, and optimize images
**So that** my site loads fast and looks professional without manual image processing

## Acceptance Criteria

### Given: User is editing a page
- [ ] Drag-and-drop image upload supported
- [ ] File picker available for image selection
- [ ] Paste from clipboard supported (screenshots)
- [ ] Preview of image before insertion

### When: User adds an image
- [ ] Image automatically optimized (resized, compressed)
- [ ] Multiple format versions generated (WebP, fallback)
- [ ] Responsive srcset attributes added
- [ ] Alt text prompt appears
- [ ] Image placed in correct assets directory

### Then: Image is ready for web
- [ ] Original preserved in assets/images/originals/
- [ ] Optimized versions in assets/images/
- [ ] HTML includes responsive image markup
- [ ] File size reduced by 60-80%
- [ ] Image loads efficiently on all devices

## Technical Details

### Image Processing Pipeline

```
[Upload/Drop Image]
    ↓
[Validate] (format, size, dimensions)
    ↓
[Copy Original] → assets/images/originals/
    ↓
[Generate Sizes] (thumbnail, small, medium, large)
    ↓
[Optimize Each Size] (compression, format conversion)
    ↓
[Generate WebP Versions]
    ↓
[Update HTML] (with srcset and picture tags)
    ↓
[Show Success]
```

### Supported Formats

**Input:** JPEG, PNG, GIF, SVG, WebP, AVIF
**Output:** WebP (primary), JPEG (fallback), SVG (preserved)

### Generated Sizes (Configurable)

```javascript
const imageSizes = {
  thumbnail: 150,   // For thumbnails/previews
  small: 480,       // Mobile portrait
  medium: 768,      // Tablet
  large: 1200,      // Desktop
  xlarge: 1920      // Full HD (optional)
};
```

### File Organization

```
assets/images/
├── originals/          # Original uploads (full quality)
│   └── hero-photo.jpg  (3.2 MB)
├── hero-photo-480.webp      (45 KB)
├── hero-photo-480.jpg       (78 KB)
├── hero-photo-768.webp      (85 KB)
├── hero-photo-768.jpg       (142 KB)
├── hero-photo-1200.webp     (165 KB)
└── hero-photo-1200.jpg      (289 KB)
```

### Generated HTML

```html
<picture>
  <source
    type="image/webp"
    srcset="
      /assets/images/hero-photo-480.webp 480w,
      /assets/images/hero-photo-768.webp 768w,
      /assets/images/hero-photo-1200.webp 1200w
    "
    sizes="(max-width: 768px) 100vw, 768px"
  />
  <img
    src="/assets/images/hero-photo-768.jpg"
    srcset="
      /assets/images/hero-photo-480.jpg 480w,
      /assets/images/hero-photo-768.jpg 768w,
      /assets/images/hero-photo-1200.jpg 1200w
    "
    alt="Team photo at company retreat"
    loading="lazy"
    width="768"
    height="512"
  />
</picture>
```

### Implementation Components

**Main Process:**
- `ImageService` - Orchestrates image processing
- `ImageOptimizerService` - Uses Sharp library for processing
- `FileService` - Handles file I/O
- `AssetCacheService` - Tracks processed images

**Renderer Process:**
- `<ImageUploader>` - Drag-drop component
- `<ImageEditor>` - Basic crop/resize UI (post-MVP)
- `<AltTextDialog>` - Accessibility prompt

**IPC Handlers:**
```typescript
'image:upload'          // Upload and process image
'image:optimize'        // Re-optimize existing image
'image:delete'          // Remove image and all variants
'image:list'            // Get all images in project
'image:get-metadata'    // Get image dimensions, size, etc.
```

### Dependencies

**Sharp** (Node.js image processing):
```bash
npm install sharp
```

**Configuration:**
```typescript
interface ImageConfig {
  quality: {
    jpeg: 85,
    webp: 85,
    png: 90
  },
  sizes: number[],
  formats: ['webp', 'jpeg'],
  preserveOriginal: true,
  maxOriginalSize: 10 * 1024 * 1024 // 10 MB
}
```

## User Flow Diagram

```
[Drag Image to Editor]
    ↓
[Validate File] (size, format)
    ↓
[Show Upload Progress]
    ↓
[Process Image] (resize, optimize)
    ↓
[Prompt for Alt Text]
    ↓
[Insert into Page]
    ↓
[Auto-save]
```

## Image Upload UI

### Drag-and-Drop Zone
```
┌─────────────────────────────────────────┐
│                                         │
│        📷                               │
│                                         │
│    Drag image here or click to browse  │
│                                         │
│    Supports: JPG, PNG, GIF, WebP        │
│    Max size: 10 MB                      │
│                                         │
└─────────────────────────────────────────┘
```

### Upload Progress
```
┌─────────────────────────────────────────┐
│  Uploading hero-photo.jpg               │
│                                         │
│  ████████████████░░░░ 78%               │
│                                         │
│  Processing...                          │
│  ✓ Resizing                             │
│  ✓ Creating WebP versions               │
│  → Optimizing for web...                │
│                                         │
└─────────────────────────────────────────┘
```

### Alt Text Prompt
```
┌─────────────────────────────────────────┐
│  Add Alt Text (for accessibility)       │
│                                         │
│  [Preview of uploaded image]            │
│                                         │
│  Describe this image:                   │
│  ┌─────────────────────────────────────┐│
│  │ Team photo at company retreat       ││
│  └─────────────────────────────────────┘│
│                                         │
│  Good alt text describes the image for │
│  screen readers and when images fail to │
│  load.                                  │
│                                         │
│  [Skip]  [Add Alt Text]                 │
└─────────────────────────────────────────┘
```

## Success Metrics

- **Upload Speed**: < 3 seconds for 5 MB image
- **Optimization Ratio**: 60-80% size reduction
- **Quality Score**: Lighthouse score > 90 for images
- **Alt Text Adoption**: > 70% of images have alt text
- **Format Support**: 100% of common formats supported

## Edge Cases & Error Handling

### 1. File Too Large
```
Error: "Image too large (15 MB)"
Limit: 10 MB maximum
Action: "Resize or compress image before uploading"
Help: Link to recommended tools
```

### 2. Unsupported Format
```
Error: "Unsupported file format (.bmp)"
Supported: JPG, PNG, GIF, WebP, SVG
Action: "Convert to supported format"
```

### 3. Corrupted Image
```
Error: "Cannot process image (corrupted file)"
Action: "Try uploading a different version"
```

### 4. Disk Space Full
```
Error: "Insufficient disk space"
Required: 500 MB available
Action: "Free up space and try again"
```

### 5. Processing Failure
```
Error: "Image optimization failed"
Fallback: Keep original, skip optimization
Action: "Image uploaded but not optimized"
```

### 6. Duplicate Filename
```
Warning: "hero-photo.jpg already exists"
Options: [Replace] [Keep Both] [Cancel]
```

## Performance Optimizations

1. **Parallel Processing**: Generate all sizes concurrently
2. **Worker Threads**: Use separate thread for image processing
3. **Progressive Upload**: Show preview while processing
4. **Lazy Generation**: Generate sizes on-demand for rarely used images
5. **Caching**: Cache processed images, skip re-processing unchanged originals

### Processing Benchmarks (Target)

| Image Size | Processing Time |
|------------|-----------------|
| 1 MB       | < 1 second      |
| 5 MB       | < 3 seconds     |
| 10 MB      | < 5 seconds     |

## Accessibility Features

### Alt Text Guidance
- Required field (can skip, but warned)
- Character limit: 125 characters (recommended)
- Examples provided for common image types
- AI-suggested alt text (post-MVP using GPT-4 Vision)

### Keyboard Navigation
- Tab to upload button
- Space/Enter to trigger file picker
- Navigate uploaded images with arrow keys

## Advanced Features (Post-MVP)

### 1. Image Editing
- Crop and rotate
- Brightness/contrast adjustment
- Filters (grayscale, sepia, etc.)
- Focal point selection for responsive crops

### 2. Bulk Upload
- Upload multiple images at once
- Apply optimization to entire folder
- Batch alt text editing

### 3. Image Library
- Searchable gallery of all uploaded images
- Filter by page, date, size
- Reuse images across pages
- Unused image detection

### 4. CDN Integration
- Optional upload to CloudFlare Images
- Or other CDNs (Cloudinary, imgix)
- Further optimize delivery

### 5. AI Features
- Auto-generate alt text
- Smart crop (face detection)
- Background removal
- Upscaling for low-res images

## Related Stories

- [02 - Visual Page Editing](02-visual-page-editing.md) - Image insertion during editing
- [03 - CloudFlare Deployment](04-cloudflare-deployment.md) - Deploy optimized images
- [07 - Responsive Preview](08-responsive-preview.md) - Test image responsiveness

## Technical Risks

1. **Sharp Dependency**
   - Risk: Native module compilation issues
   - Mitigation: Bundle pre-compiled binaries for all platforms

2. **Memory Usage**
   - Risk: Processing large images consumes too much memory
   - Mitigation: Stream processing, memory limits

3. **Processing Time**
   - Risk: Large uploads block UI
   - Mitigation: Background workers, progress indicators

## Open Questions

- Q: Should we support AVIF format?
  - A: Post-MVP, browser support still limited (~85%)

- Q: Automatic image compression level?
  - A: Quality 85 default, allow user override in settings

- Q: Delete original after optimization?
  - A: No, always keep original for re-processing

- Q: Support external image URLs?
  - A: Yes, download and optimize on insertion

## Testing Scenarios

1. **Happy Path**: Upload 5 MB JPEG, verify all sizes generated
2. **Large File**: Upload 10 MB image at size limit
3. **Animated GIF**: Upload animated GIF, preserve animation
4. **SVG**: Upload SVG, verify no processing (preserve original)
5. **Paste**: Screenshot paste from clipboard
6. **Drag Multiple**: Drag 10 images at once
7. **Corrupt File**: Upload corrupted image file
8. **Network Drive**: Upload image from slow network location
9. **Rapid Uploads**: Upload 20 images quickly
10. **Memory Stress**: Process 100 MB total image data

## Definition of Done

- [ ] Code implemented with full image pipeline
- [ ] Unit tests for ImageService (>90% coverage)
- [ ] Integration tests for Sharp processing
- [ ] Performance: < 3s for 5 MB image
- [ ] Quality: Optimized images score > 90 on Lighthouse
- [ ] Formats: JPEG, PNG, GIF, WebP, SVG supported
- [ ] Alt text prompt implemented
- [ ] Error handling for all edge cases
- [ ] Documentation: Image best practices guide
- [ ] QA: Tested on macOS, Windows, Linux
- [ ] Accessibility: Alt text workflow tested with screen reader
