import { container } from 'tsyringe';
import type { RouteDefinition } from '../../types/route.types';
import {
	type ErrorResponse,
	type InternalBanUserResponse,
	type InternalCreateRoomResponse,
	type InternalKickUserResponse,
	type InternalLeaveRoomResponse,
	type InternalTombstoneRoomResponse,
	type InternalUpdateRoomNameResponse,
	type InternalUpdateUserPowerLevelResponse,
	ErrorResponseDto,
	InternalBanUserBodyDto,
	InternalBanUserParamsDto,
	InternalCreateRoomBodyDto,
	InternalCreateRoomResponseDto,
	InternalKickUserBodyDto,
	InternalKickUserParamsDto,
	InternalLeaveRoomBodyDto,
	InternalLeaveRoomParamsDto,
	InternalRoomEventResponseDto,
	InternalTombstoneRoomBodyDto,
	InternalTombstoneRoomParamsDto,
	InternalTombstoneRoomResponseDto,
	InternalUpdateRoomNameBodyDto,
	InternalUpdateRoomNameParamsDto,
	InternalUpdateUserPowerLevelBodyDto,
	InternalUpdateUserPowerLevelParamsDto,
	RoomIdDto,
	UsernameDto,
} from '../../dtos';
import { RoomService } from '../../services/room.service';
import { PersistentEventFactory } from '@hs/room/src/manager/factory';
import { StateService } from '../../services/state.service';
import type { PduCreateEventContent } from '@hs/room/src/types/v1';

export const roomRoutes: RouteDefinition[] = [
	{
		method: 'POST',
		path: '/internal/rooms/rooms',
		handler: async (ctx) => {
			const roomService = container.resolve(RoomService);
			const { username, sender, name, canonical_alias, alias } = ctx.body;
			return roomService.createRoom(
				username,
				sender,
				name,
				canonical_alias,
				alias,
			);
		},
		validation: {
			body: InternalCreateRoomBodyDto,
		},
		responses: {
			200: InternalCreateRoomResponseDto,
			400: ErrorResponseDto,
		},
		metadata: {
			tags: ['Internal'],
			summary: 'Create a room',
			description: 'Create a room',
		},
	},
	{
		method: 'PUT',
		path: '/internal/rooms/:roomId/name',
		handler: async (ctx) => {
			const roomService = container.resolve(RoomService);
			const { name, senderUserId, targetServer } = ctx.body;
			return roomService.updateRoomName(
				ctx.params.roomId,
				name,
				senderUserId,
				targetServer,
			);
		},
		validation: {
			params: InternalUpdateRoomNameParamsDto,
			body: InternalUpdateRoomNameBodyDto,
		},
		responses: {
			200: InternalRoomEventResponseDto,
			400: ErrorResponseDto,
		},
		metadata: {
			tags: ['Internal'],
			summary: 'Update a room name',
			description: 'Update a room name',
		},
	},
	{
		method: 'PUT',
		path: '/internal/rooms/:roomId/permissions/:userId',
		handler: async (ctx) => {
			const roomService = container.resolve(RoomService);
			const { senderUserId, powerLevel, targetServers } = ctx.body;
			try {
				const eventId = await roomService.updateUserPowerLevel(
					ctx.params.roomId,
					ctx.params.userId,
					powerLevel,
					senderUserId,
					targetServers,
				);
				return { eventId };
			} catch (error) {
				ctx.setStatus(500);
				return {
					error: `Failed to update user power level: ${error instanceof Error ? error.message : String(error)}`,
					details: {},
				};
			}
		},
		validation: {
			params: InternalUpdateUserPowerLevelParamsDto,
			body: InternalUpdateUserPowerLevelBodyDto,
		},
		responses: {
			200: InternalRoomEventResponseDto,
			400: ErrorResponseDto,
		},
		metadata: {
			tags: ['Internal'],
			summary: 'Update a user power level',
			description: 'Update a user power level',
		},
	},
	{
		method: 'PUT',
		path: '/internal/rooms/:roomId/leave',
		handler: async (ctx) => {
			const roomService = container.resolve(RoomService);
			const { senderUserId, targetServers } = ctx.body;
			try {
				const eventId = await roomService.leaveRoom(
					ctx.params.roomId,
					senderUserId,
					targetServers,
				);
				return { eventId };
			} catch (error) {
				ctx.setStatus(500);
				return {
					error: `Failed to leave room: ${error instanceof Error ? error.message : String(error)}`,
					details: {},
				};
			}
		},
		validation: {
			params: InternalLeaveRoomParamsDto,
			body: InternalLeaveRoomBodyDto,
		},
		responses: {
			200: InternalRoomEventResponseDto,
			400: ErrorResponseDto,
		},
		metadata: {
			tags: ['Internal'],
			summary: 'Leave a room',
			description: 'Leave a room',
		},
	},
	{
		method: 'PUT',
		path: '/internal/rooms/:roomId/kick/:memberId',
		handler: async (ctx) => {
			const roomService = container.resolve(RoomService);
			const { senderUserId, reason, targetServers } = ctx.body;
			try {
				const eventId = await roomService.kickUser(
					ctx.params.roomId,
					ctx.params.memberId,
					senderUserId,
					reason,
					targetServers,
				);
				return { eventId };
			} catch (error) {
				ctx.setStatus(500);
				return {
					error: `Failed to kick user: ${error instanceof Error ? error.message : String(error)}`,
					details: {},
				};
			}
		},
		validation: {
			params: InternalKickUserParamsDto,
			body: InternalKickUserBodyDto,
		},
		responses: {
			200: InternalRoomEventResponseDto,
			400: ErrorResponseDto,
		},
		metadata: {
			tags: ['Internal'],
			summary: 'Kick a user from a room',
			description: 'Kick a user from a room',
		},
	},
	{
		method: 'PUT',
		path: '/internal/rooms/:roomId/ban/:userIdToBan',
		handler: async (ctx) => {
			const roomService = container.resolve(RoomService);
			const { senderUserId, reason, targetServers } = ctx.body;
			try {
				const eventId = await roomService.banUser(
					ctx.params.roomId,
					ctx.params.userIdToBan,
					senderUserId,
					reason,
					targetServers,
				);
				return { eventId };
			} catch (error) {
				ctx.setStatus(500);
				return {
					error: `Failed to ban user: ${error instanceof Error ? error.message : String(error)}`,
					details: {},
				};
			}
		},
		validation: {
			params: InternalBanUserParamsDto,
			body: InternalBanUserBodyDto,
		},
		responses: {
			200: InternalRoomEventResponseDto,
			400: ErrorResponseDto,
		},
		metadata: {
			tags: ['Internal'],
			summary: 'Ban a user from a room',
			description: 'Ban a user from a room',
		},
	},
	{
		method: 'PUT',
		path: '/internal/rooms/:roomId/tombstone',
		handler: async (ctx) => {
			const roomService = container.resolve(RoomService);
			return roomService.markRoomAsTombstone(
				ctx.params.roomId,
				ctx.body.sender,
				ctx.body.reason,
				ctx.body.replacementRoomId,
			);
		},
		validation: {
			params: InternalTombstoneRoomParamsDto,
			body: InternalTombstoneRoomBodyDto,
		},
		responses: {
			200: InternalTombstoneRoomResponseDto,
			400: ErrorResponseDto,
		},
		metadata: {
			tags: ['Internal'],
			summary: 'Tombstone a room',
			description: 'Tombstone a room',
		},
	},
	{
		method: 'GET',
		path: '/internal/rooms/all',
		handler: async () => {
			const stateService = container.resolve(StateService);
			const roomIds = await stateService.getAllRoomIds();
			return {
				roomIds,
			};
		},
	},
	{
		method: 'GET',
		path: '/internal/rooms/all/public',
		handler: async () => {
			const stateService = container.resolve(StateService);
			const state = await stateService.getAllPublicRoomIdsAndNames();
			return {
				state,
			};
		},
	},
];
