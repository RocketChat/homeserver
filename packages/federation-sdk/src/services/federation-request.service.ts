import type {
	FetchResponse,
	SigningKey,
	MultipartResult,
} from '@rocket.chat/federation-core';
import {
	EncryptionValidAlgorithm,
	authorizationHeaders,
	computeAndMergeHash,
	createLogger,
	extractURIfromURL,
	fetch,
	signJson,
} from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';
import * as nacl from 'tweetnacl';
import { getHomeserverFinalAddress } from '../server-discovery/discovery';
import { ConfigService } from './config.service';

interface SignedRequest {
	method: string;
	domain: string;
	uri: string;
	body?: Record<string, unknown>;
	queryString?: string;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

@singleton()
export class FederationRequestService {
	private readonly logger = createLogger('FederationRequestService');

	constructor(private readonly configService: ConfigService) {}

	async makeSignedRequest<T>({
		method,
		domain,
		uri,
		body,
		queryString,
	}: SignedRequest): Promise<FetchResponse<T>> {
		try {
			const serverName = this.configService.serverName;
			const signingKeyBase64 = await this.configService.getSigningKeyBase64();
			const signingKeyId = await this.configService.getSigningKeyId();
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

			const [address, discoveryHeaders] = await getHomeserverFinalAddress(
				domain,
				this.logger,
			);

			const url = new URL(`${address}${uri}`);
			if (queryString) {
				url.search = queryString;
			}

			this.logger.debug(`Making ${method} request to ${url.toString()}`);

			let signedBody: Record<string, unknown> | undefined;
			if (body) {
				signedBody = await signJson(
					body.hashes ? body : computeAndMergeHash({ ...body, signatures: {} }),
					signingKey,
					serverName,
				);
			}

			const auth = await authorizationHeaders(
				serverName,
				signingKey,
				domain,
				method,
				extractURIfromURL(url),
				signedBody,
			);

			const headers = {
				Authorization: auth,
				...discoveryHeaders,
				...(signedBody && { 'Content-Type': 'application/json' }),
			};

			const response = await fetch<T>(url, {
				method,
				...(signedBody && { body: JSON.stringify(signedBody) }),
				headers,
			});

			if (!response.ok) {
				const errorText = await response.text();
				let errorDetail = errorText;
				try {
					errorDetail = JSON.stringify(JSON.parse(errorText || ''));
				} catch {
					/* use raw text if parsing fails */
				}
				throw new Error(
					`Federation request failed: ${response.status} ${errorDetail}`,
				);
			}

			return response;
		} catch (err) {
			this.logger.error(
				`Federation request failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			throw err;
		}
	}

	async request<T>(
		method: HttpMethod,
		targetServer: string,
		endpoint: string,
		body?: Record<string, unknown>,
		queryParams?: Record<string, string | string[]>,
	) {
		let queryString = '';

		if (queryParams) {
			const params = new URLSearchParams();
			for (const [key, value] of Object.entries(queryParams)) {
				if (Array.isArray(value)) {
					for (const v of value) {
						params.append(key, v);
					}
					continue;
				}
				params.append(key, value);
			}
			queryString = params.toString();
		}

		return (
			await this.makeSignedRequest<T>({
				method,
				domain: targetServer,
				uri: endpoint,
				body,
				queryString,
			})
		).json();
	}

	async get<T>(
		targetServer: string,
		endpoint: string,
		queryParams?: Record<string, string | string[]>,
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

	async requestBinaryData(
		method: string,
		targetServer: string,
		endpoint: string,
		queryParams?: Record<string, string>,
	): Promise<MultipartResult> {
		const response = await this.makeSignedRequest({
			method,
			domain: targetServer,
			uri: endpoint,
			queryString: queryParams
				? new URLSearchParams(queryParams).toString()
				: '',
		});

		return response.multipart();
	}
}
