import { FEDERATION_REQUEST_TIMEOUT_MS, createLogger } from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';

import { ConfigService } from './config.service';
import { FederationRequestError, FederationRequestService } from './federation-request.service';

const TRANSPORT_HEADROOM_MS = 2_000;
// the origin has to answer before our transport gives up on the request
const DOWNLOAD_TIMEOUT_MS = FEDERATION_REQUEST_TIMEOUT_MS - TRANSPORT_HEADROOM_MS;

// Matrix v1.6 answers an unknown endpoint with 404/405 M_UNRECOGNIZED; older servers send a
// non-JSON or errcode-less 404, and older Synapse a 400 M_UNRECOGNIZED. Anything else is the
// origin's real answer about this media (e.g. 504 M_NOT_YET_UPLOADED), which the next endpoint
// would only repeat after waiting out timeout_ms again.
export function isUnknownEndpoint(err: unknown): boolean {
	if (!(err instanceof FederationRequestError)) {
		return false;
	}

	const { status } = err.response;
	if (status === 404 || status === 405) {
		return err.errcode === undefined || err.errcode === 'M_UNRECOGNIZED';
	}

	return status === 400 && err.errcode === 'M_UNRECOGNIZED';
}

@singleton()
export class MediaService {
	private readonly logger = createLogger('MediaService');

	constructor(private readonly configService: ConfigService, private readonly federationRequest: FederationRequestService) {}

	async downloadFromRemoteServer(serverName: string, mediaId: string): Promise<Buffer | null> {
		const timeoutMs = String(DOWNLOAD_TIMEOUT_MS);

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
				if (!isUnknownEndpoint(err)) {
					throw new Error(`Failed to download media ${mediaId} from ${serverName}`, { cause: err });
				}
			}
		}

		throw new Error(`Failed to download media ${mediaId} from ${serverName}`);
	}
}
