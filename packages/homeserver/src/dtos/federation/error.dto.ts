import { t } from 'elysia';

export const FederationErrorResponseDto = t.Object({
	errcode: t.Enum({
		M_UNRECOGNIZED: 'M_UNRECOGNIZED',
		M_UNAUTHORIZED: 'M_UNAUTHORIZED',
		M_FORBIDDEN: 'M_FORBIDDEN',
		M_UNKNOWN: 'M_UNKNOWN',
	}),
	error: t.String(),
});
