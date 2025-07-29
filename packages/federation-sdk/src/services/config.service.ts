import { createLogger, getKeyPair } from '@hs/core';
import { z } from 'zod';

import { inject, singleton } from 'tsyringe';

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

	signingKeyPath: string;
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

	async loadSigningKey() {
		if (!this.config.signingKeyPath) {
			throw new Error('Signing key path is not set in the configuration.');
		}

		this.logger.info(`Loading signing key from ${this.config.signingKeyPath}`);

		try {
			const keys = await getKeyPair({
				signingKeyPath: this.config.signingKeyPath,
			});
			this.logger.info(
				`Successfully loaded signing key for server ${this.config.server.name}`,
			);
			return keys;
		} catch (error: unknown) {
			this.logger.error(
				`Failed to load signing key: ${error instanceof Error ? error.message : String(error)}`,
			);
			throw error;
		}
	}

	getServerName(): string {
		return this.config.server.name;
	}

	isDebugEnabled(): boolean {
		return process.env.DEBUG === 'true';
	}
}
