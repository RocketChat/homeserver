import * as fs from 'node:fs';
import * as path from 'node:path';

const defaults = {
  name: 'localhost',
};

let cachedConfig: any = null;

function loadConfig(): any {
  if (cachedConfig) {
    return cachedConfig;
  }
  
  try {
    const configPath = process.env.MATRIX_CONFIG_PATH;
    
    if (configPath && fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf8');
      cachedConfig = JSON.parse(configContent);
      return cachedConfig;
    }
    
    const defaultPaths = [
      path.join(process.cwd(), 'config.json'),
      path.join(process.cwd(), 'matrix-config.json'),
    ];
    
    for (const filepath of defaultPaths) {
      if (fs.existsSync(filepath)) {
        const configContent = fs.readFileSync(filepath, 'utf8');
        cachedConfig = JSON.parse(configContent);
        return cachedConfig;
      }
    }
    
    console.warn('No configuration file found, using defaults');
    return defaults;
  } catch (error) {
    console.error('Error loading configuration:', error);
    return defaults;
  }
}

export function getServerName(): string {
  const config = loadConfig();
  return config.name || defaults.name;
}

export function getFullConfig(): any {
  return loadConfig();
} 