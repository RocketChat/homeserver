import { EventID } from '@rocket.chat/federation-room';
import {
	ConfigService,
	EventAuthorizationService,
	EventService,
} from '@rocket.chat/federation-sdk';
import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import {
	ErrorResponseDto,
	GetEventErrorResponseDto,
	GetEventParamsDto,
	GetEventResponseDto,
	SendTransactionBodyDto,
	SendTransactionResponseDto,
} from '../../dtos';
import { canAccessEvent } from '../../middlewares/acl.middleware';

export const transactionsPlugin = (app: Elysia) => {
	const eventService = container.resolve(EventService);
	const configService = container.resolve(ConfigService);
	const eventAuthService = container.resolve(EventAuthorizationService);

	return app
		.put(
			'/_matrix/federation/v1/send/:txnId',
			async ({ body }) => {
				// TODO need to validate better the payload
				// biome-ignore lint/suspicious/noExplicitAny:
				await eventService.processIncomingTransaction(body as any);

				return {
					pdus: {},
					edus: {},
				};
			},
			{
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
				const eventData = await eventService.getEventById(
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
					origin: configService.serverName,
					pdus: [{ ...eventData.event, origin: configService.serverName }],
				};
			},
			{
				use: canAccessEvent(eventAuthService),
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
		);
};
