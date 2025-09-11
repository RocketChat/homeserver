import https from 'node:https';
import { createLogger } from '@hs/core';
import { singleton } from 'tsyringe';
import { FederationRequestService } from './federation-request.service';

@singleton()
export class MediaService {
	private readonly logger = createLogger('MediaService');

	constructor(private readonly federationRequest: FederationRequestService) {}

	async downloadFromRemoteServer(
		serverName: string,
		mediaId: string,
	): Promise<Buffer> {
		try {
			const buffer = await this.downloadWithAuth(serverName, mediaId);
			if (buffer) {
				this.logger.info(
					`Downloaded media ${mediaId} from ${serverName} via authenticated endpoint`,
				);
				return buffer;
			}
		} catch (error: any) {
			this.logger.debug(`Authenticated download failed: ${error.message}`);
		}

		return this.downloadLegacy(serverName, mediaId);
	}

	private async downloadWithAuth(
		serverName: string,
		mediaId: string,
	): Promise<Buffer | null> {
		const endpoint = `/_matrix/federation/v1/media/download/${mediaId}`;

		const { url, headers } = await this.federationRequest.prepareSignedRequest(
			serverName,
			endpoint,
			'GET',
		);

		const response = await this.httpsRequest(url, { method: 'GET', headers });
		if (!response || response.statusCode < 200 || response.statusCode >= 300) {
			return null;
		}

		return this.extractMediaFromResponse(response);
	}

	private httpsRequest(
		url: URL,
		options: { method: string; headers: Record<string, string> },
	): Promise<{
		statusCode: number;
		headers: Record<string, string | string[]>;
		body: Buffer;
	} | null> {
		return new Promise((resolve) => {
			const req = https.request(
				{
					hostname: url.hostname,
					port: url.port || 443,
					path: url.pathname + url.search,
					method: options.method,
					headers: options.headers,
				},
				(res) => {
					const chunks: Buffer[] = [];
					res.on('data', (chunk) => chunks.push(chunk));
					res.on('end', () => {
						resolve({
							statusCode: res.statusCode || 500,
							headers: res.headers as Record<string, string | string[]>,
							body: Buffer.concat(chunks),
						});
					});
				},
			);

			req.on('error', (error) => {
				this.logger.error(`HTTPS request failed: ${error.message}`);
				resolve(null);
			});

			req.end();
		});
	}

	private extractMediaFromResponse(response: {
		statusCode: number;
		headers: Record<string, string | string[]>;
		body: Buffer;
	}): Buffer {
		const contentType = Array.isArray(response.headers['content-type'])
			? response.headers['content-type'][0]
			: response.headers['content-type'];

		if (!contentType?.includes('multipart')) {
			return response.body;
		}

		const boundary = contentType.match(/boundary=([^;]+)/)?.[1];
		if (!boundary) {
			throw new Error('No boundary in multipart response');
		}

		return this.parseMultipart(response.body, boundary);
	}

	private parseMultipart(data: Buffer, boundary: string): Buffer {
		const boundaryBuffer = Buffer.from(`--${boundary}`);
		const headerEnd = Buffer.from('\r\n\r\n');

		let start = 0;
		while (start < data.length) {
			const boundaryIndex = data.indexOf(boundaryBuffer, start);
			if (boundaryIndex === -1) break;

			const partStart = boundaryIndex + boundaryBuffer.length;
			const nextBoundary = data.indexOf(boundaryBuffer, partStart);
			const partEnd = nextBoundary === -1 ? data.length : nextBoundary;

			const part = data.subarray(partStart, partEnd);
			const headerEndIndex = part.indexOf(headerEnd);

			if (headerEndIndex !== -1) {
				const headers = part.subarray(0, headerEndIndex).toString('utf-8');
				if (
					headers.includes('Content-Type:') &&
					!headers.includes('application/json')
				) {
					let content = part.subarray(headerEndIndex + headerEnd.length);
					while (
						content.length > 0 &&
						(content[content.length - 1] === 0x0a ||
							content[content.length - 1] === 0x0d)
					) {
						content = content.subarray(0, -1);
					}
					return content;
				}
			}

			start = partEnd;
		}

		throw new Error('No media content in multipart response');
	}

	private async downloadLegacy(
		serverName: string,
		mediaId: string,
	): Promise<Buffer> {
		const endpoints = [
			`https://${serverName}/_matrix/media/v3/download/${serverName}/${mediaId}`,
			`https://${serverName}/_matrix/media/r0/download/${serverName}/${mediaId}`,
		];

		for (const endpoint of endpoints) {
			try {
				const url = new URL(endpoint);
				const response = await this.httpsRequest(url, {
					method: 'GET',
					headers: {
						'User-Agent': 'Rocket.Chat Federation',
						Accept: '*/*',
					},
				});

				if (
					response &&
					response.statusCode >= 200 &&
					response.statusCode < 300
				) {
					this.logger.info(
						`Downloaded media ${mediaId} from ${serverName} via legacy endpoint`,
					);
					return response.body;
				}
			} catch (error: any) {
				this.logger.debug(`Legacy endpoint failed: ${error.message}`);
			}
		}

		throw new Error(`Failed to download media ${mediaId} from ${serverName}`);
	}
}
