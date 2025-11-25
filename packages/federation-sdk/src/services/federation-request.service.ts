import type {
	FetchResponse,
	MultipartResult,
	SigningKey,
} from '@rocket.chat/federation-core';
import {
	authorizationHeaders,
	computeAndMergeHash,
} from '@rocket.chat/federation-core';
import { extractURIfromURL } from '@rocket.chat/federation-core';
import { EncryptionValidAlgorithm } from '@rocket.chat/federation-core';
import { createLogger } from '@rocket.chat/federation-core';
import { fetch } from '@rocket.chat/federation-core';
import { signJson } from '@rocket.chat/federation-crypto';
import { singleton } from 'tsyringe';
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

	// Implements SPEC: https://spec.matrix.org/v1.12/server-server-api/#request-authentication
	async makeSignedRequest<T>({
		method,
		domain,
		uri,
		body,
		queryString,
	}: SignedRequest): Promise<FetchResponse<T>> {
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

		// build the auth request
		const request = {
			method,
			uri: url.pathname + url.search,
			origin,
			destination: domain,
			...(body && { content: body }),
		};

		const requestSignature = await signJson(request, signer);

		const authorizationHeaderValue = `X-Matrix origin="${origin}",destination="${domain}",key="${signer.id}",sig="${requestSignature}"`;

		const headers = {
			Authorization: authorizationHeaderValue,
			...discoveryHeaders,
		};

		this.logger.debug(
			{
				method,
				body: body,
				headers,
				url: url.toString(),
			},
			'making http request',
		);

		const response = await fetch<T>(url, {
			method,
			...(body && { body: JSON.stringify(body) }),
			headers,
		});

		if (!response.ok) {
			const errorText = await response.text();

			this.logger.error({
				msg: 'Federation request failed',
				url,
				status: response.status,
				errorText,
				sentHeaders: headers,
				responseHeaders: response.headers,
			});

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

		return response;
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
