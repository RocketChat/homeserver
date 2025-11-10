import { type Static, t } from 'elysia';

export const FederationErrorResponseDto = t.Object({
	errcode: t.Enum({
		M_UNRECOGNIZED: 'M_UNRECOGNIZED',
		M_UNAUTHORIZED: 'M_UNAUTHORIZED',
		M_FORBIDDEN: 'M_FORBIDDEN',
		M_UNKNOWN: 'M_UNKNOWN',
		M_NOT_FOUND: 'M_NOT_FOUND',
	}),
	error: t.String(),
});

export type FederationErrorResponseDto = Static<
	typeof FederationErrorResponseDto
>;
