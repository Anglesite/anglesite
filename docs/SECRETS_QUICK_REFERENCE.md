# Secrets Quick Reference Card

Quick reference for setting up and maintaining NPM_TOKEN and other secrets.

## 🚀 Quick Setup (5 minutes)

### 1. Generate NPM Token

```bash
# Login to NPM (if not already)
npm login

# Or visit: https://www.npmjs.com/settings/tokens
# Create new token → Automation type
```

### 2. Add to GitHub Repository

```
Repository → Settings → Secrets and variables → Actions
→ New repository secret
Name: NPM_TOKEN
Value: [paste your token]
```

### 3. Verify Setup

```bash
# Test locally (optional)
export NPM_TOKEN="your-token-here"
npm run verify-secrets

# Test in GitHub Actions
Go to Actions → Run workflow → "Validate Secrets"
```

## 🔧 Troubleshooting Commands

```bash
# Check NPM authentication
npm whoami

# Check organization access
npm org ls
npm access list packages @dwk

# Test package publishing (dry run)
cd anglesite-11ty && npm publish --dry-run

# Full verification
npm run verify-secrets
```

## ❌ Common Errors & Quick Fixes

| Error              | Quick Fix                                         |
| ------------------ | ------------------------------------------------- |
| `401 Unauthorized` | Regenerate NPM token, update GitHub secret        |
| `403 Forbidden`    | Join @dwk organization, check publish permissions |
| `404 Not Found`    | Create @dwk NPM organization                      |
| Token expired      | Generate new token, update secret                 |

## 📋 Maintenance Checklist

### Monthly

- [ ] Check NPM audit logs
- [ ] Review organization members

### Quarterly

- [ ] Rotate NPM tokens
- [ ] Update repository secrets
- [ ] Test release workflow

### Before Expiration

- [ ] Generate new token
- [ ] Update GitHub secrets
- [ ] Test workflows
- [ ] Set new expiration reminder

## 🆘 Get Help

- **Full Guide:** [docs/SECRETS_SETUP_GUIDE.md](SECRETS_SETUP_GUIDE.md)
- **Issue Template:** [Report secret problems](.github/ISSUE_TEMPLATE/secrets-setup-help.md)
- **Verification:** Run `npm run verify-secrets` or GitHub Actions "Validate Secrets"

## 🔒 Security Checklist

- [ ] NPM token is Automation type
- [ ] Token has publish permissions for @dwk packages
- [ ] GitHub secret is properly configured
- [ ] 2FA enabled on NPM account
- [ ] Token expiration date documented
- [ ] No tokens committed to repository
