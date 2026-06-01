import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
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

	const content = closingBoundary > binaryStart ? buffer.subarray(binaryStart, closingBoundary) : buffer.subarray(binaryStart);

	return { content };
}

async function handleJson<T>(contentType: string, body: () => Promise<Buffer>): Promise<T> {
	if (!contentType.includes('application/json')) {
		throw new Error('Content-Type is not application/json');
	}

	try {
		return JSON.parse((await body()).toString());
	} catch {
		throw new Error('Failed to parse JSON response');
	}
}

async function handleText(contentType: string, body: () => Promise<Buffer>): Promise<string> {
	if (!contentType.includes('text/')) {
		return '';
	}

	return (await body()).toString();
}

// the redirect URL should be fetched without Matrix auth
// and will only occur for media downloads as per Matrix spec
async function handleMultipartRedirect<T>(redirect: string): Promise<FetchResponse<T>> {
	const redirectResponse = await fetch<T>(new URL(redirect), {
		method: 'GET',
		headers: {},
	});

	if (!redirectResponse.ok) {
		throw new Error(`Failed to fetch media from redirect: ${redirect}`);
	}

	return redirectResponse;
}

async function handleMultipart<T>(contentType: string, body: () => Promise<Buffer>, depth = 0): Promise<MultipartResult> {
	if (!/\bmultipart\b/i.test(contentType)) {
		throw new Error('Content-Type is not multipart');
	}

	// extract boundary from content-type header
	const boundaryMatch = contentType.match(/boundary=([^;,\s]+)/i);
	if (!boundaryMatch) {
		throw new Error('Boundary not found in Content-Type header');
	}

	// remove quotes if present
	const boundary = boundaryMatch[1].replace(/^["']|["']$/g, '');
	const multipart = parseMultipart(await body(), boundary);

	if (multipart.redirect) {
		if (depth >= 5) {
			throw new Error('Too many redirects in multipart response');
		}

		const redirectResponse = await handleMultipartRedirect<T>(multipart.redirect);
		return handleMultipart(redirectResponse.headers['content-type'] || '', redirectResponse.body, depth + 1);
	}

	return multipart;
}

export type FetchResponse<T> = {
	ok: boolean;
	status: number | undefined;
	headers: IncomingHttpHeaders;
	buffer: () => Promise<Buffer>;
	json: () => Promise<T>;
	text: () => Promise<string>;
	multipart: () => Promise<MultipartResult>;
	body: () => Promise<Buffer>;
};

// lazily reads the full response body once, enforcing a size limit and cleaning up listeners
function readBody(res: IncomingMessage): () => Promise<Buffer> {
	let body: Promise<Buffer>;

	return () => {
		if (!body) {
			body = new Promise<Buffer>((resolve, reject) => {
				const chunks: Buffer[] = [];

				// TODO: Make @hs/core fetch size limit configurable
				let total = 0;
				const MAX_RESPONSE_BYTES = 50 * 1024 * 1024; // 50 MB

				const onData = (chunk: Buffer) => {
					total += chunk.length;
					if (total > MAX_RESPONSE_BYTES) {
						const err = new Error('Response exceeds size limit');
						res.destroy(err);
						cleanup();
						reject(err);
						return;
					}
					chunks.push(chunk);
				};
				const onEnd = () => {
					cleanup();
					resolve(Buffer.concat(chunks));
				};
				const onErr = (err: Error) => {
					cleanup();
					reject(err);
				};
				const onAborted = () => onErr(new Error('Response aborted'));
				const cleanup = () => {
					res.off('data', onData);
					res.off('end', onEnd);
					res.off('error', onErr);
					res.off('aborted', onAborted);
				};
				res.on('data', onData);
				res.once('end', onEnd);
				res.once('error', onErr);
				res.once('aborted', onAborted);
				res.resume();
			});
		}

		return body;
	};
}

// fallback response returned when the request never produced a usable response
function errorResponse<T>(reason: string): FetchResponse<T> {
	return {
		ok: false,
		status: undefined,
		headers: {},
		buffer: () => Promise.reject(reason),
		json: () => Promise.reject(reason),
		text: () => Promise.reject(reason),
		multipart: () => Promise.reject(reason),
		body: () => Promise.reject(reason),
	};
}

// works for both http and https. for https on a multihomed server (same server hosting
// multiple homeservers) we must verify the cert with the right SNI (hostname), or else the
// cert check fails because we connect through the ip and not the hostname (due to matrix spec).
export async function fetch<T>(url: URL, options: RequestInit): Promise<FetchResponse<T>> {
	const isHttps = url.protocol === 'https:';
	const transport = isHttps ? https : http;

	const requestParams: RequestOptions = {
		// for ipv6 remove square brackets as they come due to url standard
		host: url.hostname.replace(/^\[|\]$/g, ''), // IP
		port: url.port,
		method: options.method,
		path: url.pathname + url.search,
		headers: options.headers as IncomingHttpHeaders,
	};

	if (isHttps) {
		const host = (options.headers as IncomingHttpHeaders | undefined)?.Host;
		if (host) {
			requestParams.servername = new URL(`http://${host}`).hostname;
		}
	}

	try {
		const response: {
			statusCode: number | undefined;
			body: () => Promise<Buffer>;
			headers: IncomingHttpHeaders;
		} = await new Promise((resolve, reject) => {
			const request = transport.request(requestParams, (res) => {
				res.once('error', reject);
				res.pause();

				resolve({
					statusCode: res.statusCode,
					headers: res.headers,
					body: readBody(res),
				});
			});

			const { signal } = options;
			if (signal) {
				const onAbort = () => request.destroy(new Error('Aborted'));
				signal.addEventListener('abort', onAbort, { once: true });
				request.once('close', () => signal.removeEventListener('abort', onAbort));
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
			ok: response.statusCode ? response.statusCode >= 200 && response.statusCode < 300 : false,
			buffer: () => response.body(),
			json: () => handleJson<T>(contentType, response.body),
			text: () => handleText(contentType, response.body),
			multipart: () => handleMultipart(contentType, response.body),
			body: response.body,
			status: response.statusCode,
			headers: response.headers,
		};
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);

		return errorResponse<T>(reason);
	}
}
