# User Story 05: Custom Domain Configuration

**Priority:** P0 (Critical - MVP)
**Story Points:** 5
**Estimated Duration:** 3-5 days
**Persona:** Sarah (Personal Brand Builder), Mike (Small Business Owner)
**Epic:** Publishing & Deployment

## Complexity Assessment

**Points Breakdown:**
- DNS verification and validation logic: 2 points
- CloudFlare route binding and SSL provisioning: 2 points
- UI for domain setup wizard and instructions: 1 point

**Justification:** Moderate complexity with well-documented CloudFlare APIs. DNS propagation polling is straightforward. Main challenge is providing clear UI/UX for users unfamiliar with DNS configuration. Multiple external registrars require different documentation.

## Story

**As a** website owner with a custom domain
**I want to** connect my domain to my CloudFlare-hosted site
**So that** visitors can access my site at my branded URL (e.g., mybusiness.com)

## Acceptance Criteria

### Given: User has deployed site to CloudFlare Workers
- [ ] "Configure Domain" option visible in deployment section
- [ ] User owns a domain name
- [ ] Domain DNS is manageable (preferably on CloudFlare)

### When: User configures custom domain
- [ ] Application guides user through domain connection process
- [ ] Application provides DNS configuration instructions
- [ ] Application verifies domain connection
- [ ] Application updates worker routes

### Then: Site is accessible on custom domain
- [ ] Site loads at custom domain (e.g., https://mybusiness.com)
- [ ] SSL certificate automatically provisioned
- [ ] www and root domain both work
- [ ] Previous workers.dev URL still works
- [ ] User can manage multiple domains per site

## Technical Details

### Domain Connection Flow

**Option 1: Domain Already on CloudFlare** (Easiest)
```
[Select Domain from Account]
    ↓
[Auto-configure DNS + Routes]
    ↓
[Verify] → Done in ~1 minute
```

**Option 2: Domain on External Registrar**
```
[Enter Domain Name]
    ↓
[Show DNS Records to Add]
    ↓
[User Updates DNS at Registrar]
    ↓
[Poll for DNS Propagation]
    ↓
[Verify + Configure Routes] → Done in 5-30 minutes
```

**Option 3: Transfer Domain to CloudFlare** (Recommended)
```
[Initiate Transfer]
    ↓
[Follow CloudFlare Transfer Process]
    ↓
[Auto-configure Once Complete]
```

### DNS Configuration Required

**For External DNS:**
```
Type: CNAME
Name: @ (or www)
Value: my-site-abc.workers.dev
Proxy: Disabled initially, then enable after verification
```

**For CloudFlare DNS (API-managed):**
```javascript
// Automatic via API
{
  type: 'CNAME',
  name: 'www',
  content: 'my-site.workers.dev',
  proxied: true
}
```

### Worker Route Configuration

After DNS is set up, bind worker to custom domain:

```javascript
// CloudFlare API: Create Route
PUT /zones/{zone_id}/workers/routes
{
  pattern: "mybusiness.com/*",
  script: "my-site-worker"
}
```

### Implementation Components

**Services:**
- `DomainService` - Domain verification and management
- `DNSService` - DNS record validation
- `CloudFlareAPIService` - API calls for zones/routes
- `SSLService` - Certificate status checking

**IPC Handlers:**
```typescript
'domain:add'              // Start domain connection
'domain:verify'           // Check DNS propagation
'domain:list'             // List connected domains
'domain:remove'           // Disconnect domain
'domain:check-ssl'        // Verify SSL certificate
```

**Configuration Storage:**
```json
// .anglesite/domains.json
{
  "domains": [
    {
      "name": "mybusiness.com",
      "status": "active",
      "ssl": "active",
      "addedAt": "2025-09-30T10:30:00Z",
      "verifiedAt": "2025-09-30T10:35:00Z",
      "zoneId": "abc123",
      "routes": [
        "mybusiness.com/*",
        "www.mybusiness.com/*"
      ]
    }
  ]
}
```

## User Flow Diagram

```
[Site Deployed]
    ↓
[Click "Add Custom Domain"]
    ↓
[Domain Already on CloudFlare?]
    ↓
  Yes ──────────────────────┐
    │                       │
    ├─ Select from List     │
    │                       ├→ [Auto-configure DNS]
  No                        │       ↓
    │                       │   [Create Routes]
    ├─ Enter Domain Name    │       ↓
    │                       │   [Verify SSL]
    ├─ Show DNS Instructions│       ↓
    │                       │   [Success!]
    ├─ Wait for Propagation │
    │                       │
    └───────────────────────┘
```

## Domain Setup UI

### Step 1: Domain Selection
```
┌─────────────────────────────────────────┐
│  Add Custom Domain                      │
│                                         │
│  Is your domain on CloudFlare?          │
│                                         │
│  ○ Yes - Select from my domains         │
│  ○ No - I'll update DNS manually        │
│  ○ I need to buy a domain               │
│                                         │
│  [Continue]                             │
└─────────────────────────────────────────┘
```

### Step 2: DNS Configuration (External DNS)
```
┌─────────────────────────────────────────┐
│  Configure DNS for mybusiness.com       │
│                                         │
│  Add these records at your registrar:   │
│                                         │
│  Type: CNAME                            │
│  Name: @                                │
│  Value: my-site-abc.workers.dev         │
│                                         │
│  Type: CNAME                            │
│  Name: www                              │
│  Value: my-site-abc.workers.dev         │
│                                         │
│  [Copy DNS Records] [Open GoDaddy]      │
│  [Open Namecheap] [Other Registrar]     │
│                                         │
│  ⏱️ Checking DNS... (can take 5-30 min) │
│                                         │
│  [I've Updated DNS - Check Now]         │
└─────────────────────────────────────────┘
```

### Step 3: Verification Progress
```
┌─────────────────────────────────────────┐
│  Verifying mybusiness.com               │
│                                         │
│  ✓ DNS records detected                 │
│  ✓ Worker route created                 │
│  → Provisioning SSL certificate...      │
│    Verifying domain ownership           │
│                                         │
│  This usually takes 1-5 minutes         │
└─────────────────────────────────────────┘
```

### Step 4: Success
```
┌─────────────────────────────────────────┐
│  ✓ Domain Connected!                    │
│                                         │
│  Your site is now live at:              │
│  https://mybusiness.com                 │
│  https://www.mybusiness.com             │
│                                         │
│  🔒 SSL Certificate: Active             │
│  📊 Status: All systems operational     │
│                                         │
│  [Visit Site] [Add Another Domain]      │
└─────────────────────────────────────────┘
```

## Success Metrics

- **Setup Time**: < 5 minutes (CloudFlare DNS) or < 30 minutes (external)
- **Success Rate**: > 90% of domain connections succeed
- **SSL Activation**: < 5 minutes after DNS verification
- **User Errors**: < 10% require support intervention

## Edge Cases & Error Handling

### 1. Domain Already in Use
```
Error: "This domain is already connected to another worker"
Action: "Remove existing connection or choose different domain"
```

### 2. DNS Propagation Timeout
```
Warning: "DNS records not detected after 30 minutes"
Help: "Check DNS configuration at your registrar"
Action: [Verify DNS Records] [Try Again] [Get Help]
```

### 3. SSL Certificate Failure
```
Error: "SSL certificate provisioning failed"
Reason: "Domain ownership verification failed"
Action: "Ensure CNAME records are proxied through CloudFlare"
```

### 4. Invalid Domain Format
```
Error: "Invalid domain name"
Examples: Valid: mybusiness.com, www.mybusiness.com
         Invalid: http://mybusiness.com, mybusiness
```

### 5. Domain Not Owned by User
```
Error: "Cannot verify domain ownership"
Action: "Ensure you have access to DNS settings"
Help: Link to registrar-specific guides
```

### 6. Rate Limiting
```
Warning: "Too many verification attempts"
Action: "Please wait 15 minutes before trying again"
```

## Domain Management Features

### Domain List View
```
Active Domains (2)
├─ mybusiness.com
│  Status: Active | SSL: ✓ | Added: Sep 30, 2025
│  [View Details] [Remove]
│
└─ www.mybusiness.com
   Status: Active | SSL: ✓ | Added: Sep 30, 2025
   [View Details] [Remove]

[+ Add Another Domain]
```

### Domain Details
- Current DNS records
- SSL certificate status and expiry
- Traffic statistics (if available from CloudFlare)
- Connection history
- Troubleshooting tools

## Integration with Registrars

### Direct Integration Links (Post-MVP)
- GoDaddy DNS management
- Namecheap DNS management
- Google Domains (now Squarespace)
- Name.com

### Registrar-Specific Guides
Provide tailored instructions for popular registrars:
1. GoDaddy (market leader)
2. Namecheap (popular with developers)
3. Cloudflare Registrar (recommend transfer)
4. Google/Squarespace Domains
5. Hover, Name.com, etc.

## Security Considerations

1. **Domain Hijacking Prevention**
   - Verify domain ownership via DNS TXT record
   - Require email confirmation for domain changes
   - Alert on suspicious domain additions

2. **SSL/TLS**
   - Force HTTPS redirects
   - HSTS headers enabled
   - Minimum TLS 1.2

3. **DNS Security**
   - Recommend DNSSEC where available
   - Warn about DNS hijacking risks
   - Verify registrar account security

## Related Stories

- [03 - CloudFlare Deployment](04-cloudflare-deployment.md) - Prerequisite
- [06 - SEO Metadata](07-seo-metadata.md) - Update canonical URLs
- [10 - Site Export](11-site-export.md) - Alternative hosting with custom domain

## Advanced Features (Post-MVP)

### Subdomain Support
- Allow blog.mybusiness.com, shop.mybusiness.com
- Different workers per subdomain
- Subdomain-specific content

### Domain Redirects
- Redirect www → non-www or vice versa
- Redirect old domains to new ones
- Custom redirect rules

### Geographic Routing
- Route EU traffic to different worker
- Compliance with data residency laws

### A/B Testing
- Route % of traffic to different versions
- Test new designs before full rollout

## Open Questions

- Q: Should we offer domain registration within Anglesite?
  - A: Post-MVP, partner with registrar API

- Q: Support apex domains without CNAME flattening?
  - A: Require CloudFlare DNS for apex, or use A records to CloudFlare IPs

- Q: How many domains per site?
  - A: Unlimited for now, may add limits later

- Q: Automatic CloudFlare DNS transfer prompt?
  - A: Yes, detect external DNS and suggest transfer for easier management

## Testing Scenarios

1. **CloudFlare Domain**: Add domain already on CF
2. **External DNS**: Add domain from GoDaddy
3. **New Domain**: Guide user through domain purchase
4. **Propagation Delay**: Simulate slow DNS propagation
5. **SSL Failure**: Test various SSL provisioning errors
6. **Multiple Domains**: Add 5 domains to one site
7. **Domain Removal**: Remove domain, verify cleanup
8. **Invalid Domains**: Test malformed domain names
9. **Ownership Verification**: Test without proper DNS access

## Definition of Done

- [ ] Code implemented with full domain connection flow
- [ ] Unit tests for DNS verification (>90% coverage)
- [ ] Integration test with CloudFlare API (sandbox)
- [ ] Mock external DNS propagation scenarios
- [ ] Error handling for all common registrars
- [ ] Performance: DNS verification polling every 30s
- [ ] Documentation: Guides for top 5 registrars
- [ ] QA: Successful domain connection tested
- [ ] User testing: 5 users connect their domains successfully
- [ ] Security review: Domain verification tested
