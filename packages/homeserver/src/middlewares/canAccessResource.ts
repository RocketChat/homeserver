import { federationSDK } from '@rocket.chat/federation-sdk';
import { errCodes } from '@rocket.chat/federation-sdk';
import Elysia from 'elysia';
import { isAuthenticatedMiddleware } from './isAuthenticated';

function extractEntityId(
	params: { roomId?: string; mediaId?: string; eventId?: string },
	entityType: 'event' | 'media' | 'room',
): string | null {
	if (entityType === 'room') {
		return params.roomId ?? null;
	}

	if (entityType === 'media') {
		return params.mediaId ?? null;
	}

	if (entityType === 'event') {
		return params.eventId ?? null;
	}

	return null;
}

export const canAccessResourceMiddleware = (
	entityType: 'event' | 'media' | 'room',
) => {
	return new Elysia({ name: 'homeserver/canAccessResource' })
		.use(isAuthenticatedMiddleware())
		.onBeforeHandle(async ({ params, authenticatedServer, set }) => {
			try {
				if (!authenticatedServer) {
					set.status = errCodes.M_UNAUTHORIZED.status;
					return {
						errcode: errCodes.M_UNAUTHORIZED.errcode,
						error: 'Authentication required',
					};
				}

				const resourceId = extractEntityId(params, entityType);
				if (!resourceId) {
					set.status = 400;
					return {
						errcode: 'M_INVALID_PARAM',
						error: `Missing required ${entityType} identifier`,
					};
				}

				const resourceAccess = await federationSDK.canAccessResource(
					entityType,
					resourceId,
					authenticatedServer,
				);
				if (!resourceAccess) {
					set.status = errCodes.M_FORBIDDEN.status;
					return {
						errcode: errCodes.M_FORBIDDEN.errcode,
						error: 'Access denied to resource',
					};
				}
			} catch (_err) {
				set.status = errCodes.M_UNKNOWN.status;
				return {
					errcode: errCodes.M_UNKNOWN.errcode,
					error: 'Internal server error',
				};
			}
		});
};
