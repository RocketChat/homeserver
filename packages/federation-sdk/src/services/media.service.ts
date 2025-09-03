import crypto from 'node:crypto';
import { createLogger } from '@hs/core';
import { inject, singleton } from 'tsyringe';
import type { ConfigService } from './config.service';
import { EventEmitterService } from './event-emitter.service';

@singleton()
export class MediaService {
	private readonly logger = createLogger('MediaService');

	constructor(
		@inject('ConfigService') private readonly configService: ConfigService,
		@inject('EventEmitterService')
		private readonly eventEmitterService: EventEmitterService,
	) {}

	generateMXCUri(mediaId?: string): string {
		const serverName = this.configService.serverName;
		const id = mediaId || crypto.randomBytes(16).toString('hex');
		return `mxc://${serverName}/${id}`;
	}

	parseMXCUri(mxcUri: string): { serverName: string; mediaId: string } | null {
		const match = mxcUri.match(/^mxc:\/\/([^/]+)\/(.+)$/);
		if (!match) {
			this.logger.error('Invalid MXC URI format', { mxcUri });
			return null;
		}
		return {
			serverName: match[1],
			mediaId: match[2],
		};
	}

	extractUserFromToken(authHeader: string | null): {
		userId: string;
		isAuthenticated: boolean;
	} {
		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return { userId: 'anonymous', isAuthenticated: false };
		}

		const token = authHeader.substring(7);
		if (!token || token.length < 10) {
			return { userId: 'anonymous', isAuthenticated: false };
		}

		try {
			const decoded = Buffer.from(token, 'base64').toString('utf-8');
			let userId: string;

			if (decoded.includes(':')) {
				userId = `@${decoded}`;
			} else {
				userId = `@${decoded}:${this.configService.serverName}`;
			}

			if (userId.match(/^@[^:]+:[^:]+$/)) {
				return { userId, isAuthenticated: true };
			}
		} catch {}

		return { userId: 'anonymous', isAuthenticated: false };
	}

	async downloadFile(
		serverName: string,
		mediaId: string,
		authHeader: string | null,
	): Promise<Response | { errcode: string; error: string }> {
		const { userId, isAuthenticated } = this.extractUserFromToken(authHeader);
		const ourServerName = this.configService.serverName;

		this.logger.info('Media download request', {
			serverName,
			mediaId,
			userId,
			isAuthenticated,
		});

		if (serverName === ourServerName && !isAuthenticated) {
			return {
				errcode: 'M_MISSING_TOKEN',
				error: 'Authentication required for local media access',
			};
		}

		if (serverName === ourServerName) {
			return {
				errcode: 'M_UNRECOGNIZED',
				error: 'Local file download not yet implemented',
			};
		}

		return this.proxyRemoteMedia(serverName, mediaId);
	}

	private async proxyRemoteMedia(
		serverName: string,
		mediaId: string,
	): Promise<Response | { errcode: string; error: string }> {
		this.logger.info('Proxying to remote Matrix server', {
			serverName,
			mediaId,
		});

		try {
			const remoteUrl = `https://${serverName}/_matrix/media/v3/download/${serverName}/${mediaId}`;

			const response = await fetch(remoteUrl, {
				method: 'GET',
				headers: {
					'User-Agent': `RocketChat-Matrix-Bridge/${this.configService.version}`,
				},
				signal: AbortSignal.timeout(30000),
			});

			if (!response.ok) {
				this.logger.warn('Remote media fetch failed', {
					serverName,
					mediaId,
					status: response.status,
				});

				return {
					errcode: 'M_NOT_FOUND',
					error: 'Remote media not found',
				};
			}

			const contentType =
				response.headers.get('content-type') || 'application/octet-stream';
			const contentDisposition =
				response.headers.get('content-disposition') ||
				`attachment; filename="${mediaId}"`;
			const arrayBuffer = await response.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);

			this.logger.info('Successfully proxied remote media', {
				serverName,
				mediaId,
				contentType,
				size: buffer.length,
			});

			return new Response(buffer, {
				headers: {
					'content-type': contentType,
					'content-disposition': contentDisposition,
					'cache-control': 'public, max-age=31536000',
				},
			});
		} catch (error) {
			this.logger.error('Error proxying remote media:', error);
			return {
				errcode: 'M_UNKNOWN',
				error: 'Failed to fetch remote media',
			};
		}
	}

	async getThumbnail(
		serverName: string,
		mediaId: string,
		width = 96,
		height = 96,
		method: 'crop' | 'scale' = 'scale',
	): Promise<{ errcode: string; error: string }> {
		this.logger.info('Thumbnail request', {
			serverName,
			mediaId,
			width,
			height,
			method,
		});

		const mediaConfig = this.configService.getMediaConfig();
		if (!mediaConfig.enableThumbnails) {
			return {
				errcode: 'M_NOT_FOUND',
				error: 'Thumbnails are disabled',
			};
		}

		const ourServerName = this.configService.serverName;
		if (serverName === ourServerName) {
			return {
				errcode: 'M_UNRECOGNIZED',
				error: 'Thumbnail generation not yet implemented',
			};
		}

		return {
			errcode: 'M_NOT_FOUND',
			error: 'Media not found',
		};
	}

	getMediaConfig(): { 'm.upload.size': number } {
		const mediaConfig = this.configService.getMediaConfig();
		return {
			'm.upload.size': mediaConfig.maxFileSize,
		};
	}
}
