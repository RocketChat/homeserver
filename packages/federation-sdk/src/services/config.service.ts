import { createLogger } from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';

import {
	Signer,
	fromBase64ToBytes,
	loadEd25519SignerFromSeed,
} from '@rocket.chat/federation-crypto';
import { z } from 'zod';

export interface AppConfig {
	serverName: string;
	instanceId: string;
	port: number;
	version: string;
	matrixDomain: string;
	keyRefreshInterval: number;
	signingKey?: string;
	timeout?: number;
	// TODO: need this still?
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
	invite: {
		allowedEncryptedRooms: boolean;
		allowedNonPrivateRooms: boolean;
	};
	edu: {
		processTyping: boolean;
		processPresence: boolean;
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
	invite: z.object({
		allowedEncryptedRooms: z.boolean(),
		allowedNonPrivateRooms: z.boolean(),
	}),
	edu: z.object({
		processTyping: z.boolean(),
		processPresence: z.boolean(),
	}),
});

@singleton()
export class ConfigService {
	private config: AppConfig = {} as AppConfig;
	private logger = createLogger('ConfigService');

	private signer: Signer | undefined;

	setConfig(values: AppConfig) {
		try {
			if (process.env.NODE_ENV === 'test') {
				this.config = values;
				return;
			}
			this.config = AppConfigSchema.parse(values);
		} catch (error) {
			if (error instanceof z.ZodError) {
				this.logger.error({
					msg: 'Configuration validation failed:',
					err: error,
				});
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

	getConfig<K extends keyof AppConfig>(config: K): AppConfig[K] {
		return this.config[config];
	}

	async getSigningKey() {
		if (this.signer) {
			return this.signer;
		}

		// If config contains a signing key, use it
		if (!this.config.signingKey) {
			throw new Error('Signing key is not configured');
		}

		const [, version, signingKey] = this.config.signingKey.split(' ');

		this.signer = await loadEd25519SignerFromSeed(
			fromBase64ToBytes(signingKey),
			version,
		);

		return this.signer;
	}
}
