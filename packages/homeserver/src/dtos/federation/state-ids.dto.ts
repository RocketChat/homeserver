import { type Static, t } from 'elysia';
import { RoomIdDto } from '../common/validation.dto';

export const GetStateIdsParamsDto = t.Object({
	roomId: RoomIdDto,
});

export const GetStateIdsQueryDto = t.Object({
	event_id: t.Optional(t.String({ description: 'Event ID to get state at' })),
});

export const GetStateIdsResponseDto = t.Object({
	pdu_ids: t.Array(t.String(), { description: 'List of state event IDs' }),
	auth_chain_ids: t.Array(t.String(), {
		description: 'List of auth chain event IDs',
	}),
});

export type GetStateIdsParams = Static<typeof GetStateIdsParamsDto>;
export type GetStateIdsQuery = Static<typeof GetStateIdsQueryDto>;
export type GetStateIdsResponse = Static<typeof GetStateIdsResponseDto>;
