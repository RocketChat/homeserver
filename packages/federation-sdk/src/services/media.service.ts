import { createLogger } from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';
import { traced, tracedClass } from '../utils/tracing';
import { ConfigService } from './config.service';
import { FederationRequestService } from './federation-request.service';

@tracedClass({ type: 'service', className: 'MediaService' })
@singleton()
export class MediaService {
	private readonly logger = createLogger('MediaService');

	constructor(
		private readonly configService: ConfigService,
		private readonly federationRequest: FederationRequestService,
	) {}

	@traced((serverName: string, mediaId: string) => ({
		serverName,
		mediaId,
	}))
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
				// TODO: Stream remote file downloads instead of buffering the entire file in memory.
				const response = await this.federationRequest.requestBinaryData(
					'GET',
					serverName,
					endpoint,
				);

				return response.content;
			} catch (err) {
				this.logger.debug(
					`Endpoint ${endpoint} failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}

		throw new Error(`Failed to download media ${mediaId} from ${serverName}`);
	}
}
