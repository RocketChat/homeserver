import { t } from 'elysia';
import { EventBaseDto } from '../common/event.dto';

export const BackfillParamsDto = t.Object({
	roomId: t.String({ minLength: 1 }),
});

export const BackfillQueryDto = t.Object({
	limit: t.Number({ minimum: 1, maximum: 100 }),
	v: t.Union([t.String(), t.Array(t.String())]),
});

export const BackfillResponseDto = t.Object({
	origin: t.String(),
	origin_server_ts: t.Number(),
	pdus: t.Array(EventBaseDto),
});

export const BackfillErrorResponseDto = t.Object({
	errcode: t.String(),
	error: t.String(),
});
