import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import {
	type ErrorResponse,
	ErrorResponseDto,
	SendTransactionBodyDto,
	type SendTransactionResponse,
	SendTransactionResponseDto,
} from '../../dtos';
import { EventService } from '@hs/federation-sdk';

export const transactionsPlugin = (app: Elysia) => {
	const eventService = container.resolve(EventService);
	return app.put(
		'/_matrix/federation/v1/send/:txnId',
		async ({ body }): Promise<SendTransactionResponse | ErrorResponse> => {
			const { pdus = [] } = body;
			if (pdus.length === 0) {
				return {
					pdus: {},
					edus: {},
				};
			}
			await eventService.processIncomingPDUs(pdus);
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
	);
};
