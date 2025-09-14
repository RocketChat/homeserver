import { type OutgoingHttpHeaders } from 'node:http';
import https from 'node:https';

type RequestOptions = Parameters<typeof https.request>[1];

export type MultipartResult = {
	content: Buffer;
	headers?: Record<string, string>;
	redirect?: string;
};

/**
 * parses Matrix federation multipart/mixed media responses according to spec.
 * https://spec.matrix.org/v1.15/server-server-api/#get_matrixfederationv1mediadownloadmediaid
 */
function parseMultipart(buffer: Buffer, boundary: string): MultipartResult {
	const bufferStr = buffer.toString();

	// check if the second part contains a Location header (CDN redirect)
	// pattern: after first boundary and JSON part, look for Location header
	const parts = bufferStr.split(`--${boundary}`);
	if (parts.length >= 3) {
		const secondPart = parts[2];
		const locationMatch = secondPart.match(/\r?\nLocation:\s*(.+)\r?\n/i);

		if (locationMatch) {
			return {
				content: Buffer.from(''),
				redirect: locationMatch[1].trim(),
			};
		}
	}

	// find where the last part's content starts (after the last \r\n\r\n)
	const lastHeaderEnd = buffer.lastIndexOf('\r\n\r\n');
	if (lastHeaderEnd === -1) return { content: buffer };

	const binaryStart = lastHeaderEnd + 4;
	const closingBoundary = buffer.lastIndexOf(`\r\n--${boundary}`);

	const content =
		closingBoundary > binaryStart
			? buffer.subarray(binaryStart, closingBoundary)
			: buffer.subarray(binaryStart);

	return { content };
}

function handleJson<T>(contentType: string, body: Buffer): Promise<T | null> {
	if (!contentType.includes('application/json')) {
		return Promise.resolve(null);
	}

	try {
		return Promise.resolve(JSON.parse(body.toString()));
	} catch {
		return Promise.resolve(null);
	}
}

function handleText(contentType: string, body: Buffer): Promise<string> {
	if (!contentType.includes('text/')) {
		return Promise.resolve('');
	}

	return Promise.resolve(body.toString());
}

function handleMultipart(
	contentType: string,
	body: Buffer,
): Promise<MultipartResult | null> {
	if (!contentType.includes('multipart')) {
		return Promise.resolve(null);
	}

	// extract boundary from content-type header
	const boundaryMatch = contentType.match(/boundary=([^;,\s]+)/);
	if (!boundaryMatch) {
		return Promise.resolve(null);
	}

	// remove quotes if present
	const boundary = boundaryMatch[1].replace(/^["']|["']$/g, '');
	return Promise.resolve(parseMultipart(body, boundary));
}

// this fetch is used when connecting to a multihome server, same server hosting multiple homeservers, and we need to verify the cert with the right SNI (hostname), or else, cert check will fail due to connecting through ip and not hostname (due to matrix spec).
export async function fetch<T>(url: URL, options: RequestInit) {
	const serverName = new URL(
		`http://${(options.headers as OutgoingHttpHeaders).Host}` as string,
	).hostname;

	const requestParams: RequestOptions = {
		host: url.hostname, // IP
		port: url.port,
		method: options.method,
		path: url.pathname + url.search,
		headers: options.headers as OutgoingHttpHeaders,
		servername: serverName,
	};

	try {
		const response: {
			statusCode: number | undefined;
			body: Buffer;
			headers: OutgoingHttpHeaders;
		} = await new Promise((resolve, reject) => {
			const request = https.request(requestParams, (res) => {
				const chunks: Buffer[] = [];

				res.once('error', reject);

				// TODO: Make @hs/core fetch size limit configurable
				let total = 0;
				const MAX_RESPONSE_BYTES = 50 * 1024 * 1024; // 50 MB

				res.on('data', (chunk) => {
					total += chunk.length;
					if (total > MAX_RESPONSE_BYTES) {
						request.destroy(new Error('Response exceeds size limit'));
						return;
					}
					chunks.push(chunk);
				});

				res.on('end', () => {
					resolve({
						statusCode: res.statusCode,
						body: Buffer.concat(chunks),
						headers: res.headers,
					});
				});
			});

			const signal = options.signal;
			if (signal) {
				const onAbort = () => request.destroy(new Error('Aborted'));
				signal.addEventListener('abort', onAbort, { once: true });
				request.once('close', () =>
					signal.removeEventListener('abort', onAbort),
				);
			}

			request.on('error', (err) => {
				reject(err);
			});

			// TODO: Make @hs/core fetch timeout configurable
			request.setTimeout(20_000, () => {
				request.destroy(new Error('Request timed out after 20s'));
			});

			request.end(options.body);
		});

		const contentType = response.headers['content-type'] || '';

		return {
			ok: response.statusCode
				? response.statusCode >= 200 && response.statusCode < 300
				: false,
			buffer: () => Promise.resolve(response.body),
			json: () => handleJson<T>(contentType, response.body),
			text: () => handleText(contentType, response.body),
			multipart: () => handleMultipart(contentType, response.body),
			status: response.statusCode,
			headers: response.headers,
		};
	} catch (err) {
		return {
			ok: false,
			status: undefined,
			headers: {},
			buffer: () => Promise.resolve(Buffer.from('')),
			json: () => Promise.resolve(null),
			text: () =>
				Promise.resolve(err instanceof Error ? err.message : String(err)),
			multipart: () => Promise.resolve(null),
		};
	}
}
