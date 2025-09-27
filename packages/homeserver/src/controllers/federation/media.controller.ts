import { EventAuthorizationService } from '@rocket.chat/federation-sdk';
import {
	canAccessResource,
	isAuthenticated,
} from '@rocket.chat/homeserver/middlewares';
import { Elysia, t } from 'elysia';
import { container } from 'tsyringe';

const ErrorResponseSchema = t.Object({
	errcode: t.Literal('M_UNRECOGNIZED'),
	error: t.String(),
});

/**
 * The group of media routes are not implemented on homeserver side
 * due to the fact that homeserver does not have a media repository.
 * All the medias are being handled by the Rocket.Chat instances.
 */
export const mediaPlugin = (app: Elysia) => {
	const eventAuthService = container.resolve(EventAuthorizationService);

	return app
		.get(
			'/_matrix/media/v3/config',
			async ({ set }) => {
				set.status = 404;
				return {
					errcode: 'M_UNRECOGNIZED',
					error: 'This endpoint is not implemented on homeserver side',
				};
			},
			{
				response: {
					404: ErrorResponseSchema,
				},
				detail: {
					tags: ['Media'],
					summary: 'Get media configuration',
					description: 'Get the media configuration for the homeserver',
				},
			},
		)
		.group('/_matrix', (app) =>
			app
				.use(isAuthenticated(eventAuthService))
				.use(canAccessResource(eventAuthService))
				.get(
					'/federation/v1/media/download/:mediaId',
					async ({ set }) => {
						set.status = 404;
						return {
							errcode: 'M_UNRECOGNIZED',
							error: 'This endpoint is not implemented on homeserver side',
						};
					},
					{
						params: t.Object({
							mediaId: t.String(),
						}),
						response: {
							404: ErrorResponseSchema,
						},
					},
				)

				.get(
					'/media/r0/download/:serverName/:mediaId',
					async ({ set }) => {
						set.status = 404;
						return {
							errcode: 'M_UNRECOGNIZED',
							error: 'This endpoint is not implemented on homeserver side',
						};
					},
					{
						params: t.Object({
							serverName: t.String(),
							mediaId: t.String(),
						}),
						response: {
							404: ErrorResponseSchema,
						},
						detail: {
							tags: ['Media'],
							summary: 'Download media',
							description: 'Download a file from the Matrix media repository',
						},
					},
				)

				.get(
					'/media/v3/download/:serverName/:mediaId',
					async ({ set }) => {
						set.status = 404;
						return {
							errcode: 'M_UNRECOGNIZED',
							error: 'This endpoint is not implemented on homeserver side',
						};
					},
					{
						params: t.Object({
							serverName: t.String(),
							mediaId: t.String(),
						}),
						query: t.Object({
							allow_remote: t.Optional(t.Boolean()),
							timeout_ms: t.Optional(t.Number()),
						}),
						response: {
							404: ErrorResponseSchema,
						},
						detail: {
							tags: ['Media'],
							summary: 'Download media',
							description: 'Download a file from the Matrix media repository',
						},
					},
				)

				.get(
					'/media/v3/thumbnail/:serverName/:mediaId',
					async ({ set }) => {
						set.status = 404;
						return {
							errcode: 'M_UNRECOGNIZED',
							error: 'This endpoint is not implemented on homeserver side',
						};
					},
					{
						params: t.Object({
							serverName: t.String(),
							mediaId: t.String(),
						}),
						query: t.Object({
							width: t.Optional(t.Number({ minimum: 1, maximum: 800 })),
							height: t.Optional(t.Number({ minimum: 1, maximum: 600 })),
							method: t.Optional(
								t.Union([t.Literal('crop'), t.Literal('scale')]),
							),
							allow_remote: t.Optional(t.Boolean()),
							timeout_ms: t.Optional(t.Number()),
						}),
						response: {
							404: ErrorResponseSchema,
						},
						detail: {
							tags: ['Media'],
							summary: 'Get media thumbnail',
							description: 'Get a thumbnail for a media file',
						},
					},
				),
		);
};
