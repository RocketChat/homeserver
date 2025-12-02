import type { EventStore } from '@rocket.chat/federation-core';
import type { PduForType, PduType } from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';

import { AppConfig, ConfigService } from './services/config.service';
import { EduService } from './services/edu.service';
import { EventAuthorizationService } from './services/event-authorization.service';
import { EventService } from './services/event.service';
import { FederationRequestService } from './services/federation-request.service';
import { FederationService } from './services/federation.service';
import { InviteService } from './services/invite.service';
import { MediaService } from './services/media.service';
import { MessageService } from './services/message.service';
import { ProfilesService } from './services/profiles.service';
import { RoomService } from './services/room.service';
import { SendJoinService } from './services/send-join.service';
import { ServerService } from './services/server.service';
import { StateService } from './services/state.service';
import { WellKnownService } from './services/well-known.service';

// create a federation sdk class to export
@singleton()
export class FederationSDK {
	constructor(
		private readonly roomService: RoomService,
		private readonly messageService: MessageService,
		private readonly inviteService: InviteService,
		private readonly eventService: EventService,
		private readonly eduService: EduService,
		private readonly serverService: ServerService,
		private readonly configService: ConfigService,
		private readonly eventAuthorizationService: EventAuthorizationService,
		private readonly stateService: StateService,
		private readonly mediaService: MediaService,
		private readonly profilesService: ProfilesService,
		private readonly sendJoinService: SendJoinService,
		private readonly wellKnownService: WellKnownService,
		private readonly federationRequestService: FederationRequestService,
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

	makeLeave(...args: Parameters<typeof this.roomService.makeLeave>) {
		return this.roomService.makeLeave(...args);
	}

	sendLeave(...args: Parameters<typeof this.roomService.sendLeave>) {
		return this.roomService.sendLeave(...args);
	}

	leaveRoom(...args: Parameters<typeof this.roomService.leaveRoom>) {
		return this.roomService.leaveRoom(...args);
	}

	kickUser(...args: Parameters<typeof this.roomService.kickUser>) {
		return this.roomService.kickUser(...args);
	}

	banUser(...args: Parameters<typeof this.roomService.banUser>) {
		return this.roomService.banUser(...args);
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

	/**
	 * @deprecated
	 */
	joinUser(...args: Parameters<typeof this.roomService.joinUser>) {
		return this.roomService.joinUser(...args);
	}

	acceptInvite(...args: Parameters<typeof this.roomService.acceptInvite>) {
		return this.roomService.acceptInvite(...args);
	}

	rejectInvite(...args: Parameters<typeof this.roomService.rejectInvite>) {
		return this.roomService.rejectInvite(...args);
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
		...args: Parameters<typeof this.eventService.getMissingEvents>
	) {
		return this.eventService.getMissingEvents(...args);
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
