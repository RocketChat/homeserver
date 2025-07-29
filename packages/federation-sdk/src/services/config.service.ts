import * as fs from 'node:fs';
import * as path from 'node:path';
import {
	createLogger,
	generateKeyPairsFromString,
	getKeyPair,
	toUnpaddedBase64,
} from '@hs/core';
import * as dotenv from 'dotenv';

import { z } from 'zod';

const CONFIG_FOLDER = process.env.CONFIG_FOLDER || '.';

export interface AppConfig {
	serverName: string;
	port: number;
	version: string;
	matrixDomain: string;
	keyRefreshInterval: number;
	signingKey?: string;
	timeout?: number;
	signingKeyPath?: string;
	path?: string;
	database: {
		uri: string;
		name: string;
		poolSize: number;
	};
}

export const AppConfigSchema = z.object({
	serverName: z.string().min(1, 'Server name is required'),
	port: z.number().int().min(1).max(65535, 'Port must be between 1 and 65535'),
	version: z.string().min(1, 'Server version is required'),
	matrixDomain: z.string().min(1, 'Matrix domain is required'),
	keyRefreshInterval: z
		.number()
		.int()
		.min(1, 'Key refresh interval must be at least 1'),
	signingKey: z.string().optional(),
	timeout: z.number().optional(),
	signingKeyPath: z.string(),
	database: z.object({
		uri: z.string().min(1, 'Database URI is required'),
		name: z.string().min(1, 'Database name is required'),
		poolSize: z.number().int().min(1, 'Pool size must be at least 1'),
	}),
});

export class ConfigService {
	private config: AppConfig;
	private logger = createLogger('ConfigService');

	constructor(values?: Partial<AppConfig>) {
		// Load config from environment if not provided
		const configValues = values || this.initializeConfig();

		try {
			const validatedConfig = AppConfigSchema.parse(configValues);
			this.config = validatedConfig;
		} catch (error) {
			if (error instanceof z.ZodError) {
				this.logger.error('Configuration validation failed:', error.errors);
				throw new Error(
					`Invalid configuration: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
				);
			}
			throw error;
		}
	}

	getConfig(): AppConfig {
		return this.config;
	}

	getServerConfig(): { name: string; port: number; version: string } {
		return {
			name: this.config.serverName,
			port: this.config.port,
			version: this.config.version,
		};
	}

	getDatabaseConfig(): AppConfig['database'] {
		return this.config.database;
	}

	getMatrixConfig(): {
		serverName: string;
		domain: string;
		keyRefreshInterval: number;
	} {
		return {
			serverName: this.config.serverName,
			domain: this.config.matrixDomain,
			keyRefreshInterval: this.config.keyRefreshInterval,
		};
	}

	get serverName(): string {
		return this.config.serverName;
	}

	get timeout(): number {
		return this.config.timeout || 30000;
	}

	async getSigningKey() {
		// If config contains a signing key, use it
		if (this.config.signingKey) {
			const signingKey = await generateKeyPairsFromString(
				this.config.signingKey,
			);
			return [signingKey];
		}
		// Otherwise load from file
		return this.loadSigningKey();
	}

	async getSigningKeyId(): Promise<string> {
		const signingKeys = await this.getSigningKey();
		const signingKey = signingKeys[0];
		return `${signingKey.algorithm}:${signingKey.version}` || 'ed25519:1';
	}

	async getSigningKeyBase64(): Promise<string> {
		const signingKeys = await this.getSigningKey();
		return toUnpaddedBase64(signingKeys[0].privateKey);
	}

	async reconstructSigningKey(keyData: string) {
		this.logger.info('Reconstructing signing key from settings data');

		try {
			const signingKey = await generateKeyPairsFromString(keyData);
			this.logger.info('Successfully reconstructed signing key from settings');
			return signingKey;
		} catch (error: unknown) {
			const errorMessage =
				error instanceof Error ? error.message : 'Unknown error';
			this.logger.error(`Failed to reconstruct signing key: ${errorMessage}`);
			throw error;
		}
	}

	private loadEnvFiles(): void {
		const nodeEnv = process.env.NODE_ENV || 'development';

		const defaultEnvPath = path.resolve(process.cwd(), '.env');
		if (fs.existsSync(defaultEnvPath)) {
			dotenv.config({ path: defaultEnvPath });
			this.logger.info('Loaded configuration from .env');
		}

		const envSpecificPath = path.resolve(process.cwd(), `.env.${nodeEnv}`);
		if (fs.existsSync(envSpecificPath)) {
			dotenv.config({ path: envSpecificPath });
			this.logger.info(`Loaded configuration from .env.${nodeEnv}`);
		}

		const localEnvPath = path.resolve(process.cwd(), '.env.local');
		if (fs.existsSync(localEnvPath)) {
			dotenv.config({ path: localEnvPath });
			this.logger.info('Loaded configuration from .env.local');
		}
	}

	private mergeConfigs(
		baseConfig: AppConfig,
		newConfig: Partial<AppConfig>,
	): AppConfig {
		return {
			...baseConfig,
			...newConfig,
			database: { ...baseConfig.database, ...newConfig.database },
		};
	}

	async loadSigningKey() {
		try {
			const signingKeyPath = `${CONFIG_FOLDER}/${this.config.serverName}.signing.key`;
			this.logger.info(`Loading signing key from ${signingKeyPath}`);
			const keys = await getKeyPair({ signingKeyPath });
			this.logger.info(
				`Successfully loaded signing key for server ${this.config.serverName}`,
			);
			return keys;
		} catch (error: unknown) {
			const errorMessage =
				error instanceof Error ? error.message : 'Unknown error';
			this.logger.error(`Failed to load signing key: ${errorMessage}`);
			throw error;
		}
	}

	private initializeConfig(): AppConfig {
		return {
			serverName: process.env.SERVER_NAME || 'rc1',
			port: this.getNumberFromEnv('SERVER_PORT', 8080),
			version: process.env.SERVER_VERSION || '1.0',
			database: {
				uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/matrix',
				name: process.env.DATABASE_NAME || 'matrix',
				poolSize: this.getNumberFromEnv('DATABASE_POOL_SIZE', 10),
			},
			matrixDomain: process.env.MATRIX_DOMAIN || 'rc1',
			keyRefreshInterval: this.getNumberFromEnv(
				'MATRIX_KEY_REFRESH_INTERVAL',
				60,
			),
			signingKeyPath: process.env.CONFIG_FOLDER || './rc1.signing.key',
		};
	}

	private getNumberFromEnv(key: string, defaultValue: number): number {
		const envValue = process.env[key];
		return envValue ? Number.parseInt(envValue) : defaultValue;
	}

	getServerName(): string {
		return this.config.serverName;
	}

	isDebugEnabled(): boolean {
		return process.env.DEBUG === 'true';
	}
}
