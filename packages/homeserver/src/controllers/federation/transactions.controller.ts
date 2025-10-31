import { EventID, RoomID } from '@rocket.chat/federation-room';
import { federationSDK } from '@rocket.chat/federation-sdk';
import { canAccessResourceMiddleware } from '@rocket.chat/homeserver/middlewares/canAccessResource';
import { isAuthenticatedMiddleware } from '@rocket.chat/homeserver/middlewares/isAuthenticated';
import { Elysia } from 'elysia';
import {
	BackfillErrorResponseDto,
	BackfillParamsDto,
	BackfillQueryDto,
	BackfillResponseDto,
	ErrorResponseDto,
	GetEventErrorResponseDto,
	GetEventParamsDto,
	GetEventResponseDto,
	SendTransactionBodyDto,
	SendTransactionResponseDto,
} from '../../dtos';

export const transactionsPlugin = (app: Elysia) => {
	return app
		.put(
			'/_matrix/federation/v1/send/:txnId',
			async ({ body }) => {
				// TODO need to validate better the payload
				// biome-ignore lint/suspicious/noExplicitAny:
				await federationSDK.processIncomingTransaction(body as any);

				return {
					pdus: {},
					edus: {},
				};
			},
			{
				use: isAuthenticatedMiddleware(),
				body: SendTransactionBodyDto,
				response: {
					200: SendTransactionResponseDto,
					400: ErrorResponseDto,
				},
				detail: {
					tags: ['Federation'],
					summary: 'Send transaction',
					description: 'Send a transaction',
				},
			},
		)

		.get(
			'/_matrix/federation/v1/event/:eventId',
			async ({ params, set }) => {
				const serverName = federationSDK.getConfig('serverName');

				const eventData = await federationSDK.getEventById(
					params.eventId as EventID,
				);
				if (!eventData) {
					set.status = 404;
					return {
						errcode: 'M_NOT_FOUND',
						error: 'Event not found',
					};
				}

				return {
					origin_server_ts: eventData.event.origin_server_ts,
					origin: serverName,
					pdus: [{ ...eventData.event, origin: serverName }],
				};
			},
			{
				use: canAccessResourceMiddleware('event'),
				params: GetEventParamsDto,
				response: {
					200: GetEventResponseDto,
					401: GetEventErrorResponseDto,
					403: GetEventErrorResponseDto,
					404: GetEventErrorResponseDto,
					500: GetEventErrorResponseDto,
				},
				detail: {
					tags: ['Federation'],
					summary: 'Get event',
					description: 'Get an event',
				},
			},
		)

		.get(
			'/_matrix/federation/v1/backfill/:roomId',
			async ({ params, query, set }) => {
				try {
					const limit = query.limit;
					const eventIdParam = query.v;
					if (!eventIdParam) {
						set.status = 400;
						return {
							errcode: 'M_BAD_REQUEST',
							error: 'Event ID must be provided in v query parameter',
						};
					}

					const eventIds = Array.isArray(eventIdParam)
						? eventIdParam
						: [eventIdParam];

					return federationSDK.getBackfillEvents(
						params.roomId as RoomID,
						eventIds as EventID[],
						limit,
					);
				} catch {
					set.status = 500;
					return {
						errcode: 'M_UNKNOWN',
						error: 'Failed to get backfill events',
					};
				}
			},
			{
				use: canAccessResourceMiddleware('room'),
				params: BackfillParamsDto,
				query: BackfillQueryDto,
				response: {
					200: BackfillResponseDto,
					400: BackfillErrorResponseDto,
					401: BackfillErrorResponseDto,
					403: BackfillErrorResponseDto,
					404: BackfillErrorResponseDto,
					500: BackfillErrorResponseDto,
				},
				detail: {
					tags: ['Federation'],
					summary: 'Backfill room events',
					description:
						'Retrieves a sliding-window history of previous PDUs that occurred in the given room',
				},
			},
		);
};
