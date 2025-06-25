import { container } from 'tsyringe';
import type { RouteDefinition } from '../../types/route.types';
import { type ErrorResponse, ErrorResponseDto, SendTransactionBodyDto, SendTransactionParamsDto, type SendTransactionResponse, SendTransactionResponseDto } from '../../dtos';
import { EventService } from '../../services/event.service';

export const transactionsRoutes: RouteDefinition[] = [
	{
		method: 'PUT',
		path: '/_matrix/federation/v1/send/:txnId',
		handler: async (ctx): Promise<SendTransactionResponse | ErrorResponse> => {
			const eventService = container.resolve(EventService);
			const { pdus = [] } = ctx.body;
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
		validation: {
			params: SendTransactionParamsDto,
			body: SendTransactionBodyDto,
		},
		responses: {
			200: SendTransactionResponseDto,
			400: ErrorResponseDto,
		},
		metadata: {
			tags: ['Federation'],
			summary: 'Send transaction',
			description: 'Send a transaction'
		}
	}
];
