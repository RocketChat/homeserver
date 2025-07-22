import { type OutgoingHttpHeaders } from 'node:http';
import https from 'node:https';

type RequestOptions = Parameters<typeof https.request>[1];

// this fetch is used when connecting to a multihome server, same server hosting multiple homeservers, and we need to verify the cert with the right SNI (hostname), or else, cert check will fail due to connecting through ip and not hostname (due to matrix spec).
export async function fetch(url: URL, options: RequestInit) {
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
		const response: { statusCode: number | undefined; body: string } =
			await new Promise((resolve, reject) => {
				const request = https.request(requestParams, (res) => {
					let data = '';
					res.on('data', (chunk) => {
						data += chunk;
					});
					res.on('end', () => {
						resolve({
							statusCode: res.statusCode,
							body: data,
						});
					});
				});
				request.on('error', (err) => {
					reject(err);
				});

				request.end(options.body ? JSON.stringify(options.body) : undefined);
			});

		return {
			ok: response.statusCode
				? response.statusCode >= 200 && response.statusCode < 300
				: false,
			json: () => JSON.parse(response.body),
			text: () => response.body,
			status: response.statusCode,
		};
	} catch (err) {
		return {
			ok: false,
			json: () => undefined,
			text: () => (err instanceof Error ? err.message : String(err)),
			status: undefined,
		};
	}
}
