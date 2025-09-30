import type { EventAuthorizationService } from '@rocket.chat/federation-sdk';
import Elysia from 'elysia';

export const isAuthenticatedMiddleware = (
	federationAuth: EventAuthorizationService,
) => {
	return new Elysia({
		name: 'homeserver/isAuthenticated',
	})
		.derive({ as: 'global' }, async ({ headers, request, set }) => {
			const authorizationHeader = headers.authorization;
			const method = request.method;
			const url = new URL(request.url);
			const uri = url.pathname + url.search;

			if (!authorizationHeader) {
				set.status = 401;
				return {
					authenticatedServer: null,
				};
			}

			try {
				let body: Record<string, unknown> | undefined;
				if (request.body) {
					try {
						const text = await request.text();
						body = text ? JSON.parse(text) : undefined;
					} catch {
						body = undefined;
					}
				}

				const isValid = await federationAuth.verifyRequestSignature(
					authorizationHeader,
					method,
					uri,
					body,
				);

				if (!isValid) {
					set.status = 401;
					return {
						authenticatedServer: null,
					};
				}

				return {
					authenticatedServer: isValid,
				};
			} catch (error) {
				console.error('Authentication error:', error);
				set.status = 500;
				return {
					authenticatedServer: null,
				};
			}
		})
		.onBeforeHandle(({ authenticatedServer, set }) => {
			if (!authenticatedServer) {
				return {
					errcode: set.status === 500 ? 'M_UNKNOWN' : 'M_UNAUTHORIZED',
					error:
						set.status === 500
							? 'Internal server error'
							: 'Authentication required',
				};
			}
		});
};
