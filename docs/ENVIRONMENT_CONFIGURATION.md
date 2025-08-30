# Environment Configuration Guide

This guide explains how to configure development, testing, and production environments for the @dwk monorepo.

## 🌍 Environment Overview

The @dwk monorepo supports multiple environment configurations:

| Environment     | Purpose                                            | Configuration                          |
| --------------- | -------------------------------------------------- | -------------------------------------- |
| **Development** | Local development and debugging                    | `.env.development`                     |
| **Test**        | Automated testing (unit, integration, performance) | `.env.test`                            |
| **Production**  | Production builds and releases                     | `.env.production`                      |
| **CI/CD**       | GitHub Actions workflows                           | GitHub Secrets + Environment variables |

## 🔧 Environment Variables Reference

### Core Application Variables

| Variable    | Description               | Default       | Required | Environments |
| ----------- | ------------------------- | ------------- | -------- | ------------ |
| `NODE_ENV`  | Node.js environment mode  | `development` | Yes      | All          |
| `DEBUG`     | Debug logging level       | `false`       | No       | Dev/Test     |
| `LOG_LEVEL` | Application logging level | `info`        | No       | All          |

### Anglesite App Variables

| Variable                | Description                    | Default               | Required | Environments |
| ----------------------- | ------------------------------ | --------------------- | -------- | ------------ |
| `ANGLESITE_DATA_DIR`    | Directory for user data        | `~/anglesite-data`    | No       | All          |
| `ANGLESITE_THEME_DIR`   | Custom themes directory        | `~/anglesite-themes`  | No       | All          |
| `ANGLESITE_PLUGINS_DIR` | Custom plugins directory       | `~/anglesite-plugins` | No       | All          |
| `ANGLESITE_AUTO_UPDATE` | Enable automatic updates       | `true`                | No       | Prod         |
| `ANGLESITE_TELEMETRY`   | Enable telemetry collection    | `false`               | No       | All          |
| `ANGLESITE_DEV_TOOLS`   | Enable dev tools in production | `false`               | No       | Prod         |

### Build & Compilation Variables

| Variable             | Description                  | Default                      | Required | Environments |
| -------------------- | ---------------------------- | ---------------------------- | -------- | ------------ |
| `WEBPACK_MODE`       | Webpack build mode           | `development`                | No       | Dev/Prod     |
| `GENERATE_SOURCEMAP` | Generate source maps         | `true` (dev), `false` (prod) | No       | All          |
| `BUNDLE_ANALYZER`    | Enable bundle analyzer       | `false`                      | No       | Dev          |
| `BUILD_PATH`         | Output directory for builds  | `dist`                       | No       | All          |
| `PUBLIC_URL`         | Public URL for static assets | `/`                          | No       | Prod         |

### Testing Variables

| Variable                   | Description                   | Default | Required | Environments |
| -------------------------- | ----------------------------- | ------- | -------- | ------------ |
| `CI`                       | Running in CI environment     | `false` | No       | CI           |
| `JEST_WORKERS`             | Number of Jest workers        | `50%`   | No       | Test/CI      |
| `TEST_TIMEOUT`             | Default test timeout (ms)     | `5000`  | No       | Test         |
| `COVERAGE_THRESHOLD`       | Coverage threshold percentage | `80`    | No       | Test         |
| `BENCHMARK_ITERATIONS`     | Performance test iterations   | `10`    | No       | Performance  |
| `PERFORMANCE_THRESHOLD_MS` | Performance threshold         | `1000`  | No       | Performance  |

### NPM & Publishing Variables

| Variable           | Description              | Default                      | Required | Environments |
| ------------------ | ------------------------ | ---------------------------- | -------- | ------------ |
| `NPM_TOKEN`        | NPM authentication token | -                            | Yes      | CI/Prod      |
| `NPM_REGISTRY`     | NPM registry URL         | `https://registry.npmjs.org` | No       | All          |
| `NPM_CONFIG_CACHE` | NPM cache directory      | `~/.npm`                     | No       | All          |

### Security & Monitoring Variables

| Variable                | Description                   | Default                 | Required | Environments |
| ----------------------- | ----------------------------- | ----------------------- | -------- | ------------ |
| `ENABLE_SECURITY_AUDIT` | Run security audits           | `true`                  | No       | CI/Prod      |
| `CODEQL_LANGUAGES`      | Languages for CodeQL analysis | `javascript,typescript` | No       | CI           |
| `SENTRY_DSN`            | Sentry error tracking DSN     | -                       | No       | Prod         |
| `ANALYTICS_TRACKING_ID` | Analytics tracking ID         | -                       | No       | Prod         |

## 📁 Environment File Structure

### Local Development Files

```
.env                    # Default environment variables
.env.local             # Local overrides (gitignored)
.env.development       # Development-specific variables
.env.development.local # Local development overrides (gitignored)
.env.test              # Test environment variables
.env.test.local        # Local test overrides (gitignored)
.env.production        # Production environment variables
```

### Package-Specific Environment Files

```
anglesite/.env                    # Anglesite-specific variables
anglesite-11ty/.env              # Eleventy plugin variables
anglesite-starter/.env           # Starter template variables
web-components/.env              # WebC components variables
```

## 🛠️ Environment Setup

### Development Environment

1. **Clone the repository:**

   ```bash
   git clone <repository-url>
   cd @dwk
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Create local environment file:**

   ```bash
   cp .env.example .env.local
   ```

4. **Configure development variables:**

   ```bash
   # .env.local
   NODE_ENV=development
   DEBUG=true
   LOG_LEVEL=debug
   ANGLESITE_DEV_TOOLS=true
   BUNDLE_ANALYZER=false
   GENERATE_SOURCEMAP=true
   ```

5. **Package-specific setup:**
   ```bash
   # For Anglesite development
   cd anglesite
   cp .env.example .env.local
   # Configure Anglesite-specific variables
   ```

### Testing Environment

1. **Configure test environment:**

   ```bash
   # .env.test
   NODE_ENV=test
   CI=false
   JEST_WORKERS=1
   TEST_TIMEOUT=10000
   BENCHMARK_ITERATIONS=5
   PERFORMANCE_THRESHOLD_MS=2000
   COVERAGE_THRESHOLD=75
   ```

2. **Run tests:**
   ```bash
   npm test                    # Unit tests
   npm run test:integration   # Integration tests
   npm run test:performance   # Performance tests
   npm run test:coverage      # Coverage tests
   ```

### Production Environment

1. **Configure production variables:**

   ```bash
   # .env.production
   NODE_ENV=production
   LOG_LEVEL=warn
   GENERATE_SOURCEMAP=false
   ANGLESITE_AUTO_UPDATE=true
   ANGLESITE_TELEMETRY=true
   ENABLE_SECURITY_AUDIT=true
   ```

2. **Build for production:**
   ```bash
   npm run build
   ```

## 🚀 CI/CD Environment Configuration

### GitHub Actions Environment Variables

Configure in repository **Settings** → **Secrets and variables** → **Actions**:

#### Repository Secrets

```
NPM_TOKEN=npm_xxxxxxxxxxxxxxxxxxxx
SENTRY_DSN=https://xxxxxxxxxx@sentry.io/xxxxxxx
```

#### Repository Variables

```
NODE_ENV=test
CI=true
JEST_WORKERS=50%
COVERAGE_THRESHOLD=80
BENCHMARK_ITERATIONS=10
ENABLE_SECURITY_AUDIT=true
```

#### Environment-Specific Variables

**Development Environment:**

```
DEBUG=true
LOG_LEVEL=debug
GENERATE_SOURCEMAP=true
```

**Production Environment:**

```
LOG_LEVEL=error
GENERATE_SOURCEMAP=false
ANGLESITE_AUTO_UPDATE=true
```

### Workflow Environment Configuration

```yaml
# Example GitHub Actions workflow configuration
jobs:
  test:
    runs-on: ubuntu-latest
    env:
      NODE_ENV: test
      CI: true
      JEST_WORKERS: 50%
      BENCHMARK_ITERATIONS: ${{ vars.BENCHMARK_ITERATIONS || '10' }}
      PERFORMANCE_THRESHOLD_MS: ${{ vars.PERFORMANCE_THRESHOLD_MS || '1000' }}
    steps:
      - name: Run tests
        run: npm test
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## 🔒 Security Best Practices

### Environment Variable Security

1. **Never commit sensitive data:**

   ```bash
   # ❌ Don't do this
   echo "NPM_TOKEN=npm_real_token" >> .env

   # ✅ Use local files or CI secrets
   echo "NPM_TOKEN=npm_real_token" >> .env.local
   ```

2. **Use different tokens per environment:**

   ```bash
   # Development
   NPM_TOKEN=npm_dev_token_readonly

   # Production/CI
   NPM_TOKEN=npm_prod_token_publish
   ```

3. **Validate environment variables:**
   ```javascript
   // scripts/validate-env.js
   const requiredVars = ["NODE_ENV", "NPM_TOKEN"];
   const missing = requiredVars.filter((key) => !process.env[key]);
   if (missing.length > 0) {
     throw new Error(`Missing environment variables: ${missing.join(", ")}`);
   }
   ```

### Access Control

- ✅ **Restrict CI secrets** to necessary workflows only
- ✅ **Use environment protection rules** for production deployments
- ✅ **Enable required reviewers** for sensitive environment changes
- ✅ **Audit environment access** regularly

## 🐛 Troubleshooting

### Common Issues

#### 1. Environment Variables Not Loading

```bash
# Check if .env files exist
ls -la .env*

# Verify variable loading
node -e "console.log(process.env.NODE_ENV)"

# Check dotenv configuration
grep -r "dotenv" package.json
```

#### 2. Different Behavior Across Environments

```bash
# Compare environment configurations
diff .env.development .env.production

# Check for platform-specific issues
echo "Platform: $NODE_PLATFORM"
echo "Arch: $NODE_ARCH"
```

#### 3. CI/CD Environment Issues

```bash
# Debug GitHub Actions variables
echo "NODE_ENV: $NODE_ENV"
echo "CI: $CI"
echo "Available variables:"
env | grep -E "(NODE_|NPM_|CI|GITHUB_)" | sort
```

#### 4. Package-Specific Configuration Problems

```bash
# Check package-specific environment loading
cd anglesite
npm run debug:env  # If available

# Verify build configuration
npm run build:debug
```

### Debug Commands

```bash
# Show all environment variables
env | sort

# Show Node.js-specific variables
env | grep NODE

# Test environment loading
node -e "require('dotenv').config(); console.log(process.env)"

# Validate environment configuration
npm run validate:env  # If script exists
```

## 📋 Environment Validation Checklist

### Development Setup

- [ ] Node.js version matches `.nvmrc`
- [ ] All required environment variables set
- [ ] Local `.env.local` file configured
- [ ] Package-specific environments configured
- [ ] Development tools accessible

### Testing Setup

- [ ] Test environment variables configured
- [ ] Test databases/services accessible
- [ ] Coverage thresholds appropriate
- [ ] Performance test parameters set

### Production Setup

- [ ] Production environment variables set
- [ ] Source maps disabled for production
- [ ] Telemetry and monitoring configured
- [ ] Security auditing enabled
- [ ] Auto-update settings configured

### CI/CD Setup

- [ ] Repository secrets configured
- [ ] Environment variables set in CI
- [ ] Workflow permissions appropriate
- [ ] Environment protection rules enabled

## 🔄 Environment Migration

### Updating Environment Configuration

1. **Document current state:**

   ```bash
   # Export current environment
   env > current-env.txt
   ```

2. **Update configuration files:**

   ```bash
   # Update .env files
   vim .env.development
   vim .env.production
   ```

3. **Update CI/CD configuration:**
   - Repository Settings → Secrets and variables
   - Update workflow files if needed

4. **Test changes:**

   ```bash
   # Test locally
   npm run test:env

   # Test in CI
   git push origin feature-branch
   ```

5. **Deploy changes:**
   ```bash
   # Deploy to production
   npm run deploy:production
   ```

## 📚 Additional Resources

- [Node.js Environment Variables](https://nodejs.org/api/process.html#process_process_env)
- [dotenv Documentation](https://github.com/motdotla/dotenv)
- [GitHub Actions Environment Variables](https://docs.github.com/en/actions/environment-variables)
- [Webpack Environment Variables](https://webpack.js.org/guides/environment-variables/)
- [Jest Configuration](https://jestjs.io/docs/configuration)

## 🤝 Contributing Environment Changes

When contributing changes that affect environment configuration:

1. **Update this documentation**
2. **Update `.env.example` files**
3. **Add validation scripts if needed**
4. **Test across all environments**
5. **Document breaking changes**

---

_This guide is part of the @dwk monorepo documentation. Keep it updated as environment requirements evolve._
