# User Story 04: CloudFlare Workers Deployment

**Priority:** P0 (Critical - MVP)
**Story Points:** 8
**Estimated Duration:** 5-6 days
**Persona:** Sarah (Personal Brand Builder), Mike (Small Business Owner)
**Epic:** Publishing & Deployment

## Complexity Assessment

**Points Breakdown:**
- CloudFlare API integration and authentication: 3 points
- Production build optimization pipeline: 2 points
- Worker script generation and asset bundling: 2 points
- Deployment status tracking and error handling: 1 point

**Justification:** Moderate-high complexity with CloudFlare Workers API integration being the main unknown. Build optimization is well-understood but requires careful testing. Credential management requires encryption. Error handling for network failures and API rate limits needs thorough testing.

## Story

**As a** website owner ready to publish
**I want to** deploy my site to CloudFlare Workers with one click
**So that** I can host my website on my own domain for free

## Acceptance Criteria

### Given: User has completed their website
- [ ] "Deploy" button visible in main toolbar
- [ ] Website builds successfully locally
- [ ] No blocking validation errors

### When: User initiates deployment
- [ ] Application prompts for CloudFlare API credentials (first time only)
- [ ] Application builds optimized production version
- [ ] Application uploads to CloudFlare Workers
- [ ] Application verifies deployment success
- [ ] Application shows deployment URL

### Then: Website is live
- [ ] Site accessible at workers.dev subdomain
- [ ] Site accessible at custom domain (if configured)
- [ ] Deployment history tracked locally
- [ ] User can preview live site
- [ ] User notified of successful deployment

## Technical Details

### CloudFlare Workers Integration

**API Requirements:**
- CloudFlare API Token with Workers permissions
- Account ID
- (Optional) Zone ID for custom domain

**Deployment Process:**
```
[Build Static Site]
    ↓
[Optimize Assets] (minify, compress)
    ↓
[Generate Workers Script]
    ↓
[Bundle Static Assets] (as KV or inline)
    ↓
[Upload via Wrangler API]
    ↓
[Verify Deployment]
    ↓
[Show Success + URL]
```

### Worker Script Generation

Generate a CloudFlare Worker that serves static files:

```javascript
// Generated worker script
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname === '/' ? '/index.html' : url.pathname;

    // Serve from KV or static asset map
    const asset = await env.ASSETS.get(path);
    if (!asset) return new Response('Not Found', { status: 404 });

    return new Response(asset, {
      headers: {
        'Content-Type': getContentType(path),
        'Cache-Control': 'public, max-age=3600'
      }
    });
  }
};
```

### Implementation Components

**Main Process Services:**
- `DeploymentService` - Orchestrates deployment
- `CloudFlareAPIService` - Handles API calls
- `BuildService` - Production build optimization
- `CredentialsService` - Secure storage of API keys

**IPC Handlers:**
```typescript
'deploy:start'              // Initiate deployment
'deploy:configure'          // Set up CloudFlare credentials
'deploy:status'             // Check deployment progress
'deploy:history'            // View past deployments
'deploy:rollback'           // Revert to previous version
```

**File Structure:**
```
.anglesite/
├── deployments/
│   ├── history.json          // Deployment log
│   └── cloudflare-config.json // Encrypted credentials
└── builds/
    └── [timestamp]/          // Production build cache
```

### CloudFlare API Calls

1. **Verify Credentials**: `GET /accounts`
2. **Create Worker**: `PUT /accounts/:id/workers/scripts/:name`
3. **Upload Assets**: Use Workers KV or bundled assets
4. **Bind Custom Domain**: `PUT /zones/:id/workers/routes`
5. **Check Status**: `GET /accounts/:id/workers/scripts/:name`

## User Flow Diagram

```
[Click Deploy]
    ↓
[First Time?] --Yes--> [Enter CloudFlare Credentials]
    ↓ No                       ↓
[Build Site] <-----------------+
    ↓
[Upload to CloudFlare Workers]
    ↓
[Verify Deployment]
    ↓
[Show Success]
    ↓
[Copy URL] OR [Open in Browser] OR [Configure Domain]
```

## CloudFlare Setup Flow (First Time)

### Step 1: Credentials Input
```
┌─────────────────────────────────────────┐
│  Connect to CloudFlare                  │
│                                         │
│  To deploy for free, you'll need:      │
│  1. CloudFlare account (free)           │
│  2. API Token (we'll help you get it)  │
│                                         │
│  [Create CloudFlare Account]            │
│  [I Already Have an Account]            │
└─────────────────────────────────────────┘
```

### Step 2: API Token Instructions
- Link to CloudFlare token creation page
- Show required permissions (Workers:Edit)
- Auto-open browser to token creation URL
- Paste token back into Anglesite

### Step 3: Verification
- Test API token
- Fetch account details
- Show account name for confirmation
- Save encrypted credentials

## Deployment Progress UI

```
┌─────────────────────────────────────────┐
│  Deploying to CloudFlare Workers...     │
│                                         │
│  ✓ Building production site             │
│  ✓ Optimizing assets (2.3 MB → 890 KB) │
│  → Uploading to CloudFlare...           │
│    Generating worker script             │
│    Verifying deployment                 │
│                                         │
│  [Cancel]                               │
└─────────────────────────────────────────┘
```

## Success Metrics

- **Deployment Time**: < 30 seconds for typical site
- **Success Rate**: > 95% of deployments succeed
- **Setup Time**: < 5 minutes from "Deploy" to live site
- **Error Recovery**: Clear guidance for 100% of common errors

## Edge Cases & Error Handling

### 1. Invalid API Token
```
Error: "CloudFlare API token is invalid"
Action: "Update your API token"
Help: Link to token creation guide
```

### 2. Account Quota Exceeded
```
Error: "Free tier limit reached (10 workers)"
Solution: "Delete unused workers or upgrade plan"
Action: Open CloudFlare dashboard
```

### 3. Network Failure During Upload
```
Error: "Upload interrupted"
Action: "Retry deployment"
Recovery: Resume from last successful step
```

### 4. Build Failure
```
Error: "Production build failed"
Details: Show build error log
Action: "Fix errors and try again"
```

### 5. Asset Size Limits
```
Warning: "Worker size: 980 KB / 1 MB limit"
Suggestion: "Optimize images or use KV storage"
Action: Show size breakdown by file
```

### 6. Name Conflicts
```
Error: "Worker name 'my-site' already exists"
Solution: Append timestamp or prompt for new name
```

## Deployment Configuration Options

### Basic (MVP)
- [ ] Worker name (auto-generated from site name)
- [ ] CloudFlare account selection
- [ ] Deploy to workers.dev subdomain

### Advanced (Post-MVP)
- [ ] Custom domain binding
- [ ] Environment variables
- [ ] Caching rules
- [ ] Geographic restrictions
- [ ] A/B testing routes

## Security Considerations

1. **Credential Storage**
   - Encrypt API tokens using OS keychain (keytar)
   - Never log credentials
   - Prompt for re-auth on suspicious activity

2. **Build Isolation**
   - Run builds in isolated process
   - Validate all file paths
   - Prevent code injection in templates

3. **API Rate Limiting**
   - Respect CloudFlare rate limits
   - Implement exponential backoff
   - Show clear rate limit messages

## Related Stories

- [04 - Custom Domain Setup](05-custom-domain-setup.md) - Add custom domain after deployment
- [01 - First Website Creation](01-first-website-creation.md) - Journey from creation to deployment
- [10 - Site Export](11-site-export.md) - Alternative deployment methods

## Performance Optimizations

1. **Incremental Uploads**: Only upload changed files
2. **Parallel Uploads**: Upload assets concurrently
3. **Compression**: Gzip/Brotli before upload
4. **Caching**: Cache built assets locally
5. **Minification**: JS, CSS, HTML minification

## Rollback Strategy

### Deployment History
```json
{
  "deployments": [
    {
      "id": "deploy-1234",
      "timestamp": "2025-09-30T10:30:00Z",
      "status": "success",
      "url": "https://my-site-abc.workers.dev",
      "buildHash": "a1b2c3d4",
      "size": "890 KB"
    }
  ]
}
```

### Rollback Process
1. User selects previous deployment
2. Application re-uploads cached build
3. Verify rollback success
4. Notify user of rollback completion

## Open Questions

- Q: Should we use Wrangler CLI or direct API calls?
  - A: Direct API for better control and error handling

- Q: Support multiple CloudFlare accounts?
  - A: Post-MVP feature, single account for MVP

- Q: What's the worker size limit strategy?
  - A: Warn at 80% (800 KB), error at 100%, suggest KV storage

- Q: Should we support CloudFlare Pages instead?
  - A: Evaluate both, Pages might be simpler for static sites

## CloudFlare Deployment Strategy

### MVP: CloudFlare Workers Only

**Decision Rationale:**
- **No Git Required**: Workers can be deployed directly from Anglesite without Git
- **Simpler UX**: Direct upload without repository setup
- **Full Control**: Complete control over deployment process
- **Universal Support**: Works for all users immediately

**MVP Scope:**
- CloudFlare Workers API integration
- Direct file upload and worker script generation
- Custom domain configuration
- Deployment history and rollback

### Post-MVP: CloudFlare Pages Support

**Why Pages is Better for Static Sites:**
- Purpose-built for static content
- Automatic Git integration and versioning
- Larger free tier (20,000 requests/month vs 100,000 for Workers)
- Built-in preview deployments for branches
- Simpler architecture (no worker scripts needed)

**Pages Implementation Plan (Post-MVP):**
1. Detect if user has Git repository
2. Offer Pages as deployment option
3. Auto-configure Pages via CloudFlare API
4. Set up automatic deployments on Git push

**Deployment Options Matrix:**

| Feature | Workers (MVP) | Pages (Post-MVP) |
|---------|---------------|------------------|
| Git Required | No | Yes (optional) |
| Direct Deploy | Yes | Yes |
| Free Tier | 100K req/day | 500 builds/month |
| Setup Time | < 5 min | < 10 min |
| Use Case | Quick deploy | Git-based workflow |

**Final MVP Decision:** CloudFlare Workers only. Pages support added in v1.1 based on user demand.

## Testing Scenarios

1. **Happy Path**: First deployment with valid credentials
2. **Credential Failure**: Invalid API token
3. **Network Interruption**: Lose connection mid-upload
4. **Large Site**: Deploy 100+ page site
5. **Rapid Redeploys**: Deploy 5 times in quick succession
6. **Concurrent Deploys**: Multiple sites deploying simultaneously
7. **Rollback**: Deploy, rollback, deploy again
8. **Account Limits**: Hit free tier limits

## Definition of Done

- [ ] Code implemented with full deployment flow
- [ ] Unit tests for CloudFlare API integration (>90% coverage)
- [ ] Integration test with CloudFlare sandbox account
- [ ] Error handling for all common failures
- [ ] Credential encryption implemented and tested
- [ ] Performance: < 30s for typical deployment
- [ ] Security audit passed
- [ ] Documentation: Setup guide with screenshots
- [ ] QA: Successful deployment from macOS, Windows, Linux
- [ ] User testing: 5 users successfully deploy to CloudFlare
