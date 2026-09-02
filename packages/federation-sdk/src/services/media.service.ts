import { createLogger } from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';

import { ConfigService } from './config.service';
import { FederationRequestService } from './federation-request.service';

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 20_000;
const MAX_DOWNLOAD_TIMEOUT_MS = 60_000;

export function resolveDownloadTimeoutMs(raw: string | undefined): number {
	if (!raw?.trim()) {
		return DEFAULT_DOWNLOAD_TIMEOUT_MS;
	}

	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error('Invalid FEDERATION_MEDIA_DOWNLOAD_TIMEOUT_MS value');
	}

	return Math.min(value, MAX_DOWNLOAD_TIMEOUT_MS);
}

@singleton()
export class MediaService {
	private readonly logger = createLogger('MediaService');

	private downloadTimeoutMs?: number;

	constructor(private readonly configService: ConfigService, private readonly federationRequest: FederationRequestService) {}

	private get timeoutMs(): number {
		if (this.downloadTimeoutMs === undefined) {
			try {
				this.downloadTimeoutMs = resolveDownloadTimeoutMs(process.env.FEDERATION_MEDIA_DOWNLOAD_TIMEOUT_MS);
			} catch (err) {
				this.downloadTimeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS;
				this.logger.warn({
					msg: 'Ignoring invalid FEDERATION_MEDIA_DOWNLOAD_TIMEOUT_MS, using the default',
					value: process.env.FEDERATION_MEDIA_DOWNLOAD_TIMEOUT_MS,
					defaultMs: DEFAULT_DOWNLOAD_TIMEOUT_MS,
					err,
				});
			}
		}

		return this.downloadTimeoutMs;
	}

	async downloadFromRemoteServer(serverName: string, mediaId: string): Promise<Buffer | null> {
		const timeoutMs = String(this.timeoutMs);

		const endpoints: { path: string; queryParams: Record<string, string> }[] = [
			{
				path: `/_matrix/federation/v1/media/download/${mediaId}`,
				queryParams: { timeout_ms: timeoutMs },
			},
			{
				path: `/_matrix/media/v3/download/${serverName}/${mediaId}`,
				queryParams: { allow_remote: 'false', timeout_ms: timeoutMs },
			},
			{
				path: `/_matrix/media/r0/download/${serverName}/${mediaId}`,
				queryParams: { allow_remote: 'false', timeout_ms: timeoutMs },
			},
		];

		for await (const { path: endpoint, queryParams } of endpoints) {
			try {
				// TODO: Stream remote file downloads instead of buffering the entire file in memory.
				const response = await this.federationRequest.requestBinaryData('GET', serverName, endpoint, queryParams);

				return response.content;
			} catch (err) {
				this.logger.debug(`Endpoint ${endpoint} failed: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		throw new Error(`Failed to download media ${mediaId} from ${serverName}`);
	}
}
