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
	): Promise<Buffer | null> {
		const endpoints = [
			`/_matrix/federation/v1/media/download/${mediaId}`,
			`/_matrix/media/v3/download/${serverName}/${mediaId}`,
			`/_matrix/media/r0/download/${serverName}/${mediaId}`,
		];

		for (const endpoint of endpoints) {
			try {
				return this.federationRequest.requestBinaryData(
					'GET',
					serverName,
					endpoint,
				);
			} catch (err) {
				this.logger.debug(
					`Endpoint ${endpoint} failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}

		throw new Error(`Failed to download media ${mediaId} from ${serverName}`);
	}
}
