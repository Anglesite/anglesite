/**
 * @file Template loading utility for HTML templates
 */
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

/**
 * Interface for template replacement variables.
 */
interface TemplateVariables {
  [key: string]: string;
}

/**
 * Load and process an HTML template file with variable substitution.
 * @param templateName Name of the template file (without extension)
 * @param variables Object containing variables to substitute in template
 * @returns Processed HTML string
 */
export function loadTemplate(templateName: string, variables: TemplateVariables = {}): string {
  try {
    // Handle both development and packaged app paths
    let templatePath: string;

    try {
      if (app.isPackaged) {
        // In packaged app, use the extraResources path from electron-builder config
        templatePath = path.join(process.resourcesPath, 'src', 'renderer', 'ui', 'templates', `${templateName}.html`);
      } else {
        // In development, use __dirname
        templatePath = path.join(__dirname, 'templates', `${templateName}.html`);
      }
    } catch (appError) {
      // Fallback to __dirname if app module access fails
      console.warn('Failed to access app module, falling back to __dirname:', appError);
      templatePath = path.join(__dirname, 'templates', `${templateName}.html`);
    }

    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template file not found: ${templatePath}`);
    }

    let templateContent = fs.readFileSync(templatePath, 'utf8');

    // Replace template variables in the format {{variableName}}
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      templateContent = templateContent.replace(new RegExp(placeholder, 'g'), value);
    }

    return templateContent;
  } catch (error) {
    console.error(`Failed to load template ${templateName}:`, error);
    throw error;
  }
}

/**
 * Load template and return as data URL for use with BrowserWindow.loadURL.
 * @param templateName Name of the template file (without extension)
 * @param variables Object containing variables to substitute in template
 * @returns Data URL string
 */
export function loadTemplateAsDataUrl(templateName: string, variables: TemplateVariables = {}): string {
  const templateContent = loadTemplate(templateName, variables);
  return `data:text/html;charset=utf-8,${encodeURIComponent(templateContent)}`;
}

/**
 * Get the file path to a template for direct loading (with relative path support).
 * @param templateName Name of the template file (without extension)
 * @returns File URL string
 */
export function getTemplateFilePath(templateName: string): string {
  try {
    // Handle both development and packaged app paths
    let templatePath: string;

    try {
      if (app.isPackaged) {
        // In packaged app, use the extraResources path from electron-builder config
        templatePath = path.join(process.resourcesPath, 'src', 'renderer', 'ui', 'templates', `${templateName}.html`);
      } else {
        // In development, use __dirname
        templatePath = path.join(__dirname, 'templates', `${templateName}.html`);
      }
    } catch (appError) {
      // Fallback to __dirname if app module access fails
      console.warn('Failed to access app module, falling back to __dirname:', appError);
      templatePath = path.join(__dirname, 'templates', `${templateName}.html`);
    }

    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template file not found: ${templatePath}`);
    }

    // Convert to file URL
    return `file://${templatePath}`;
  } catch (error) {
    console.error(`Failed to get template file path for ${templateName}:`, error);
    throw error;
  }
}
