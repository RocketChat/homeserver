import { type Static, t } from 'elysia';
import { RoomIdDto } from '../common/validation.dto';

export const GetStateParamsDto = t.Object({
	roomId: RoomIdDto,
});

export const GetStateQueryDto = t.Object({
	event_id: t.String({ description: 'Event ID to get state at' }),
});

export const GetStateResponseDto = t.Object({
	pdus: t.Array(t.Record(t.String(), t.Any()), {
		description: 'List of state event objects',
	}),
	auth_chain: t.Array(t.Record(t.String(), t.Any()), {
		description: 'List of auth chain event objects',
	}),
});

export type GetStateParams = Static<typeof GetStateParamsDto>;
export type GetStateQuery = Static<typeof GetStateQueryDto>;
export type GetStateResponse = Static<typeof GetStateResponseDto>;
