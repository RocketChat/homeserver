import { EventService } from '@hs/federation-sdk';
import { EventID } from '@hs/room';
import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import {
	ErrorResponseDto,
	GetStateIdsParamsDto,
	GetStateIdsQueryDto,
	GetStateIdsResponseDto,
	GetStateParamsDto,
	GetStateQueryDto,
	GetStateResponseDto,
} from '../../dtos';

export const statePlugin = (app: Elysia) => {
	const eventService = container.resolve(EventService);

	return app
		.get(
			'/_matrix/federation/v1/state_ids/:roomId',
			({ params, query }) =>
				eventService.getStateIds(params.roomId, query.event_id as EventID),
			{
				params: GetStateIdsParamsDto,
				query: GetStateIdsQueryDto,
				response: {
					200: GetStateIdsResponseDto,
					400: ErrorResponseDto,
				},
				detail: {
					tags: ['Federation'],
					summary: 'Get state IDs',
					description: 'Get state event IDs for a room',
				},
			},
		)
		.get(
			'/_matrix/federation/v1/state/:roomId',
			({ params, query }) =>
				eventService.getState(params.roomId, query.event_id as EventID),
			{
				params: GetStateParamsDto,
				query: GetStateQueryDto,
				response: {
					200: GetStateResponseDto,
					400: ErrorResponseDto,
				},
				detail: {
					tags: ['Federation'],
					summary: 'Get state',
					description: 'Get state events for a room',
				},
			},
		);
};
