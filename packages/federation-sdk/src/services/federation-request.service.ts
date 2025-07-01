import type { SigningKey } from '@hs/homeserver/src/keys';
import * as nacl from 'tweetnacl';
import {
	authorizationHeaders,
	computeAndMergeHash,
} from '../../../homeserver/src/authentication';
import { extractURIfromURL } from '../../../homeserver/src/helpers/url';
import {
	EncryptionValidAlgorithm,
	signJson as oldSignJson,
	type SignedJson,
} from '../../../homeserver/src/signJson';
import { FederationConfigService } from './federation-config.service';
import { getHomeserverFinalAddress } from '../server-discovery/discovery';
import { injectable } from 'tsyringe';
import { createLogger } from '@hs/homeserver/src/utils/logger';
import { signJson } from '@hs/crypto';

interface SignedRequest {
	method: string;
	domain: string;
	uri: string;
	body?: Record<string, unknown>;
	queryString?: string;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

@injectable()
export class FederationRequestService {
	private readonly logger = createLogger('FederationRequestService');

	constructor(private readonly configService: FederationConfigService) {}

	async makeSignedRequest<T>({
		method,
		domain,
		uri,
		body,
		queryString,
	}: SignedRequest): Promise<T> {
		try {
			// const serverName = this.configService.serverName;
			const serverName = 'rc1.tunnel.dev.rocket.chat';
			const signingKeyBase64 = this.configService.signingKey;
			const signingKeyId = this.configService.signingKeyId;
			const privateKeyBytes = Buffer.from(signingKeyBase64, 'base64');
			const keyPair = nacl.sign.keyPair.fromSecretKey(privateKeyBytes);

			const signingKey: SigningKey = {
				algorithm: EncryptionValidAlgorithm.ed25519,
				version: signingKeyId.split(':')[1] || '1',
				privateKey: keyPair.secretKey,
				publicKey: keyPair.publicKey,
				sign: async (data: Uint8Array) =>
					nacl.sign.detached(data, keyPair.secretKey),
			};

			const [address, discoveryHeaders] =
				await getHomeserverFinalAddress(domain);

			const url = new URL(`${address}${uri}`);
			if (queryString) {
				url.search = queryString;
			}

			this.logger.debug(`Making ${method} request to ${url.toString()}`);

			const toSign = {
				method,
				uri,
				origin: serverName,
				destination: domain,
				content: body,
			};

			// const seed = 'zSkmr713LnEDbxlkYq2ZqIiKTQNsyMOU0T2CEeC44C4';
			const seed = 'Co0WE8ivl2rPGY/dWzmiLPP/sDE0EfnXhaZF7/5K4Y8';

			let signedBody: Record<string, unknown> | undefined;
			if (body) {
				const signature = await signJson(toSign, seed);
				signedBody = {
					...body,
					signatures: {
						[serverName]: {
							[signingKeyId]: signature,
						},
					},
				};
			}

			const auth = await authorizationHeaders(
				serverName,
				signingKey,
				domain,
				method,
				extractURIfromURL(url),
				signedBody,
			);

			const response = await fetch(url.toString(), {
				method,
				...(signedBody && { body: JSON.stringify(signedBody) }),
				headers: {
					Authorization: auth,
					...discoveryHeaders,
				},
			});

			if (!response.ok) {
				const errorText = await response.text();
				let errorDetail = errorText;
				try {
					errorDetail = JSON.stringify(JSON.parse(errorText));
				} catch (e) {
					/* use raw text if parsing fails */
				}
				throw new Error(
					`Federation request failed: ${response.status} ${errorDetail}`,
				);
			}

			return response.json();
		} catch (error: any) {
			this.logger.error(
				`Federation request failed: ${error.message}`,
				error.stack,
			);
			throw error;
		}
	}

	async request<T>(
		method: HttpMethod,
		targetServer: string,
		endpoint: string,
		body?: Record<string, unknown>,
		queryParams?: Record<string, string>,
	): Promise<T> {
		let queryString = '';

		if (queryParams) {
			const params = new URLSearchParams();
			for (const [key, value] of Object.entries(queryParams)) {
				params.append(key, value);
			}
			queryString = params.toString();
		}

		return this.makeSignedRequest<T>({
			method,
			domain: targetServer,
			uri: endpoint,
			body,
			queryString,
		});
	}

	async get<T>(
		targetServer: string,
		endpoint: string,
		queryParams?: Record<string, string>,
	): Promise<T> {
		return this.request<T>(
			'GET',
			targetServer,
			endpoint,
			undefined,
			queryParams,
		);
	}

	async put<T>(
		targetServer: string,
		endpoint: string,
		body: Record<string, unknown>,
		queryParams?: Record<string, string>,
	): Promise<T> {
		return this.request<T>('PUT', targetServer, endpoint, body, queryParams);
	}

	async post<T>(
		targetServer: string,
		endpoint: string,
		body: Record<string, unknown>,
		queryParams?: Record<string, string>,
	): Promise<T> {
		return this.request<T>('POST', targetServer, endpoint, body, queryParams);
	}
}
