import { createLogger } from '@hs/core';
import { type Signer } from '@hs/crypto';

import { z } from 'zod';
import { loadEd25519SignerFromSeed } from '../../../crypto/dist/utils/keys';
import { fromBase64ToBytes } from '../../../crypto/dist/utils/data-types';

export interface AppConfig {
	serverName: string;
	instanceId: string;
	port: number;
	version: string;
	matrixDomain: string;
	keyRefreshInterval: number;
	signingKey?: string;
	timeout?: number;
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
	instanceId: z.string().min(1, 'Instance id is required'),
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

	private signer: Signer | undefined;

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

	get instanceId(): string {
		return this.config.instanceId;
	}

	getDatabaseConfig(): AppConfig['database'] {
		return this.config.database;
	}

	getMediaConfig(): AppConfig['media'] {
		return this.config.media;
	}

	async getSigningKey() {
		if (this.signer) {
			return this.signer;
		}

		// If config contains a signing key, use it
		if (this.config.signingKey) {
			const [algorithm, version, seed] = this.config.signingKey
				.trim()
				.split(' ');

			if (!algorithm || !version || !seed) {
				throw new Error('Invalid signing key format in configuration');
			}

			const signer = await loadEd25519SignerFromSeed(fromBase64ToBytes(seed));

			this.signer = signer;
		} else {
			// let's generate
			const signer = await loadEd25519SignerFromSeed(); // randomly generated seed

			this.signer = signer;
		}

		return this.signer;
	}

	async getSigningKeyId(): Promise<string> {
		if (this.signer) {
			return this.signer.id;
		}

		const signer = await this.getSigningKey();

		return signer.id;
	}
}
