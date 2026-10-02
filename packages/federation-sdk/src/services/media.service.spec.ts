import { describe, expect, it, mock } from 'bun:test';

import { FEDERATION_REQUEST_TIMEOUT_MS } from '@rocket.chat/federation-core';
import type { FetchResponse } from '@rocket.chat/federation-core';

import type { ConfigService } from './config.service';
import { FederationRequestError } from './federation-request.service';
import type { FederationRequestService } from './federation-request.service';
import { MediaService, isUnknownEndpoint } from './media.service';

const buildService = (requestBinaryData: unknown) =>
	new MediaService({} as ConfigService, { requestBinaryData } as unknown as FederationRequestService);

const federationError = (status: number, body = '') => new FederationRequestError({ status } as FetchResponse<unknown>, body);

const unknownEndpoint = () => federationError(404, JSON.stringify({ errcode: 'M_UNRECOGNIZED' }));

describe('MediaService.downloadFromRemoteServer', () => {
	it('asks the origin to wait for an upload that is still being committed', async () => {
		const calls: { endpoint: string; queryParams?: Record<string, string> }[] = [];
		const requestBinaryData = mock(async (_method: string, _server: string, endpoint: string, queryParams?: Record<string, string>) => {
			calls.push({ endpoint, queryParams });
			throw unknownEndpoint();
		});

		await buildService(requestBinaryData)
			.downloadFromRemoteServer('remote.example', 'abc')
			.catch(() => undefined);

		expect(calls).toHaveLength(3);
		for (const call of calls) {
			// long enough for an upload to finish, short enough that the origin answers before we hang up
			expect(Number(call.queryParams?.timeout_ms)).toBeGreaterThan(0);
			expect(Number(call.queryParams?.timeout_ms)).toBeLessThan(FEDERATION_REQUEST_TIMEOUT_MS);
		}
	});

	it('does not let the origin fetch the file from a third server on our behalf', async () => {
		const calls: { endpoint: string; queryParams?: Record<string, string> }[] = [];
		const requestBinaryData = mock(async (_method: string, _server: string, endpoint: string, queryParams?: Record<string, string>) => {
			calls.push({ endpoint, queryParams });
			throw unknownEndpoint();
		});

		await buildService(requestBinaryData)
			.downloadFromRemoteServer('remote.example', 'abc')
			.catch(() => undefined);

		expect(calls[0]?.queryParams?.allow_remote).toBeUndefined();
		expect(calls[1]?.queryParams?.allow_remote).toBe('false');
		expect(calls[2]?.queryParams?.allow_remote).toBe('false');
	});

	it('stops at the first endpoint when the origin answers that the media is not uploaded yet', async () => {
		const requestBinaryData = mock(async () => {
			throw federationError(504, JSON.stringify({ errcode: 'M_NOT_YET_UPLOADED', error: 'Media has not been uploaded yet' }));
		});

		await expect(buildService(requestBinaryData).downloadFromRemoteServer('remote.example', 'abc')).rejects.toThrow(
			'Failed to download media abc from remote.example',
		);
		expect(requestBinaryData).toHaveBeenCalledTimes(1);
	});

	it('stops at the first endpoint when the origin does not have the media', async () => {
		const requestBinaryData = mock(async () => {
			throw federationError(404, JSON.stringify({ errcode: 'M_NOT_FOUND', error: 'Not found' }));
		});

		await buildService(requestBinaryData)
			.downloadFromRemoteServer('remote.example', 'abc')
			.catch(() => undefined);

		expect(requestBinaryData).toHaveBeenCalledTimes(1);
	});

	it('stops at the first endpoint when the origin could not be reached', async () => {
		const requestBinaryData = mock(async () => {
			throw new Error('Request timed out after 20000ms');
		});

		await buildService(requestBinaryData)
			.downloadFromRemoteServer('remote.example', 'abc')
			.catch(() => undefined);

		expect(requestBinaryData).toHaveBeenCalledTimes(1);
	});

	it('keeps the origin answer as the cause of the failure', async () => {
		const answer = federationError(504, JSON.stringify({ errcode: 'M_NOT_YET_UPLOADED' }));
		const requestBinaryData = mock(async () => {
			throw answer;
		});

		const failure = await buildService(requestBinaryData)
			.downloadFromRemoteServer('remote.example', 'abc')
			.catch((err: unknown) => err);

		expect((failure as Error).cause).toBe(answer);
	});

	it('moves on to the legacy endpoint when the federation one is not implemented', async () => {
		const content = Buffer.from('file-bytes');
		const endpoints: string[] = [];
		const requestBinaryData = mock(async (_method: string, _server: string, endpoint: string) => {
			endpoints.push(endpoint);
			if (endpoint.startsWith('/_matrix/federation/')) {
				throw unknownEndpoint();
			}
			return { content };
		});

		const result = await buildService(requestBinaryData).downloadFromRemoteServer('remote.example', 'abc');

		expect(result).toBe(content);
		expect(endpoints).toEqual(['/_matrix/federation/v1/media/download/abc', '/_matrix/media/v3/download/remote.example/abc']);
	});

	it('still returns the content from the first endpoint that answers', async () => {
		const content = Buffer.from('file-bytes');
		const requestBinaryData = mock(async () => ({ content }));

		const result = await buildService(requestBinaryData).downloadFromRemoteServer('remote.example', 'abc');

		expect(result).toBe(content);
		expect(requestBinaryData).toHaveBeenCalledTimes(1);
	});
});

describe('isUnknownEndpoint', () => {
	it('recognises the ways a server says it does not implement an endpoint', () => {
		expect(isUnknownEndpoint(federationError(404, JSON.stringify({ errcode: 'M_UNRECOGNIZED' })))).toBe(true);
		expect(isUnknownEndpoint(federationError(405, JSON.stringify({ errcode: 'M_UNRECOGNIZED' })))).toBe(true);
		expect(isUnknownEndpoint(federationError(404, ''))).toBe(true);
		expect(isUnknownEndpoint(federationError(404, '<html>Not Found</html>'))).toBe(true);
		expect(isUnknownEndpoint(federationError(400, JSON.stringify({ errcode: 'M_UNRECOGNIZED' })))).toBe(true);
	});

	it('treats every other answer as the origin speaking about the media', () => {
		expect(isUnknownEndpoint(federationError(404, JSON.stringify({ errcode: 'M_NOT_FOUND' })))).toBe(false);
		expect(isUnknownEndpoint(federationError(504, JSON.stringify({ errcode: 'M_NOT_YET_UPLOADED' })))).toBe(false);
		expect(isUnknownEndpoint(federationError(502, ''))).toBe(false);
		expect(isUnknownEndpoint(federationError(400, JSON.stringify({ errcode: 'M_BAD_JSON' })))).toBe(false);
		expect(isUnknownEndpoint(federationError(403, JSON.stringify({ errcode: 'M_FORBIDDEN' })))).toBe(false);
		expect(isUnknownEndpoint(new Error('socket hang up'))).toBe(false);
	});
});
