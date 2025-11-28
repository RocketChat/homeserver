import { federationSDK } from '@rocket.chat/federation-sdk';
import Elysia from 'elysia';
import {
	FailedSignatureVerificationPreconditionError,
	InvalidRequestSignatureError,
} from '../../../federation-sdk/src/services/signature-verification.service';

export const isAuthenticatedMiddleware = () => {
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
					authenticatedServer: undefined,
				};
			}

			let body: Record<string, unknown> | undefined;
			if (request.body) {
				try {
					const clone = request.clone();
					const text = await clone.text();
					body = text ? JSON.parse(text) : undefined;
				} catch {
					body = undefined;
				}
			}

			try {
				await federationSDK.verifyRequestSignature(
					authorizationHeader,
					method,
					uri,
					body,
				);
			} catch (error) {
				console.error('Signature verification error:', error);
				if (
					error instanceof FailedSignatureVerificationPreconditionError ||
					error instanceof InvalidRequestSignatureError
				) {
					set.status = 401;
				} else {
					set.status = 500;
				}

				return {
					authenticatedServer: undefined,
				};
			}

			return {
				authenticatedServer: true,
			};
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
