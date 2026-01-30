/**
 * Mock Matrix Application Service (bridge) server.
 *
 * Implements the Application Service API endpoints + a couple of non-spec
 * control endpoints to trigger outbound actions against a homeserver.
 */

import http from 'node:http';
import {
	APPSERVICE,
	AS_TOKEN,
	DEFAULT_HS_URL,
	HOST,
	HS_TOKEN,
	PORT,
	aliasToRoomId,
	getAccessToken,
	isRoomsRoute,
	isTxnRoute,
	isUsersRoute,
	logAuthInvalid,
	logEvents,
	logOutbound,
	logQuery,
	matrixCreateRoom,
	matrixResolveAlias,
	matrixSendMessage,
	readJson,
	seenTxnIds,
	writeEmpty,
	writeJson,
} from './shared';

export function startServer() {
	const server = http.createServer(async (req, res) => {
		const method = req.method ?? 'GET';
		const reqUrl = new URL(
			req.url ?? '/',
			`http://${req.headers.host ?? `${HOST}:${PORT}`}`,
		);
		const pathname = reqUrl.pathname;

		try {
			/**
			 * Endpoint: PUT /_matrix/app/v1/transactions/{txnId}
			 *
			 * HS -> AS: delivers events. Must authenticate using `as_token`.
			 * - Always respond 200 when authenticated (including txnId replay).
			 * - `txnId` is treated as idempotent: replays should not error.
			 */
			const txnId = isTxnRoute(pathname);
			if (txnId && method === 'PUT') {
				const token = getAccessToken(reqUrl);
				if (!token || token !== AS_TOKEN) {
					logAuthInvalid(`transactions txnId=${txnId}`);
					return writeEmpty(res, 401);
				}

				const isReplay = seenTxnIds.has(txnId);
				seenTxnIds.add(txnId);

				try {
					const body = (await readJson(req)) as { events?: unknown[] };
					const eventsCount = Array.isArray(body?.events)
						? body.events.length
						: null;
					logEvents(
						`txnId=${txnId} ${isReplay ? '(replay) ' : ''}events=${eventsCount ?? '?'}`,
					);
					if (Array.isArray(body?.events)) {
						console.log(body.events);
					} else {
						console.log({ body });
					}
				} catch (err) {
					logEvents(
						`txnId=${txnId} ${isReplay ? '(replay) ' : ''}json_parse_failed=${
							err instanceof Error ? err.message : String(err)
						}`,
					);
				}

				return writeEmpty(res, 200);
			}

			/**
			 * Endpoint: GET /_matrix/app/v1/users/{userId}
			 *
			 * HS -> AS: user query. Must authenticate using `hs_token`.
			 * - Return 200 if userId matches @mock_*
			 * - Return 404 otherwise
			 */
			const userIdRaw = isUsersRoute(pathname);
			if (userIdRaw && method === 'GET') {
				const token = getAccessToken(reqUrl);
				if (!token || token !== HS_TOKEN) {
					logAuthInvalid(`users userId=${userIdRaw}`);
					return writeEmpty(res, 401);
				}

				const userId = decodeURIComponent(userIdRaw);
				const ok = userId.startsWith('@mock_');
				logQuery(`users userId=${userId} -> ${ok ? 200 : 404}`);
				return writeEmpty(res, ok ? 200 : 404);
			}

			/**
			 * Endpoint: GET /_matrix/app/v1/rooms/{alias}
			 *
			 * HS -> AS: alias query. Must authenticate using `hs_token`.
			 * - Return 200 with { room_id } if alias matches #mock_*
			 * - Return 404 otherwise
			 */
			const aliasRaw = isRoomsRoute(pathname);
			if (aliasRaw && method === 'GET') {
				const token = getAccessToken(reqUrl);
				if (!token || token !== HS_TOKEN) {
					logAuthInvalid(`rooms alias=${aliasRaw}`);
					return writeEmpty(res, 401);
				}

				const alias = decodeURIComponent(aliasRaw);
				const ok = alias.startsWith('#mock_');
				logQuery(`rooms alias=${alias} -> ${ok ? 200 : 404}`);
				if (ok) {
					const mapped = aliasToRoomId.get(alias);
					return writeJson(res, 200, {
						room_id: mapped ?? '!mockroom:example.org',
					});
				}
				return writeEmpty(res, 404);
			}

			/**
			 * Control endpoints (non-spec)
			 * Auth: uses `hs_token` via access_token query param.
			 */
			if (pathname === '/_mock/createRoom' && method === 'POST') {
				const token = getAccessToken(reqUrl);
				if (!token || token !== HS_TOKEN) {
					logAuthInvalid('mock createRoom');
					return writeEmpty(res, 401);
				}

				const body = (await readJson(req)) as {
					hs_url?: string;
					user_id?: string;
					name?: string;
					topic?: string;
					alias?: string;
				};

				const hsUrl = body.hs_url?.trim() || DEFAULT_HS_URL;
				const userId = body.user_id?.trim();
				if (!userId) return writeJson(res, 400, { error: 'missing user_id' });

				const result = await matrixCreateRoom({
					hsUrl,
					userId,
					name: body.name,
					topic: body.topic,
					alias: body.alias,
				});

				logOutbound(
					`createRoom(hook) userId=${userId} room_id=${result.room_id} alias=${result.alias ?? '-'}`,
				);
				return writeJson(res, 200, result);
			}

			if (pathname === '/_mock/sendMessage' && method === 'POST') {
				const token = getAccessToken(reqUrl);
				if (!token || token !== HS_TOKEN) {
					logAuthInvalid('mock sendMessage');
					return writeEmpty(res, 401);
				}

				const body = (await readJson(req)) as {
					hs_url?: string;
					user_id?: string;
					room_id?: string;
					alias?: string;
					text?: string;
					msgtype?: string;
				};

				const hsUrl = body.hs_url?.trim() || DEFAULT_HS_URL;
				const userId = body.user_id?.trim();
				const text = body.text?.toString() ?? '';
				if (!userId) return writeJson(res, 400, { error: 'missing user_id' });
				if (!text.trim()) return writeJson(res, 400, { error: 'missing text' });

				let roomId = body.room_id?.trim() ?? null;
				const alias = body.alias?.trim() ?? null;
				if (!roomId && alias) roomId = aliasToRoomId.get(alias) ?? null;
				if (!roomId && alias)
					roomId = await matrixResolveAlias({ hsUrl, userId, alias });
				if (!roomId)
					return writeJson(res, 404, { error: 'unknown room_id/alias' });

				const result = await matrixSendMessage({
					hsUrl,
					userId,
					roomId,
					text,
					msgtype: body.msgtype,
				});

				logOutbound(
					`send(hook) userId=${userId} room_id=${roomId} event_id=${result.event_id ?? '-'} txn_id=${result.txn_id}`,
				);
				return writeJson(res, 200, { room_id: roomId, ...result });
			}

			return writeEmpty(res, 404);
		} catch (err) {
			console.error('❌ internal error', err);
			return writeEmpty(res, 500);
		}
	});

	server.listen(PORT, HOST, () => {
		console.log(`Mock Matrix AppService listening on http://${HOST}:${PORT}`);
		console.log(`appservice.yaml: ${APPSERVICE.appserviceYamlPath}`);
		console.log(`default hs url: ${DEFAULT_HS_URL}`);
	});
}

startServer();
