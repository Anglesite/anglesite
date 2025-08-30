#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Configuration - UPDATE THESE VALUES
const BASE_URL = 'https://anglesite.dwk.io'; // Your custom domain
const SCHEMA_PATH = '/schemas';

// Files to update
const files = [
  // Main schema
  {
    file: 'docs/schemas/website.schema.json',
    updates: [
      {
        search: '"$id": "https://anglesite.dwk.io/schemas/website.json"',
        replace: `"$id": "${BASE_URL}${SCHEMA_PATH}/website.json"`
      },
      {
        search: '"$ref": "./modules/basic-info.json"',
        replace: `"$ref": "${BASE_URL}${SCHEMA_PATH}/modules/basic-info.json"`
      },
      {
        search: '"$ref": "./modules/seo-robots.json"',
        replace: `"$ref": "${BASE_URL}${SCHEMA_PATH}/modules/seo-robots.json"`
      },
      {
        search: '"$ref": "./modules/web-standards.json"',
        replace: `"$ref": "${BASE_URL}${SCHEMA_PATH}/modules/web-standards.json"`
      },
      {
        search: '"$ref": "./modules/networking.json"',
        replace: `"$ref": "${BASE_URL}${SCHEMA_PATH}/modules/networking.json"`
      },
      {
        search: '"$ref": "./modules/analytics.json"',
        replace: `"$ref": "${BASE_URL}${SCHEMA_PATH}/modules/analytics.json"`
      },
      {
        search: '"$ref": "./modules/well-known.json"',
        replace: `"$ref": "${BASE_URL}${SCHEMA_PATH}/modules/well-known.json"`
      }
    ]
  },
  // Website data file
  {
    file: 'anglesite-11ty/src/_data/website.json',
    updates: [
      {
        search: '"$schema": "../../schemas/website.schema.json"',
        replace: `"$schema": "${BASE_URL}${SCHEMA_PATH}/website.schema.json"`
      }
    ]
  }
];

// Update function
function updateFiles() {
  if (BASE_URL === 'https://YOUR-USERNAME.github.io/YOUR-REPO') {
    console.log('❌ Please update the BASE_URL in this script first!');
    console.log('Set BASE_URL to your actual GitHub Pages URL.');
    process.exit(1);
  }

  console.log(`🔄 Updating schema URLs to: ${BASE_URL}${SCHEMA_PATH}`);
  
  files.forEach(fileConfig => {
    const filePath = path.join(process.cwd(), fileConfig.file);
    
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️ File not found: ${fileConfig.file}`);
      return;
    }

    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;

    fileConfig.updates.forEach(update => {
      if (content.includes(update.search)) {
        content = content.replace(update.search, update.replace);
        changed = true;
      }
    });

    if (changed) {
      fs.writeFileSync(filePath, content);
      console.log(`✅ Updated: ${fileConfig.file}`);
    } else {
      console.log(`⏭️ No changes needed: ${fileConfig.file}`);
    }
  });

  console.log('✨ Done! Your schemas are ready for publishing.');
  console.log(`📝 Remember to enable GitHub Pages and point it to the /docs folder.`);
}

updateFiles();