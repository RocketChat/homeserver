import type { EventAuthorizationService } from '@rocket.chat/federation-sdk';
import { errCodes } from '@rocket.chat/federation-sdk';
import Elysia from 'elysia';
import { isAuthenticatedMiddleware } from './isAuthenticated';

function extractEntityId(
	params: { roomId?: string; mediaId?: string; eventId?: string },
	entityType: 'event' | 'media' | 'room',
): string {
	if (entityType === 'room') {
		const roomId = params.roomId;
		if (!roomId) {
			throw new Error('Room ID is required');
		}

		return roomId;
	}

	if (entityType === 'media') {
		const mediaId = params.mediaId;
		if (!mediaId) {
			throw new Error('Media ID is required');
		}

		return mediaId;
	}

	if (entityType === 'event') {
		const eventId = params.eventId;
		if (!eventId) {
			throw new Error('Event ID is required');
		}

		return eventId;
	}

	throw new Error('Invalid entity type');
}

export const canAccessResourceMiddleware = (
	federationAuth: EventAuthorizationService,
	entityType: 'event' | 'media' | 'room',
) => {
	return new Elysia({ name: 'homeserver/canAccessResource' })
		.use(isAuthenticatedMiddleware(federationAuth))
		.onBeforeHandle(async ({ params, authenticatedServer, set }) => {
			try {
				if (!authenticatedServer) {
					set.status = errCodes.M_UNAUTHORIZED.status;
					return {
						errcode: errCodes.M_UNAUTHORIZED.errcode,
						error: 'Authentication required',
					};
				}

				const resourceAccess = await federationAuth.canAccessResource(
					entityType,
					extractEntityId(params, entityType),
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
