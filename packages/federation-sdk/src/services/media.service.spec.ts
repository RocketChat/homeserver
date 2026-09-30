import { describe, expect, it, mock, spyOn } from 'bun:test';

import { FEDERATION_REQUEST_TIMEOUT_MS } from '@rocket.chat/federation-core';

import type { ConfigService } from './config.service';
import type { FederationRequestService } from './federation-request.service';
import { MediaService, resolveDownloadTimeoutMs } from './media.service';

const buildService = (requestBinaryData: unknown) =>
	new MediaService({} as ConfigService, { requestBinaryData } as unknown as FederationRequestService);

describe('MediaService.downloadFromRemoteServer', () => {
	it('asks the origin to wait for an upload that is still being committed', async () => {
		const calls: { endpoint: string; queryParams?: Record<string, string> }[] = [];
		const requestBinaryData = mock(async (_method: string, _server: string, endpoint: string, queryParams?: Record<string, string>) => {
			calls.push({ endpoint, queryParams });
			throw new Error('not found');
		});

		await buildService(requestBinaryData)
			.downloadFromRemoteServer('remote.example', 'abc')
			.catch(() => undefined);

		expect(calls).toHaveLength(3);
		for (const call of calls) {
			expect(call.queryParams?.timeout_ms).toBe('18000');
		}
	});

	it('does not let the origin fetch the file from a third server on our behalf', async () => {
		const calls: { endpoint: string; queryParams?: Record<string, string> }[] = [];
		const requestBinaryData = mock(async (_method: string, _server: string, endpoint: string, queryParams?: Record<string, string>) => {
			calls.push({ endpoint, queryParams });
			throw new Error('not found');
		});

		await buildService(requestBinaryData)
			.downloadFromRemoteServer('remote.example', 'abc')
			.catch(() => undefined);

		expect(calls[0]?.queryParams?.allow_remote).toBeUndefined();
		expect(calls[1]?.queryParams?.allow_remote).toBe('false');
		expect(calls[2]?.queryParams?.allow_remote).toBe('false');
	});

	it('falls back to the default when the configured timeout is malformed', async () => {
		const previous = process.env.FEDERATION_MEDIA_DOWNLOAD_TIMEOUT_MS;
		process.env.FEDERATION_MEDIA_DOWNLOAD_TIMEOUT_MS = '20s';

		try {
			const calls: (Record<string, string> | undefined)[] = [];
			const requestBinaryData = mock(async (_method: string, _server: string, _endpoint: string, queryParams?: Record<string, string>) => {
				calls.push(queryParams);
				throw new Error('not found');
			});

			await buildService(requestBinaryData)
				.downloadFromRemoteServer('remote.example', 'abc')
				.catch(() => undefined);

			expect(calls[0]?.timeout_ms).toBe('18000');
		} finally {
			if (previous === undefined) {
				delete process.env.FEDERATION_MEDIA_DOWNLOAD_TIMEOUT_MS;
			} else {
				process.env.FEDERATION_MEDIA_DOWNLOAD_TIMEOUT_MS = previous;
			}
		}
	});

	it('honours a valid configured timeout that is under the transport limit', async () => {
		const previous = process.env.FEDERATION_MEDIA_DOWNLOAD_TIMEOUT_MS;
		process.env.FEDERATION_MEDIA_DOWNLOAD_TIMEOUT_MS = '9000';

		try {
			const calls: (Record<string, string> | undefined)[] = [];
			const requestBinaryData = mock(async (_method: string, _server: string, _endpoint: string, queryParams?: Record<string, string>) => {
				calls.push(queryParams);
				throw new Error('not found');
			});

			await buildService(requestBinaryData)
				.downloadFromRemoteServer('remote.example', 'abc')
				.catch(() => undefined);

			expect(calls[0]?.timeout_ms).toBe('9000');
		} finally {
			if (previous === undefined) {
				delete process.env.FEDERATION_MEDIA_DOWNLOAD_TIMEOUT_MS;
			} else {
				process.env.FEDERATION_MEDIA_DOWNLOAD_TIMEOUT_MS = previous;
			}
		}
	});

	const countTimeoutWarnings = async (raw: string) => {
		const previous = process.env.FEDERATION_MEDIA_DOWNLOAD_TIMEOUT_MS;
		process.env.FEDERATION_MEDIA_DOWNLOAD_TIMEOUT_MS = raw;

		try {
			const service = buildService(
				mock(async () => {
					throw new Error('not found');
				}),
			);
			const { logger } = service as unknown as { logger: { warn: (...args: unknown[]) => void } };
			const warn = spyOn(logger, 'warn').mockImplementation(() => undefined);

			await service.downloadFromRemoteServer('remote.example', 'abc').catch(() => undefined);
			await service.downloadFromRemoteServer('remote.example', 'abc').catch(() => undefined);

			return warn.mock.calls.length;
		} finally {
			if (previous === undefined) {
				delete process.env.FEDERATION_MEDIA_DOWNLOAD_TIMEOUT_MS;
			} else {
				process.env.FEDERATION_MEDIA_DOWNLOAD_TIMEOUT_MS = previous;
			}
		}
	};

	it('warns once when the configured timeout is capped', async () => {
		expect(await countTimeoutWarnings('60000')).toBe(1);
	});

	it('does not warn when the configured timeout fits', async () => {
		expect(await countTimeoutWarnings('9000')).toBe(0);
	});

	it('still returns the content from the first endpoint that answers', async () => {
		const content = Buffer.from('file-bytes');
		const requestBinaryData = mock(async () => ({ content }));

		const result = await buildService(requestBinaryData).downloadFromRemoteServer('remote.example', 'abc');

		expect(result).toBe(content);
		expect(requestBinaryData).toHaveBeenCalledTimes(1);
	});
});

describe('resolveDownloadTimeoutMs', () => {
	it('defaults to the longest wait the transport can actually honour', () => {
		expect(resolveDownloadTimeoutMs(undefined)).toBe(18_000);
		expect(resolveDownloadTimeoutMs('')).toBe(18_000);
		expect(resolveDownloadTimeoutMs('   ')).toBe(18_000);
	});

	// Asking for longer than the transport allows would promise the origin a wait we hang up on.
	it('never advertises a longer wait than the transport allows', () => {
		expect(resolveDownloadTimeoutMs('120000')).toBe(18_000);
		expect(resolveDownloadTimeoutMs('60000')).toBe(18_000);
		expect(resolveDownloadTimeoutMs(String(FEDERATION_REQUEST_TIMEOUT_MS))).toBeLessThan(FEDERATION_REQUEST_TIMEOUT_MS);
	});

	it('accepts a valid override below the limit', () => {
		expect(resolveDownloadTimeoutMs('5000')).toBe(5_000);
		expect(resolveDownloadTimeoutMs('0')).toBe(0);
	});

	it('rejects a malformed override rather than sending a nonsense timeout', () => {
		for (const raw of ['20s', '1.5', '-1', 'abc', 'Infinity']) {
			expect(() => resolveDownloadTimeoutMs(raw)).toThrow('Invalid FEDERATION_MEDIA_DOWNLOAD_TIMEOUT_MS value');
		}
	});
});
