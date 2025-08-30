# Anglesite JSON Schemas

This directory contains JSON Schema definitions for Anglesite website configuration files.

## Publishing to GitHub Pages

1. **Push this `docs/` folder to your GitHub repository**
2. **Enable GitHub Pages** in your repository settings:
   - Go to Settings → Pages
   - Set Source to "Deploy from a branch"
   - Select branch `main` and folder `/docs`
3. **Update the schema URLs** (see below)

## Publishing to GitLab Pages

1. **Create a `.gitlab-ci.yml` file** in your repository root:
   ```yaml
   pages:
     script:
       - mkdir public
       - cp -r docs/* public/
     artifacts:
       paths:
         - public
     only:
       - main
   ```
2. **Push to GitLab** and the schemas will be available at `https://yourusername.gitlab.io/your-repo-name/`

## Updating Schema URLs

Once published, update the schema references in:

### 1. Main Schema (`schemas/website.schema.json`)

Replace the `$id` and `$ref` URLs:

```json
{
  "$id": "https://YOUR-USERNAME.github.io/YOUR-REPO/schemas/website.json",
  "allOf": [
    { "$ref": "https://YOUR-USERNAME.github.io/YOUR-REPO/schemas/modules/basic-info.json" },
    { "$ref": "https://YOUR-USERNAME.github.io/YOUR-REPO/schemas/modules/seo-robots.json" },
    ...
  ]
}
```

### 2. Website Configuration (`anglesite-11ty/src/_data/website.json`)

Update the `$schema` reference:

```json
{
  "$schema": "https://YOUR-USERNAME.github.io/YOUR-REPO/schemas/website.schema.json",
  "title": "Your Website Title",
  ...
}
```

## For GitHub:

- URL format: `https://USERNAME.github.io/REPOSITORY/schemas/`
- Example: `https://davidwkeith.github.io/anglesite-monorepo/schemas/`

## For GitLab:

- URL format: `https://USERNAME.gitlab.io/REPOSITORY/schemas/`
- Example: `https://davidwkeith.gitlab.io/anglesite-monorepo/schemas/`

## Testing

After publishing, test that the schemas are accessible:

```bash
curl https://YOUR-URL/schemas/website.schema.json
```

VS Code should then provide full IntelliSense and validation for your website.json files!
