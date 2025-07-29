import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger, generateKeyPairsFromString, getKeyPair } from '@hs/core';
import * as dotenv from 'dotenv';

import { container, inject, singleton } from 'tsyringe';
import { z } from 'zod';
import { FederationModuleOptions } from '../types';

const CONFIG_FOLDER = process.env.CONFIG_FOLDER || '.';

export interface AppConfig {
	server: {
		name: string;
		version: string;
		port: number;
		baseUrl: string;
		host: string;
	};

	database: {
		uri: string;
		name: string;
		poolSize: number;
	};

	matrix: {
		serverName: string;
		domain: string;
		keyRefreshInterval: number;
	};

	signingKey?: unknown;
	signingKeyPath?: string;
	path?: string;
}

export const AppConfigSchema = z.object({
	server: z.object({
		name: z.string().min(1, 'Server name is required'),
		version: z.string().min(1, 'Server version is required'),
		port: z
			.number()
			.int()
			.min(1)
			.max(65535, 'Port must be between 1 and 65535'),
		baseUrl: z.string().url('Base URL must be a valid URL'),
		host: z.string().min(1, 'Host is required'),
	}),
	database: z.object({
		uri: z.string().min(1, 'Database URI is required'),
		name: z.string().min(1, 'Database name is required'),
		poolSize: z.number().int().min(1, 'Pool size must be at least 1'),
	}),
	matrix: z.object({
		serverName: z.string().min(1, 'Matrix server name is required'),
		domain: z.string().min(1, 'Matrix domain is required'),
		keyRefreshInterval: z
			.number()
			.int()
			.min(1, 'Key refresh interval must be at least 1'),
	}),
	signingKeyPath: z.string(),
});

@singleton()
export class ConfigService {
	private config: AppConfig;
	private logger = createLogger('ConfigService');

	constructor(@inject('APP_CONFIG') values: AppConfig) {
		try {
			const validatedConfig = AppConfigSchema.parse(values);
			this.config = {
				server: {
					name: validatedConfig.server.name,
					version: validatedConfig.server.version,
					port: validatedConfig.server.port,
					baseUrl: validatedConfig.server.baseUrl,
					host: validatedConfig.server.host,
				},
				database: {
					uri: validatedConfig.database.uri,
					name: validatedConfig.database.name,
					poolSize: validatedConfig.database.poolSize,
				},
				matrix: {
					serverName: validatedConfig.matrix.serverName,
					domain: validatedConfig.matrix.domain,
					keyRefreshInterval: validatedConfig.matrix.keyRefreshInterval,
				},
				signingKeyPath: validatedConfig.signingKeyPath,
			};
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

	getServerConfig(): AppConfig['server'] {
		return this.config.server;
	}

	getDatabaseConfig(): AppConfig['database'] {
		return this.config.database;
	}

	getMatrixConfig(): AppConfig['matrix'] {
		return this.config.matrix;
	}

	async getSigningKey() {
		return this.loadSigningKey();
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
			server: { ...baseConfig.server, ...newConfig.server },
			database: { ...baseConfig.database, ...newConfig.database },
			matrix: { ...baseConfig.matrix, ...newConfig.matrix },
		};
	}

	async loadSigningKey() {
		const federationOptions =
			container.resolve<FederationModuleOptions>('FEDERATION_OPTIONS');
		if (federationOptions?.signingKey) {
			return [await this.reconstructSigningKey(federationOptions.signingKey)];
		}

		try {
			const signingKeyPath = `${CONFIG_FOLDER}/${this.config.server.name}.signing.key`;
			this.logger.info(`Loading signing key from ${signingKeyPath}`);
			const keys = await getKeyPair({ signingKeyPath });
			this.logger.info(
				`Successfully loaded signing key for server ${this.config.server.name}`,
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
			server: {
				name: process.env.SERVER_NAME || 'rc1',
				version: process.env.SERVER_VERSION || '1.0',
				port: this.getNumberFromEnv('SERVER_PORT', 8080),
				baseUrl: process.env.SERVER_BASE_URL || 'http://rc1:8080',
				host: process.env.SERVER_HOST || '0.0.0.0',
			},
			database: {
				uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/matrix',
				name: process.env.DATABASE_NAME || 'matrix',
				poolSize: this.getNumberFromEnv('DATABASE_POOL_SIZE', 10),
			},
			matrix: {
				serverName: process.env.MATRIX_SERVER_NAME || 'rc1',
				domain: process.env.MATRIX_DOMAIN || 'rc1',
				keyRefreshInterval: this.getNumberFromEnv(
					'MATRIX_KEY_REFRESH_INTERVAL',
					60,
				),
			},
		};
	}

	private getNumberFromEnv(key: string, defaultValue: number): number {
		const envValue = process.env[key];
		return envValue ? Number.parseInt(envValue) : defaultValue;
	}

	getServerName(): string {
		return this.config.server.name;
	}

	isDebugEnabled(): boolean {
		return process.env.DEBUG === 'true';
	}
}
