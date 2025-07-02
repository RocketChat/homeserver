import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().transform(Number).default('8080'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  
  // Homeserver specific
  SERVER_NAME: z.string().default('localhost'),
  HOMESERVER_URL: z.string().url().default('http://localhost:8080'),
  
  // Security
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('60000'), // 1 minute
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),
  
  // Database (when needed)
  DATABASE_URL: z.string().optional(),
  
  // Rocket.Chat integration
  ROCKETCHAT_CONTEXT: z.string().optional(),
  ROCKETCHAT_URL: z.string().url().optional(),
  
  // Monitoring
  ENABLE_METRICS: z.enum(['true', 'false']).transform(v => v === 'true').default('false'),
  METRICS_PORT: z.string().transform(Number).default('9090'),
});

export type Config = z.infer<typeof ConfigSchema>;

let config: Config;

try {
  config = ConfigSchema.parse(process.env);
} catch (error) {
  console.error('Invalid configuration:', error);
  process.exit(1);
}

export default config;

export const isProduction = () => config.NODE_ENV === 'production';
export const isDevelopment = () => config.NODE_ENV === 'development';
export const isTest = () => config.NODE_ENV === 'test';