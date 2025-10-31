import { delay, inject, singleton } from 'tsyringe';
import type { PduType, PduForType } from '@rocket.chat/federation-room';
import type { EventStore } from '@rocket.chat/federation-core';

import { RoomService } from './services/room.service';
import { MessageService } from './services/message.service';
import { InviteService } from './services/invite.service';
import { EventService } from './services/event.service';
import { EduService } from './services/edu.service';
import { ServerService } from './services/server.service';
import { AppConfig, ConfigService } from './services/config.service';
import { EventAuthorizationService } from './services/event-authorization.service';
import { StateService } from './services/state.service';
import { MediaService } from './services/media.service';
import { ProfilesService } from './services/profiles.service';
import { SendJoinService } from './services/send-join.service';
import { WellKnownService } from './services/well-known.service';
import { FederationRequestService } from './services/federation-request.service';
import { FederationService } from './services/federation.service';

// create a federation sdk class to export
@singleton()
export class FederationSDK {
	constructor(
		@inject(delay(() => RoomService)) private readonly roomService: RoomService,
		@inject(delay(() => MessageService))
		private readonly messageService: MessageService,
		@inject(delay(() => InviteService))
		private readonly inviteService: InviteService,
		@inject(delay(() => EventService))
		private readonly eventService: EventService,
		@inject(delay(() => EduService)) private readonly eduService: EduService,
		@inject(delay(() => ServerService))
		private readonly serverService: ServerService,
		private readonly configService: ConfigService,
		@inject(delay(() => EventAuthorizationService))
		private readonly eventAuthorizationService: EventAuthorizationService,
		@inject(delay(() => StateService))
		private readonly stateService: StateService,
		private readonly mediaService: MediaService,
		@inject(delay(() => ProfilesService))
		private readonly profilesService: ProfilesService,
		@inject(delay(() => SendJoinService))
		private readonly sendJoinService: SendJoinService,
		private readonly wellKnownService: WellKnownService,
		private readonly federationRequestService: FederationRequestService,
		@inject(delay(() => FederationService))
		private readonly federationService: FederationService,
	) {}

	createDirectMessageRoom(
		...args: Parameters<typeof this.roomService.createDirectMessageRoom>
	) {
		return this.roomService.createDirectMessageRoom(...args);
	}

	createRoom(...args: Parameters<typeof this.roomService.createRoom>) {
		return this.roomService.createRoom(...args);
	}

	inviteUserToRoom(
		...args: Parameters<typeof this.inviteService.inviteUserToRoom>
	) {
		return this.inviteService.inviteUserToRoom(...args);
	}

	sendFileMessage(
		...args: Parameters<typeof this.messageService.sendFileMessage>
	) {
		return this.messageService.sendFileMessage(...args);
	}

	sendMessage(...args: Parameters<typeof this.messageService.sendMessage>) {
		return this.messageService.sendMessage(...args);
	}

	redactMessage(...args: Parameters<typeof this.messageService.redactMessage>) {
		return this.messageService.redactMessage(...args);
	}

	sendReaction(...args: Parameters<typeof this.messageService.sendReaction>) {
		return this.messageService.sendReaction(...args);
	}

	unsetReaction(...args: Parameters<typeof this.messageService.unsetReaction>) {
		return this.messageService.unsetReaction(...args);
	}

	getEventById<T extends PduType, P extends EventStore<PduForType<T>>>(
		...args: Parameters<typeof this.eventService.getEventById>
	): Promise<P | null> {
		return this.eventService.getEventById(...args);
	}

	leaveRoom(...args: Parameters<typeof this.roomService.leaveRoom>) {
		return this.roomService.leaveRoom(...args);
	}

	kickUser(...args: Parameters<typeof this.roomService.kickUser>) {
		return this.roomService.kickUser(...args);
	}

	updateMessage(...args: Parameters<typeof this.messageService.updateMessage>) {
		return this.messageService.updateMessage(...args);
	}

	updateRoomName(...args: Parameters<typeof this.roomService.updateRoomName>) {
		return this.roomService.updateRoomName(...args);
	}

	setRoomTopic(...args: Parameters<typeof this.roomService.setRoomTopic>) {
		return this.roomService.setRoomTopic(...args);
	}

	setPowerLevelForUser(
		...args: Parameters<typeof this.roomService.setPowerLevelForUser>
	) {
		return this.roomService.setPowerLevelForUser(...args);
	}

	sendTypingNotification(
		...args: Parameters<typeof this.eduService.sendTypingNotification>
	) {
		return this.eduService.sendTypingNotification(...args);
	}

	getSignedServerKey(
		...args: Parameters<typeof this.serverService.getSignedServerKey>
	) {
		return this.serverService.getSignedServerKey(...args);
	}

	getConfig<K extends keyof AppConfig>(config: K): AppConfig[K] {
		return this.configService.getConfig(config);
	}

	processInvite(...args: Parameters<typeof this.inviteService.processInvite>) {
		return this.inviteService.processInvite(...args);
	}

	verifyRequestSignature(
		...args: Parameters<
			typeof this.eventAuthorizationService.verifyRequestSignature
		>
	) {
		return this.eventAuthorizationService.verifyRequestSignature(...args);
	}

	joinUser(...args: Parameters<typeof this.roomService.joinUser>) {
		return this.roomService.joinUser(...args);
	}

	getLatestRoomState2(
		...args: Parameters<typeof this.stateService.getLatestRoomState2>
	) {
		return this.stateService.getLatestRoomState2(...args);
	}

	downloadFromRemoteServer(
		...args: Parameters<typeof this.mediaService.downloadFromRemoteServer>
	) {
		return this.mediaService.downloadFromRemoteServer(...args);
	}

	queryProfile(...args: Parameters<typeof this.profilesService.queryProfile>) {
		return this.profilesService.queryProfile(...args);
	}

	getAllPublicRoomIdsAndNames(
		...args: Parameters<typeof this.stateService.getAllPublicRoomIdsAndNames>
	) {
		return this.stateService.getAllPublicRoomIdsAndNames(...args);
	}

	sendJoin(...args: Parameters<typeof this.sendJoinService.sendJoin>) {
		return this.sendJoinService.sendJoin(...args);
	}

	processIncomingTransaction(
		...args: Parameters<typeof this.eventService.processIncomingTransaction>
	) {
		return this.eventService.processIncomingTransaction(...args);
	}

	getStateIds(...args: Parameters<typeof this.eventService.getStateIds>) {
		return this.eventService.getStateIds(...args);
	}

	getState(...args: Parameters<typeof this.eventService.getState>) {
		return this.eventService.getState(...args);
	}

	getBackfillEvents(
		...args: Parameters<typeof this.eventService.getBackfillEvents>
	) {
		return this.eventService.getBackfillEvents(...args);
	}

	canAccessResource(
		...args: Parameters<typeof this.eventAuthorizationService.canAccessResource>
	) {
		return this.eventAuthorizationService.canAccessResource(...args);
	}

	getWellKnownHostData(
		...args: Parameters<typeof this.wellKnownService.getWellKnownHostData>
	) {
		return this.wellKnownService.getWellKnownHostData(...args);
	}

	updateUserPowerLevel(
		...args: Parameters<typeof this.roomService.updateUserPowerLevel>
	) {
		return this.roomService.updateUserPowerLevel(...args);
	}

	findStateAtEvent(
		...args: Parameters<typeof this.stateService.findStateAtEvent>
	) {
		return this.stateService.findStateAtEvent(...args);
	}

	getLatestRoomState(
		...args: Parameters<typeof this.stateService.getLatestRoomState>
	) {
		return this.stateService.getLatestRoomState(...args);
	}

	handlePdu(...args: Parameters<typeof this.stateService.handlePdu>) {
		return this.stateService.handlePdu(...args);
	}

	markRoomAsTombstone(
		...args: Parameters<typeof this.roomService.markRoomAsTombstone>
	) {
		return this.roomService.markRoomAsTombstone(...args);
	}

	getAllRoomIds(...args: Parameters<typeof this.stateService.getAllRoomIds>) {
		return this.stateService.getAllRoomIds(...args);
	}

	makeSignedRequest(
		...args: Parameters<typeof this.federationRequestService.makeSignedRequest>
	) {
		return this.federationRequestService.makeSignedRequest(...args);
	}

	queryProfileRemote<T>({
		homeserverUrl,
		userId,
	}: { homeserverUrl: string; userId: string }) {
		return this.federationRequestService.get<T>(
			homeserverUrl,
			'/_matrix/federation/v1/query/profile',
			{ user_id: userId },
		);
	}

	buildEvent<T extends PduType>(
		...args: Parameters<typeof this.stateService.buildEvent<T>>
	) {
		return this.stateService.buildEvent<T>(...args);
	}

	sendEventToAllServersInRoom(
		...args: Parameters<
			typeof this.federationService.sendEventToAllServersInRoom
		>
	) {
		return this.federationService.sendEventToAllServersInRoom(...args);
	}

	makeJoin(...args: Parameters<typeof this.profilesService.makeJoin>) {
		return this.profilesService.makeJoin(...args);
	}

	getMissingEvents(
		...args: Parameters<typeof this.profilesService.getMissingEvents>
	) {
		return this.profilesService.getMissingEvents(...args);
	}

	eventAuth(...args: Parameters<typeof this.profilesService.eventAuth>) {
		return this.profilesService.eventAuth(...args);
	}

	setConfig(...args: Parameters<typeof this.configService.setConfig>) {
		return this.configService.setConfig(...args);
	}

	queryKeys(...args: Parameters<typeof this.profilesService.queryKeys>) {
		return this.profilesService.queryKeys(...args);
	}

	sendPresenceUpdateToRooms(
		...args: Parameters<typeof this.eduService.sendPresenceUpdateToRooms>
	) {
		return this.eduService.sendPresenceUpdateToRooms(...args);
	}
}
