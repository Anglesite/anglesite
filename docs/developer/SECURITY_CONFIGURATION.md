# Security Configuration

This document outlines the security automation and configuration for the @dwk monorepo.

## GitHub Actions Security Workflows

### Required Repository Secrets

The following secrets must be configured in your GitHub repository settings:

- `NPM_TOKEN`: NPM authentication token for publishing packages
  - Required for: Release workflow package publishing
  - Scope: Publish access to all @dwk packages
  - Setup: Generate at <https://www.npmjs.com/settings/tokens>

### Security Scanning Overview

| Workflow                  | Trigger          | Purpose                      | Frequency   |
| ------------------------- | ---------------- | ---------------------------- | ----------- |
| `pr-test.yml`             | Pull Requests    | Security audit on PRs        | Per PR      |
| `main-test.yml`           | Main branch push | Security audit with coverage | Per commit  |
| `codeql-analysis.yml`     | PR/Push/Schedule | Static code analysis         | PR + Weekly |
| `dependency-security.yml` | Schedule/Manual  | Comprehensive security scan  | Weekly      |

### Security Features

#### 1. Dependency Vulnerability Scanning

- **High severity blocking**: PRs blocked on high/critical vulnerabilities
- **Weekly deep scan**: Comprehensive vulnerability assessment
- **License compliance**: Automatic license checking
- **Automated issue creation**: Security alerts for maintainers

#### 2. Static Application Security Testing (SAST)

- **CodeQL analysis**: GitHub's semantic code analysis
- **Security-extended queries**: Enhanced vulnerability detection
- **JavaScript/TypeScript coverage**: Full monorepo analysis

#### 3. Supply Chain Security

- **npm audit integration**: Dependency vulnerability detection
- **License validation**: Compliance with acceptable licenses
- **Automated reporting**: Security status in workflow summaries

### Secret Scanning Prevention

#### 4. Pre-commit Secret Detection

- **detect-secrets**: Baseline-driven secret detection with false positive management
- **TruffleHog**: High-confidence secret detection with verification
- **Custom patterns**: AWS keys, private keys, environment files
- **Pre-commit hooks**: Prevents secret commits at source

#### 5. Repository Secret Scanning

- **Multiple tools**: detect-secrets, TruffleHog, GitLeaks, Semgrep
- **Scheduled scans**: Weekly comprehensive repository scanning
- **Automated alerts**: GitHub issues created for detected secrets
- **SARIF integration**: Security findings uploaded to GitHub Security tab

## Security Policies

### Vulnerability Response

1. **High/Critical**: Block PRs, immediate attention required
2. **Medium**: Weekly review, plan remediation
3. **Low**: Monthly review, consider during maintenance

### Dependency Management

- Keep dependencies updated regularly
- Review security advisories weekly
- Test thoroughly after security updates
- Document any security exceptions

## Manual Security Commands

```bash
# Run security audit
npm audit --audit-level=high

# Fix automatically resolvable vulnerabilities
npm audit fix

# Check for outdated packages
npm outdated

# License compliance check
npx license-checker --summary

# Secret scanning commands
detect-secrets scan --all-files --baseline .secrets.baseline
detect-secrets audit --baseline .secrets.baseline

# Install and run pre-commit hooks
pip install pre-commit
pre-commit install
pre-commit run --all-files
```

## Secret Management Best Practices

### Environment Variables

- Use `.env.example` files to document required variables
- Never commit actual `.env` files
- Use secret management services for production

### Certificates and Keys

- Store test certificates only in `test-certs*` directories
- Use proper certificate management in production
- Rotate certificates regularly

### API Keys and Tokens

- Use GitHub Secrets for CI/CD tokens
- Implement key rotation policies
- Monitor for exposed API keys

## Security Incident Response

1. **Detection**: Automated workflows create GitHub issues for high-severity findings
2. **Assessment**: Review the specific vulnerability and impact
3. **Remediation**: Apply fixes, test thoroughly
4. **Verification**: Re-run security scans to confirm resolution
5. **Documentation**: Update this document if policies change

## Security Contacts

For security-related questions or to report vulnerabilities:

- Create a GitHub issue with the `security` label
- For sensitive issues, use GitHub's private vulnerability reporting

## Compliance Notes

This monorepo follows security best practices including:

- Automated dependency scanning
- Static code analysis
- License compliance checking
- Regular security assessments
- Incident response procedures
