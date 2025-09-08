import type { SigningKey } from '@hs/core';
import { authorizationHeaders, computeAndMergeHash } from '@hs/core';
import { extractURIfromURL } from '@hs/core';
import { EncryptionValidAlgorithm } from '@hs/core';
import { createLogger } from '@hs/core';
import { fetch } from '@hs/core';
import { singleton } from 'tsyringe';
import * as nacl from 'tweetnacl';
import { getHomeserverFinalAddress } from '../server-discovery/discovery';
import { ConfigService } from './config.service';
import { signJson } from '@hs/crypto';

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

	// Implements SPEC: https://spec.matrix.org/v1.12/server-server-api/#request-authentication
	async makeSignedRequest<T>({
		method,
		domain,
		uri,
		body,
		queryString,
	}: SignedRequest): Promise<T> {
		const signer = await this.configService.getSigningKey();

		const [address, discoveryHeaders] = await getHomeserverFinalAddress(
			domain,
			this.logger,
		);

		const origin = this.configService.serverName;

		const url = new URL(`${address}${uri}`);
		if (queryString) {
			url.search = queryString;
		}

		/*
			{
				"method": "POST",
				"uri": "/target",
				"origin": "origin.hs.example.com",
				"destination": "destination.hs.example.com",
				"content": <JSON-parsed request body>,
				"signatures": {
					"origin.hs.example.com": {
						"ed25519:key1": "ABCDEF..."
					}
				}
			}
		*/
		// build the auth request
		const request = {
			method,
			uri: url.pathname + url.search,
			origin,
			destination: domain,
			...(body && { content: body }),
		};

		const requestSignature = await signJson(request, signer);

		// authorization_headers.append(bytes(
		//     "X-Matrix origin=\"%s\",destination=\"%s\",key=\"%s\",sig=\"%s\"" % (
		//         origin_name, destination_name, key, sig,
		//     )
		// ))
		const authorizationHeaderValue = `X-Matrix origin="${origin}",destination="${domain}",key="${signer.id}",sig="${requestSignature}"`;

		const headers = {
			Authorization: authorizationHeaderValue,
			...discoveryHeaders,
		};

		// TODO: make logging take a function for object to avoid unnecessary computation when log level is high
		this.logger.debug(
			{
				method,
				body: body,
				headers,
				url: url.toString(),
			},
			'making http request',
		);

		const response = await fetch(url, {
			method,
			...(body && { body: JSON.stringify(body) }),
			headers,
		});

		if (!response.ok) {
			const errorText = await response.text();
			let errorDetail = errorText;
			try {
				errorDetail = JSON.stringify(JSON.parse(errorText));
			} catch {
				/* use raw text if parsing fails */
			}
			throw new Error(
				`Federation request failed: ${response.status} ${errorDetail}`,
			);
		}

		return response.json();
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
