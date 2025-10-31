import {
	SigningKey,
	createLogger,
	generateKeyPairsFromString,
	toUnpaddedBase64,
} from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';

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
	signingKeyPath?: string;
	// database: {
	// 	uri: string;
	// 	name: string;
	// 	poolSize: number;
	// };
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
	// database: z.object({
	// 	uri: z.string().min(1, 'Database URI is required'),
	// 	name: z.string().min(1, 'Database name is required'),
	// 	poolSize: z.number().int().min(1, 'Pool size must be at least 1'),
	// }),
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
});

@singleton()
export class ConfigService {
	private config: AppConfig = {} as AppConfig;
	private logger = createLogger('ConfigService');
	private serverKeys: SigningKey[] = [];

	setConfig(values: AppConfig) {
		try {
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

	// getDatabaseConfig(): AppConfig['database'] {
	// 	return this.config.database;
	// }

	getMediaConfig(): AppConfig['media'] {
		return this.config.media;
	}

	getInviteConfig(): AppConfig['invite'] {
		return this.config.invite;
	}

	async getSigningKey() {
		// If config contains a signing key, use it
		if (!this.config.signingKey) {
			throw new Error('Signing key is not configured');
		}

		if (!this.serverKeys.length) {
			const signingKey = await generateKeyPairsFromString(
				this.config.signingKey,
			);
			this.serverKeys = [signingKey];
		}

		return this.serverKeys;
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

	async getPublicSigningKeyBase64(): Promise<string> {
		const signingKeys = await this.getSigningKey();
		return toUnpaddedBase64(signingKeys[0].publicKey);
	}
}
