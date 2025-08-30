# Secret Scanning Setup Guide

This guide explains how to set up and use the secret scanning prevention system in the @dwk monorepo.

## Overview

The secret scanning system uses multiple layers of protection:

1. **Pre-commit hooks** - Prevent secrets from being committed
2. **GitHub Actions workflows** - Scan repository for secrets
3. **Git ignore patterns** - Block sensitive file types
4. **Baseline management** - Handle false positives

## Initial Setup

### 1. Install Pre-commit

```bash
# Install pre-commit (requires Python)
pip install pre-commit

# Install the hooks in your local repository
pre-commit install

# Run hooks on all files (first time setup)
pre-commit run --all-files
```

### 2. Configure Secret Detection Tools

The following tools are automatically configured:

- **detect-secrets**: Primary secret detection with baseline management
- **TruffleHog**: High-confidence secret detection
- **GitLeaks**: Git-focused secret scanning
- **Semgrep**: Pattern-based secret detection

### 3. Initialize Secrets Baseline

If you need to update the baseline after adding legitimate patterns:

```bash
# Generate new baseline (only if needed)
detect-secrets scan --all-files --baseline .secrets.baseline

# Review and approve findings
detect-secrets audit --baseline .secrets.baseline
```

## How It Works

### Pre-commit Protection

When you attempt to commit, the following checks run automatically:

1. **Secret Detection**: Scans staged files for secrets
2. **File Type Checks**: Blocks common secret file patterns
3. **Environment Files**: Prevents `.env` file commits
4. **Certificate Files**: Blocks certificate commits outside test directories
5. **Security Audit**: Runs npm audit on pre-push

### GitHub Actions Scanning

The repository is scanned automatically:

- **On every PR**: Quick secret scan
- **On main branch**: Comprehensive scanning
- **Weekly**: Full repository deep scan
- **Manual**: Workflow can be triggered manually

### False Positive Management

If legitimate patterns are flagged:

1. **Review the finding** to confirm it's not a real secret
2. **Add to baseline**: Run `detect-secrets audit --baseline .secrets.baseline`
3. **Mark as false positive** in the interactive audit
4. **Commit the updated baseline**

## Common Scenarios

### Adding Test Data

For test files containing fake credentials:

```bash
# Add test files to .trufflehogignore
echo "test/fixtures/fake-credentials.json" >> .trufflehogignore

# Or mark specific lines in detect-secrets baseline
detect-secrets audit --baseline .secrets.baseline
```

### Environment File Templates

Create `.env.example` files instead of `.env`:

```bash
# Good: Template file (committed)
API_KEY=your_api_key_here
DATABASE_URL=your_database_url_here

# Bad: Actual credentials (never commit)
API_KEY=sk_live_abc123...
DATABASE_URL=postgres://user:password@host/db
```

### Certificate Management

For development certificates:

```bash
# Store in designated directory
mkdir test-certs
cp development.pem test-certs/

# Production certificates should never be committed
# Use secret management services instead
```

## Troubleshooting

### Pre-commit Hook Failures

If pre-commit hooks fail:

```bash
# See what failed
git status

# Fix the issues and try again
git add .
git commit -m "Your message"

# Skip hooks only if absolutely necessary (not recommended)
git commit -m "Your message" --no-verify
```

### False Positive Detection

If legitimate code is flagged:

1. **Review carefully** - make sure it's not actually a secret
2. **Update baseline** if it's definitely safe
3. **Add ignore patterns** for specific files
4. **Contact security team** if unsure

### Performance Issues

If scanning is slow:

- **Exclude large files** in `.trufflehogignore`
- **Use specific file patterns** instead of scanning everything
- **Update ignore patterns** for build artifacts

## Monitoring and Alerts

### GitHub Security Tab

Secret scanning results appear in:

- Repository Security tab
- Pull Request checks
- Actions workflow summaries

### Automated Issues

High-priority findings automatically create GitHub issues with:

- Detailed scan results
- Remediation steps
- Security team notification

### Weekly Reports

Scheduled scans provide:

- Comprehensive security status
- Trend analysis
- Action items for security team

## Emergency Response

If a secret is accidentally committed:

### 1. Immediate Actions

```bash
# Remove the secret from the latest commit
git reset HEAD~1
# Edit files to remove secret
git add .
git commit -m "Remove sensitive data"

# Force push to rewrite history (use carefully)
git push --force-with-lease
```

### 2. Security Checklist

- [ ] Rotate the compromised secret immediately
- [ ] Check if secret was used maliciously
- [ ] Update secret scanning rules if needed
- [ ] Document incident for future prevention
- [ ] Consider if git history needs cleaning

### 3. History Cleaning

For secrets in git history:

```bash
# Use git-filter-repo (recommended)
git filter-repo --invert-paths --path path/to/secret/file

# Or use BFG Repo-Cleaner for large repositories
java -jar bfg.jar --delete-files secret-file.txt
```

## Best Practices

### Development Workflow

1. **Run pre-commit hooks** locally before pushing
2. **Review PR security checks** before merging
3. **Keep tools updated** regularly
4. **Monitor security alerts** weekly

### Team Practices

1. **Train developers** on secret management
2. **Regular security reviews** of scanning rules
3. **Incident response drills** for secret exposure
4. **Documentation updates** as tools evolve

### Tool Maintenance

1. **Update baselines** when adding legitimate patterns
2. **Review ignore files** quarterly
3. **Audit scanning tools** for effectiveness
4. **Performance optimization** as repository grows
