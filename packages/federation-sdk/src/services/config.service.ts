import {
	createLogger,
	generateKeyPairsFromString,
	getKeyPair,
	toUnpaddedBase64,
} from '@hs/core';

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
	database: {
		uri: string;
		name: string;
		poolSize: number;
	};
	media: {
		maxFileSize: number;
		allowedMimeTypes: string[];
		enableThumbnails: boolean;
		rateLimits: {
			uploadPerMinute: number;
			downloadPerMinute: number;
		};
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
	media: z.object({
		maxFileSize: z
			.number()
			.int()
			.min(1, 'Max file size must be at least 1 byte'),
		allowedMimeTypes: z.array(z.string()),
		enableThumbnails: z.boolean(),
		rateLimits: z.object({
			uploadPerMinute: z
				.number()
				.int()
				.min(1, 'Upload rate limit must be at least 1'),
			downloadPerMinute: z
				.number()
				.int()
				.min(1, 'Download rate limit must be at least 1'),
		}),
	}),
});

export class ConfigService {
	private config: AppConfig;
	private logger = createLogger('ConfigService');

	constructor(values: AppConfig) {
		try {
			this.config = AppConfigSchema.parse(values);
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

	get serverName(): string {
		return this.config.serverName;
	}

	get version(): string {
		return this.config.version;
	}

	getDatabaseConfig(): AppConfig['database'] {
		return this.config.database;
	}

	getMediaConfig(): AppConfig['media'] {
		return this.config.media;
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
}
