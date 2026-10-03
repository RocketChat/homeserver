import fs from 'node:fs';
import http from 'node:http';

export const PORT = 9000;
export const HOST = 'localhost';

type AppserviceConfig = {
	appserviceYamlPath: string;
	id: string;
	url: string;
	as_token: string;
	hs_token: string;
	sender_localpart: string;
};

function stripQuotes(value: string) {
	const v = value.trim();
	if (
		(v.startsWith('"') && v.endsWith('"')) ||
		(v.startsWith("'") && v.endsWith("'"))
	) {
		return v.slice(1, -1);
	}
	return v;
}

function parseTopLevelYaml(text: string) {
	// Minimal parser: only reads top-level `key: value` pairs.
	// This is enough for our `appservice.yaml` (id/url/as_token/hs_token/sender_localpart).
	const out: Record<string, string> = {};
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		if (rawLine.startsWith(' ') || rawLine.startsWith('\t')) continue; // ignore nested blocks

		const idx = line.indexOf(':');
		if (idx <= 0) continue;

		const key = line.slice(0, idx).trim();
		const value = stripQuotes(line.slice(idx + 1));
		if (!key || !value) continue;

		out[key] = value;
	}
	return out;
}

function loadAppserviceConfig(): AppserviceConfig {
	const defaultConfig: AppserviceConfig = {
		appserviceYamlPath: new URL('./appservice.yaml', import.meta.url).pathname,
		id: 'mockbridge',
		url: 'http://localhost:9000',
		as_token: 'mock-as-token-123',
		hs_token: 'mock-hs-token-456',
		sender_localpart: 'mockbot',
	};

	const appserviceYamlPath =
		process.env.MOCK_BRIDGE_APPSERVICE_YAML?.trim() ||
		defaultConfig.appserviceYamlPath;

	try {
		const text = fs.readFileSync(appserviceYamlPath, 'utf8');
		const parsed = parseTopLevelYaml(text);

		return {
			appserviceYamlPath,
			id: parsed.id || defaultConfig.id,
			url: parsed.url || defaultConfig.url,
			as_token: parsed.as_token || defaultConfig.as_token,
			hs_token: parsed.hs_token || defaultConfig.hs_token,
			sender_localpart:
				parsed.sender_localpart || defaultConfig.sender_localpart,
		};
	} catch {
		// Keep working with defaults if the file isn't available.
		return { ...defaultConfig, appserviceYamlPath };
	}
}

export const APPSERVICE = loadAppserviceConfig();

// Tokens (mock). Sourced from appservice.yaml when available.
export const AS_TOKEN = APPSERVICE.as_token;
export const HS_TOKEN = APPSERVICE.hs_token;

// Default homeserver base URL for outbound calls (CLI + control endpoints).
export const DEFAULT_HS_URL =
	process.env.MOCK_BRIDGE_HS_URL ?? 'http://localhost:8008';

// In-memory idempotency store for transaction replays.
export const seenTxnIds = new Set<string>();

// Optional dynamic alias -> room_id mapping (populated by control endpoints).
export const aliasToRoomId = new Map<string, string>();

let outboundTxnCounter = 0;

export function logAuthInvalid(message: string) {
	console.log(`❌ auth inválida: ${message}`);
}

export function logEvents(message: string) {
	console.log(`📥 eventos: ${message}`);
}

export function logQuery(message: string) {
	console.log(`🔍 queries: ${message}`);
}

export function logOutbound(message: string) {
	console.log(`📤 outbound: ${message}`);
}

export function getAccessToken(reqUrl: URL): string | null {
	return reqUrl.searchParams.get('access_token');
}

export function writeJson(
	res: http.ServerResponse,
	statusCode: number,
	body: unknown,
) {
	const payload = JSON.stringify(body);
	res.statusCode = statusCode;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('content-length', Buffer.byteLength(payload));
	res.end(payload);
}

export function writeEmpty(res: http.ServerResponse, statusCode: number) {
	res.statusCode = statusCode;
	res.end();
}

export async function readBody(
	req: http.IncomingMessage,
	maxBytes = 5 * 1024 * 1024,
): Promise<string> {
	let size = 0;
	const chunks: Buffer[] = [];

	for await (const chunk of req) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buf.length;
		if (size > maxBytes) {
			throw new Error(`body_too_large: ${size} bytes`);
		}
		chunks.push(buf);
	}

	return Buffer.concat(chunks).toString('utf8');
}

export async function readJson(req: http.IncomingMessage): Promise<unknown> {
	const raw = await readBody(req);
	if (!raw.trim()) return {};
	return JSON.parse(raw);
}

export function isTxnRoute(pathname: string) {
	// /_matrix/app/v1/transactions/{txnId}
	const prefix = '/_matrix/app/v1/transactions/';
	if (!pathname.startsWith(prefix)) return null;
	const txnId = pathname.slice(prefix.length);
	if (!txnId || txnId.includes('/')) return null;
	return txnId;
}

export function isUsersRoute(pathname: string) {
	// /_matrix/app/v1/users/{userId}
	const prefix = '/_matrix/app/v1/users/';
	if (!pathname.startsWith(prefix)) return null;
	const rest = pathname.slice(prefix.length);
	if (!rest) return null;
	return rest;
}

export function isRoomsRoute(pathname: string) {
	// /_matrix/app/v1/rooms/{alias}
	const prefix = '/_matrix/app/v1/rooms/';
	if (!pathname.startsWith(prefix)) return null;
	const rest = pathname.slice(prefix.length);
	if (!rest) return null;
	return rest;
}

function nextOutboundTxnId() {
	outboundTxnCounter += 1;
	return `mock-${Date.now()}-${outboundTxnCounter}`;
}

export async function matrixRequest(opts: {
	hsUrl: string;
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	path: string;
	asToken: string;
	userId?: string;
	body?: unknown;
}) {
	const url = new URL(opts.path, opts.hsUrl);
	url.searchParams.set('access_token', opts.asToken);
	if (opts.userId) url.searchParams.set('user_id', opts.userId);

	const res = await fetch(url, {
		method: opts.method,
		headers: opts.body ? { 'content-type': 'application/json' } : undefined,
		body: opts.body ? JSON.stringify(opts.body) : undefined,
	});

	const contentType = res.headers.get('content-type') ?? '';
	const isJson = contentType.includes('application/json');
	const text = await res.text();
	const json = isJson && text ? (JSON.parse(text) as unknown) : null;

	return { status: res.status, text, json };
}

export async function matrixCreateRoom(params: {
	hsUrl: string;
	userId: string;
	name?: string;
	topic?: string;
	alias?: string;
}) {
	const alias = params.alias?.trim();
	const aliasLocalpart =
		alias?.startsWith('#') && alias.includes(':')
			? alias.slice(1, alias.indexOf(':'))
			: alias?.startsWith('#')
				? alias.slice(1)
				: undefined;

	const createRoomBody: Record<string, unknown> = {};
	if (params.name) createRoomBody.name = params.name;
	if (params.topic) createRoomBody.topic = params.topic;
	if (aliasLocalpart) createRoomBody.room_alias_name = aliasLocalpart;

	const createRes = await matrixRequest({
		hsUrl: params.hsUrl,
		method: 'POST',
		path: '/_matrix/client/v3/createRoom',
		asToken: AS_TOKEN,
		userId: params.userId,
		body: createRoomBody,
	});

	if (createRes.status < 200 || createRes.status >= 300 || !createRes.json) {
		throw new Error(
			`createRoom failed: status=${createRes.status} body=${createRes.text}`,
		);
	}

	const roomId = (createRes.json as { room_id?: string }).room_id;
	if (!roomId) throw new Error(`createRoom missing room_id: ${createRes.text}`);

	if (alias) {
		aliasToRoomId.set(alias, roomId);
		// Best-effort: try to bind the alias in the HS directory too.
		try {
			const dirRes = await matrixRequest({
				hsUrl: params.hsUrl,
				method: 'PUT',
				path: `/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`,
				asToken: AS_TOKEN,
				userId: params.userId,
				body: { room_id: roomId },
			});
			logOutbound(
				`setAlias alias=${alias} room_id=${roomId} status=${dirRes.status}`,
			);
		} catch (err) {
			logOutbound(
				`setAlias alias=${alias} room_id=${roomId} error=${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
	}

	return { room_id: roomId, alias: alias ?? null };
}

export async function matrixEnsureJoined(params: {
	hsUrl: string;
	userId: string;
	roomId: string;
}) {
	const joinRes = await matrixRequest({
		hsUrl: params.hsUrl,
		method: 'POST',
		path: `/_matrix/client/v3/rooms/${encodeURIComponent(params.roomId)}/join`,
		asToken: AS_TOKEN,
		userId: params.userId,
		body: {},
	});

	// 2xx: joined/ok. Non-2xx: still return to caller for logging.
	return joinRes;
}

export async function matrixResolveAlias(params: {
	hsUrl: string;
	userId: string;
	alias: string;
}) {
	const res = await matrixRequest({
		hsUrl: params.hsUrl,
		method: 'GET',
		path: `/_matrix/client/v3/directory/room/${encodeURIComponent(params.alias)}`,
		asToken: AS_TOKEN,
		userId: params.userId,
	});

	if (res.status < 200 || res.status >= 300 || !res.json) return null;
	return (res.json as { room_id?: string }).room_id ?? null;
}

export async function matrixSendMessage(params: {
	hsUrl: string;
	userId: string;
	roomId: string;
	text: string;
	msgtype?: string;
}) {
	await matrixEnsureJoined({
		hsUrl: params.hsUrl,
		userId: params.userId,
		roomId: params.roomId,
	});

	const txnId = nextOutboundTxnId();
	const sendRes = await matrixRequest({
		hsUrl: params.hsUrl,
		method: 'PUT',
		path: `/_matrix/client/v3/rooms/${encodeURIComponent(params.roomId)}/send/m.room.message/${encodeURIComponent(
			txnId,
		)}`,
		asToken: AS_TOKEN,
		userId: params.userId,
		body: { msgtype: params.msgtype ?? 'm.text', body: params.text },
	});

	if (sendRes.status < 200 || sendRes.status >= 300 || !sendRes.json) {
		throw new Error(
			`send failed: status=${sendRes.status} body=${sendRes.text}`,
		);
	}

	const eventId = (sendRes.json as { event_id?: string }).event_id ?? null;
	return { event_id: eventId, txn_id: txnId };
}
