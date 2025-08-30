---
name: Secrets Setup Help
about: Get help with NPM token or secrets configuration
title: "[SECRETS] Issue with NPM token/secrets setup"
labels: ["setup", "secrets", "help wanted"]
assignees: []
---

## 🔐 Secrets Setup Issue

**I need help with:** (check all that apply)

- [ ] Setting up NPM_TOKEN
- [ ] GitHub repository secrets configuration
- [ ] NPM organization access
- [ ] Release workflow authentication errors
- [ ] Other secret-related issue

## 📋 Environment Information

**Repository:** [e.g., fork, main repository]
**NPM Account:** [your NPM username]
**Error Location:** [e.g., GitHub Actions workflow, local testing]

## ❌ Error Details

### Error Message

```
[Paste the exact error message here]
```

### Workflow Run (if applicable)

- **Workflow:** [e.g., Release, Changelog]
- **Run URL:** [link to failed workflow run]
- **Step that failed:** [e.g., "Publish anglesite-11ty to NPM"]

## 🔍 What I've Tried

**Verification Steps Completed:**

- [ ] Ran `npm run verify-secrets` locally
- [ ] Checked NPM_TOKEN is set in repository secrets
- [ ] Verified NPM account access to @dwk organization
- [ ] Confirmed NPM token has automation scope
- [ ] Read the setup guide (docs/SECRETS_SETUP_GUIDE.md)

**Additional Steps:**
[Describe any other troubleshooting steps you've taken]

## 📊 Verification Script Output

If you ran `npm run verify-secrets`, please paste the output:

<details>
<summary>Verification Script Output</summary>

```
[Paste the output of npm run verify-secrets here]
```

</details>

## 🤔 Expected vs Actual Behavior

**Expected:**
[What should happen - e.g., "NPM package should publish successfully"]

**Actual:**
[What actually happened - e.g., "Got 401 Unauthorized error"]

## 📱 Screenshots (if applicable)

[Add screenshots of error messages, NPM token configuration, etc.]

## 🆘 Additional Context

[Any other information that might help resolve the issue]

---

## 🔧 For Repository Maintainers

**Troubleshooting Checklist:**

- [ ] Verify issue is not due to token expiration
- [ ] Check if @dwk NPM organization exists and is accessible
- [ ] Confirm repository secrets are properly configured
- [ ] Test with a different NPM token if needed
- [ ] Check for recent changes in NPM API or GitHub Actions

**Common Solutions:**

- Token regeneration and update
- Organization access grant
- Repository secret reconfiguration
- Workflow permission adjustments
