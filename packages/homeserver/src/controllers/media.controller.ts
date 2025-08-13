import { createLogger } from '@hs/core';
import { ConfigService, MediaService } from '@hs/federation-sdk';
import { Elysia, t } from 'elysia';
import { container } from 'tsyringe';

const ErrorResponseSchema = t.Object({
	errcode: t.String(),
	error: t.String(),
});

export const mediaPlugin = (app: Elysia) => {
	const mediaService = container.resolve(MediaService);
	const logger = createLogger('MediaController');

	return app.group('/_matrix/media/v3', (app) =>
		app
			.get(
				'/download/:serverName/:mediaId',
				async ({
					params,
					request,
					set,
				}: {
					params: { serverName: string; mediaId: string };
					request: Request;
					set: { status?: number };
				}) => {
					const { serverName, mediaId } = params;
					try {
						const authHeader = request.headers.get('authorization');
						const result = await mediaService.downloadFile(
							serverName,
							mediaId,
							authHeader,
						);

						if ('errcode' in result) {
							if (result.errcode === 'M_MISSING_TOKEN') {
								set.status = 401;
							} else if (result.errcode === 'M_NOT_FOUND') {
								set.status = 404;
							} else if (result.errcode === 'M_UNRECOGNIZED') {
								set.status = 501;
							} else {
								set.status = 502;
							}
							return result;
						}

						return result;
					} catch (error) {
						logger.error('Media download error:', error);
						set.status = 500;
						return {
							errcode: 'M_UNKNOWN',
							error: 'Internal server error',
						};
					}
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
						200: t.Any(),
						401: ErrorResponseSchema,
						404: ErrorResponseSchema,
						500: ErrorResponseSchema,
						501: ErrorResponseSchema,
						502: ErrorResponseSchema,
					},
					detail: {
						tags: ['Media'],
						summary: 'Download media',
						description: 'Download a file from the Matrix media repository',
					},
				},
			)

			.get(
				'/thumbnail/:serverName/:mediaId',
				async ({
					params,
					query,
					set,
				}: {
					params: { serverName: string; mediaId: string };
					query: { width?: number; height?: number; method?: string };
					set: { status?: number };
				}) => {
					try {
						const { serverName, mediaId } = params;
						const { width = 96, height = 96, method = 'scale' } = query;

						const result = await mediaService.getThumbnail(
							serverName,
							mediaId,
							width,
							height,
							method as 'crop' | 'scale',
						);

						if (result.errcode === 'M_NOT_FOUND') {
							set.status = 404;
						} else if (result.errcode === 'M_UNRECOGNIZED') {
							set.status = 501;
						}

						return result;
					} catch (error) {
						logger.error('Media thumbnail error:', error);
						set.status = 500;
						return {
							errcode: 'M_UNKNOWN',
							error: 'Internal server error',
						};
					}
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
						200: t.Any(),
						404: ErrorResponseSchema,
						500: ErrorResponseSchema,
						501: ErrorResponseSchema,
					},
					detail: {
						tags: ['Media'],
						summary: 'Get media thumbnail',
						description: 'Get a thumbnail for a media file',
					},
				},
			)

			.get(
				'/config',
				async ({ set }) => {
					try {
						return mediaService.getMediaConfig();
					} catch (error) {
						logger.error('Media config error:', error);
						set.status = 500;
						return {
							errcode: 'M_UNKNOWN',
							error: 'Internal server error',
						};
					}
				},
				{
					response: {
						200: t.Object({
							'm.upload.size': t.Number(),
						}),
						500: ErrorResponseSchema,
					},
					detail: {
						tags: ['Media'],
						summary: 'Get media configuration',
						description: 'Get the media configuration for the homeserver',
					},
				},
			),
	);
};
