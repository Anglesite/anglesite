# Secrets Setup Guide

This guide explains how to configure the required secrets for the @dwk monorepo GitHub Actions workflows to function properly.

## 🔐 Required Secrets Overview

The following secrets must be configured in your GitHub repository settings:

| Secret         | Purpose                | Required For     | Scope         |
| -------------- | ---------------------- | ---------------- | ------------- |
| `NPM_TOKEN`    | NPM package publishing | Release workflow | **Critical**  |
| `GITHUB_TOKEN` | GitHub API access      | All workflows    | Auto-provided |

## 🚀 Quick Setup Checklist

- [ ] Generate NPM access token
- [ ] Add NPM_TOKEN to repository secrets
- [ ] Verify secret permissions
- [ ] Test release workflow (optional)
- [ ] Document token expiration date

## 📦 NPM Token Setup

### Step 1: Generate NPM Access Token

1. **Log in to NPM**

   ```bash
   npm login
   ```

   Or visit [npmjs.com](https://www.npmjs.com) and sign in

2. **Navigate to Access Tokens**
   - Go to your NPM profile → Access Tokens
   - Or visit: https://www.npmjs.com/settings/tokens

3. **Generate New Token**
   - Click "Generate New Token"
   - Choose token type: **Automation** (recommended for CI/CD)
   - Set appropriate scope and permissions

### Token Types Explained

| Type           | Use Case                              | Recommended     |
| -------------- | ------------------------------------- | --------------- |
| **Automation** | CI/CD pipelines, automated publishing | ✅ **Yes**      |
| **Publish**    | Manual publishing only                | ❌ Less secure  |
| **Read Only**  | Installing packages only              | ❌ Insufficient |

### Step 2: Configure Repository Secret

1. **Navigate to Repository Settings**
   - Go to your GitHub repository
   - Click **Settings** → **Secrets and variables** → **Actions**

2. **Add New Repository Secret**
   - Click **New repository secret**
   - Name: `NPM_TOKEN`
   - Value: Paste your NPM access token
   - Click **Add secret**

### Step 3: Verify NPM Organization Access

Ensure your NPM account has publish permissions for the required packages:

```bash
# Check your NPM organizations
npm org ls

# Check package access (if packages exist)
npm access list packages @dwk
```

Required package scopes:

- `@dwk/anglesite-11ty`
- `@dwk/anglesite-starter`
- `@dwk/web-components`

## 🔍 Token Security Best Practices

### Token Configuration

- ✅ **Use Automation tokens** for CI/CD
- ✅ **Set appropriate expiration** (e.g., 1 year)
- ✅ **Document expiration date** in your calendar
- ✅ **Use scoped packages** (@dwk/package-name)
- ❌ **Avoid Classic tokens** (less secure)

### Access Control

- ✅ **Restrict to specific packages** when possible
- ✅ **Use 2FA** on your NPM account
- ✅ **Regularly audit token usage**
- ✅ **Revoke unused tokens**

### Monitoring

- ✅ **Monitor NPM audit logs**
- ✅ **Set up email notifications** for package publishes
- ✅ **Review download statistics** for anomalies

## 🛠️ Testing Your Setup

### Method 1: Dry Run Test

Test NPM authentication without publishing:

```bash
# Test NPM authentication locally
echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" > .npmrc
npm whoami
rm .npmrc
```

### Method 2: Workflow Test

1. **Create a test release**

   ```bash
   git tag v0.0.1-test
   git push origin v0.0.1-test
   ```

2. **Monitor workflow execution**
   - Go to Actions tab in GitHub
   - Check the release workflow logs
   - Look for successful NPM authentication

3. **Clean up test release**
   ```bash
   git tag -d v0.0.1-test
   git push origin :refs/tags/v0.0.1-test
   ```

### Method 3: Manual Workflow Trigger

1. Go to **Actions** → **Release** workflow
2. Click **Run workflow**
3. Monitor execution for any authentication errors

## 🚨 Troubleshooting

### Common Issues

#### 1. "401 Unauthorized" Error

```
npm ERR! code E401
npm ERR! 401 Unauthorized - PUT https://registry.npmjs.org/@dwk%2fpackage-name
```

**Solutions:**

- ✅ Verify NPM_TOKEN is correctly set in repository secrets
- ✅ Check token hasn't expired
- ✅ Ensure token has publish permissions
- ✅ Verify package scope access (@dwk organization)

#### 2. "403 Forbidden" Error

```
npm ERR! code E403
npm ERR! 403 Forbidden - PUT https://registry.npmjs.org/@dwk%2fpackage-name
```

**Solutions:**

- ✅ Check organization membership for @dwk
- ✅ Verify publish permissions for specific packages
- ✅ Ensure 2FA is properly configured

#### 3. "404 Not Found" Error

```
npm ERR! code E404
npm ERR! 404 Not Found - PUT https://registry.npmjs.org/@dwk%2fpackage-name
```

**Solutions:**

- ✅ Create NPM organization: @dwk
- ✅ Verify package names in package.json files
- ✅ Check if packages were previously published

#### 4. Token Expiration

**Symptoms:**

- Previously working workflows suddenly fail
- NPM authentication errors after long period

**Solutions:**

- ✅ Generate new NPM token
- ✅ Update repository secret
- ✅ Set calendar reminder for next expiration

### Debugging Commands

```bash
# Check NPM authentication
npm whoami

# Test token locally (DO NOT commit .npmrc)
echo "//registry.npmjs.org/:_authToken=YOUR_TOKEN" > .npmrc
npm whoami
rm .npmrc

# Check package publish permissions
npm access list packages @dwk

# Verify organization membership
npm org ls @dwk

# Check package information
npm view @dwk/anglesite-11ty
```

## 📅 Token Maintenance

### Regular Tasks

**Monthly:**

- [ ] Review NPM audit logs
- [ ] Check for suspicious download patterns
- [ ] Verify all team members have appropriate access

**Quarterly:**

- [ ] Rotate NPM tokens (recommended)
- [ ] Review and update access permissions
- [ ] Audit organization members

**Before Expiration:**

- [ ] Generate new token 1 week before expiration
- [ ] Update repository secret
- [ ] Test workflows with new token
- [ ] Update documentation

### Token Rotation Process

1. **Generate new token** (while old one still works)
2. **Update repository secret** with new token
3. **Test critical workflows**
4. **Revoke old token** only after confirming new one works
5. **Update expiration tracking**

## 🔒 Security Considerations

### Repository Security

- ✅ **Enable branch protection** on main branch
- ✅ **Require status checks** before merging
- ✅ **Restrict push access** to repository
- ✅ **Enable security alerts**

### Workflow Security

- ✅ **Use specific action versions** (not @main)
- ✅ **Review third-party actions** before use
- ✅ **Limit workflow permissions** to minimum required
- ✅ **Enable workflow approval** for sensitive operations

### Token Security

- ✅ **Never log tokens** in workflow output
- ✅ **Use secrets for all sensitive data**
- ✅ **Regularly audit secret usage**
- ✅ **Monitor for token leaks** in repositories

## 📋 Setup Verification

After completing the setup, verify everything works:

### ✅ Verification Checklist

- [ ] NPM_TOKEN secret exists in repository settings
- [ ] Token has automation scope and publish permissions
- [ ] Account has access to @dwk organization
- [ ] Test workflow runs successfully
- [ ] Release workflow can authenticate to NPM
- [ ] All required packages can be published
- [ ] Token expiration date is documented

### Test Commands

```bash
# Test NPM token locally (for verification only)
export NPM_TOKEN="your-token-here"
echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" > .npmrc
npm whoami  # Should show your NPM username
npm access list packages @dwk  # Should show accessible packages
rm .npmrc
unset NPM_TOKEN
```

## 🆘 Getting Help

### NPM Support

- **NPM Documentation**: https://docs.npmjs.com/
- **NPM Support**: https://npmjs.com/support
- **Token Management**: https://docs.npmjs.com/creating-and-viewing-access-tokens

### GitHub Support

- **GitHub Secrets**: https://docs.github.com/en/actions/security-guides/encrypted-secrets
- **GitHub Actions**: https://docs.github.com/en/actions

### Internal Support

If you're setting up this repository:

1. **Check existing issues** in the repository
2. **Review workflow logs** for specific error messages
3. **Contact repository maintainers** with specific error details
4. **Include relevant logs** (with secrets redacted)

## 📚 Additional Resources

- [NPM Token Best Practices](https://docs.npmjs.com/about-access-tokens)
- [GitHub Secrets Documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Conventional Commits](https://conventionalcommits.org/) (for changelog generation)
- [Semantic Versioning](https://semver.org/) (for release management)

---

_This guide is part of the @dwk monorepo automation documentation. Keep it updated as the setup process evolves._
