import type { EventAuthorizationService } from '@rocket.chat/federation-sdk';
import { errCodes } from '@rocket.chat/federation-sdk';
import Elysia from 'elysia';

type RoutesParams = { roomId?: string; mediaId?: string; eventId?: string };

function extractEntityId(
	params: RoutesParams,
): { type: 'event' | 'media' | 'room'; id: string } | undefined {
	if (params.eventId) {
		return { type: 'event', id: params.eventId };
	}

	if (params.mediaId) {
		return { type: 'media', id: params.mediaId };
	}

	if (params.roomId) {
		return { type: 'room', id: params.roomId };
	}

	return;
}

export const canAccessResource = (
	federationAuth: EventAuthorizationService,
) => {
	return new Elysia({
		name: 'homeserver/canAccessEvent',
		// TODO: Get rid of any type
	}).onBeforeHandle(async ({ params, authenticatedServer, set }: any) => {
		try {
			if (!authenticatedServer) {
				set.status = errCodes.M_UNAUTHORIZED.status;
				return {
					errcode: errCodes.M_UNAUTHORIZED.errcode,
					error: 'Authentication required',
				};
			}

			const entity = extractEntityId(params);
			if (!entity) {
				return;
			}

			const resourceAccess = await federationAuth.canAccessResource(
				entity.type,
				entity.id,
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
