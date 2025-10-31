import 'reflect-metadata';

import crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	type HomeserverEventSignatures,
	federationSDK,
	init,
} from '@rocket.chat/federation-sdk';
import * as dotenv from 'dotenv';

import { swagger } from '@elysiajs/swagger';
import type { Emitter } from '@rocket.chat/emitter';
import Elysia from 'elysia';
import { invitePlugin } from './controllers/federation/invite.controller';
import { mediaPlugin } from './controllers/federation/media.controller';
import { profilesPlugin } from './controllers/federation/profiles.controller';
import { roomPlugin } from './controllers/federation/rooms.controller';
import { sendJoinPlugin } from './controllers/federation/send-join.controller';
import { statePlugin } from './controllers/federation/state.controller';
import { transactionsPlugin } from './controllers/federation/transactions.controller';
import { versionsPlugin } from './controllers/federation/versions.controller';
import { internalDirectMessagePlugin } from './controllers/internal/direct-message.controller';
import { internalRequestPlugin } from './controllers/internal/external-federation-request.controller';
import { internalInvitePlugin } from './controllers/internal/invite.controller';
import { internalMessagePlugin } from './controllers/internal/message.controller';
import { pingPlugin } from './controllers/internal/ping.controller';
import { internalRoomPlugin } from './controllers/internal/room.controller';
import { serverKeyPlugin } from './controllers/key/server.controller';
import { wellKnownPlugin } from './controllers/well-known/well-known.controller';

export type { HomeserverEventSignatures };
export interface HomeserverSetupOptions {
	emitter?: Emitter<HomeserverEventSignatures>;
}

export async function setup() {
	const envPath = path.resolve(process.cwd(), '.env');
	if (fs.existsSync(envPath)) {
		dotenv.config({ path: envPath });
	}

	await init({
		dbConfig: {
			uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/matrix',
			name: process.env.DATABASE_NAME || 'matrix',
			poolSize: Number.parseInt(process.env.DATABASE_POOL_SIZE || '10', 10),
		},
	});

	federationSDK.setConfig({
		instanceId: crypto.randomUUID(),
		serverName: process.env.SERVER_NAME || 'rc1',
		port: Number.parseInt(process.env.SERVER_PORT || '8080', 10),
		matrixDomain: process.env.MATRIX_DOMAIN || 'rc1',
		keyRefreshInterval: Number.parseInt(
			process.env.MATRIX_KEY_REFRESH_INTERVAL || '60',
			10,
		),
		signingKey: process.env.SIGNING_KEY,
		signingKeyPath: process.env.CONFIG_FOLDER || './rc1.signing.key',
		version: process.env.SERVER_VERSION || '1.0',
		// database: {
		// 	uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/matrix',
		// 	name: process.env.DATABASE_NAME || 'matrix',
		// 	poolSize: Number.parseInt(process.env.DATABASE_POOL_SIZE || '10', 10),
		// },
		media: {
			maxFileSize: process.env.MEDIA_MAX_FILE_SIZE
				? Number.parseInt(process.env.MEDIA_MAX_FILE_SIZE, 10) * 1024 * 1024
				: 100 * 1024 * 1024,
			allowedMimeTypes: process.env.MEDIA_ALLOWED_MIME_TYPES?.split(',') || [
				'image/jpeg',
				'image/png',
				'image/gif',
				'image/webp',
				'text/plain',
				'application/pdf',
				'video/mp4',
				'audio/mpeg',
				'audio/ogg',
			],
			enableThumbnails: process.env.MEDIA_ENABLE_THUMBNAILS === 'true' || true,
			rateLimits: {
				uploadPerMinute: Number.parseInt(
					process.env.MEDIA_UPLOAD_RATE_LIMIT || '10',
					10,
				),
				downloadPerMinute: Number.parseInt(
					process.env.MEDIA_DOWNLOAD_RATE_LIMIT || '60',
					10,
				),
			},
		},
		invite: {
			allowedEncryptedRooms:
				process.env.INVITE_ALLOWED_ENCRYPTED_ROOMS === 'true',
			allowedNonPrivateRooms:
				process.env.INVITE_ALLOWED_NON_PRIVATE_ROOMS === 'true',
		},
	});

	const app = new Elysia();

	app
		.use(
			// @ts-ignore - Elysia is not typed correctly
			swagger({
				documentation: {
					info: {
						title: 'Matrix Homeserver API',
						version: '1.0.0',
						description:
							'Matrix Protocol Implementation - Federation and Internal APIs',
					},
				},
			}),
		)
		.use(invitePlugin)
		.use(statePlugin)
		.use(profilesPlugin)
		.use(sendJoinPlugin)
		.use(transactionsPlugin)
		.use(versionsPlugin)
		.use(internalDirectMessagePlugin)
		.use(internalInvitePlugin)
		.use(internalMessagePlugin)
		.use(pingPlugin)
		.use(internalRoomPlugin)
		.use(serverKeyPlugin)
		.use(wellKnownPlugin)
		.use(roomPlugin)
		.use(mediaPlugin)
		.use(internalRequestPlugin);

	return { app };
}

export const appPromise = setup().then(({ app }) => app);

// TODO: Register plugins/handlers for controllers here
// e.g. app.use(profilesPlugin)

// Export app for use in main entry point
