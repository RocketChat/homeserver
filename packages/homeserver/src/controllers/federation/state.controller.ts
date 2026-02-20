import type { EventID, RoomID } from '@rocket.chat/federation-room';
import { federationSDK } from '@rocket.chat/federation-sdk';
import { canAccessResourceMiddleware } from '@rocket.chat/homeserver/middlewares/canAccessResource';
import type { Elysia } from 'elysia';

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
	return app
		.use(canAccessResourceMiddleware('room'))
		.get(
			'/_matrix/federation/v1/state_ids/:roomId',
			({ params, query }) => federationSDK.getStateIds(params.roomId as RoomID, query.event_id as EventID),
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
			({ params, query }) => federationSDK.getState(params.roomId as RoomID, query.event_id as EventID),
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
