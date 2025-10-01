import { EventBase, createLogger } from '@rocket.chat/federation-core';
import {
	PduForType,
	PersistentEventBase,
	PersistentEventFactory,
	RoomVersion,
} from '@rocket.chat/federation-room';
import { ConfigService } from './config.service';
import { EventService } from './event.service';
import { FederationService } from './federation.service';
import { InviteService } from './invite.service';
import { StateService } from './state.service';

// Mock dependencies
jest.mock('@rocket.chat/federation-core', () => ({
	createLogger: jest.fn(() => ({
		debug: jest.fn(),
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
	})),
}));

jest.mock('@rocket.chat/federation-room', () => ({
	PersistentEventFactory: {
		createFromRawEvent: jest.fn(),
	},
}));

describe('InviteService', () => {
	let inviteService: InviteService;
	let mockEventService: jest.Mocked<EventService>;
	let mockFederationService: jest.Mocked<FederationService>;
	let mockStateService: jest.Mocked<StateService>;
	let mockConfigService: jest.Mocked<ConfigService>;

	const MOCK_SERVER_NAME = 'local-server.com';
	const MOCK_REMOTE_SERVER = 'remote-server.com';
	const MOCK_USER_ID = `@user:${MOCK_REMOTE_SERVER}`;
	const MOCK_LOCAL_USER_ID = `@localuser:${MOCK_SERVER_NAME}`;
	const MOCK_ROOM_ID = `\!room:${MOCK_SERVER_NAME}`;
	const MOCK_SENDER = `@sender:${MOCK_SERVER_NAME}`;
	const MOCK_EVENT_ID = '$event123';
	const MOCK_ROOM_VERSION = '10' as RoomVersion;

	beforeEach(() => {
		// Reset all mocks before each test
		jest.clearAllMocks();

		// Create mock services
		mockEventService = {
			processEvent: jest.fn(),
		} as any;

		mockFederationService = {
			inviteUser: jest.fn(),
			sendEventToAllServersInRoom: jest.fn(),
		} as any;

		mockStateService = {
			getRoomInformation: jest.fn(),
			buildEvent: jest.fn(),
			persistStateEvent: jest.fn(),
			signEvent: jest.fn(),
		} as any;

		mockConfigService = {
			serverName: MOCK_SERVER_NAME,
		} as any;

		// Create service instance with mocked dependencies
		inviteService = new InviteService(
			mockEventService,
			mockFederationService,
			mockStateService,
			mockConfigService,
		);
	});

	describe('inviteUserToRoom', () => {
		describe('Happy Path - Remote User Invitation', () => {
			it('should successfully invite a remote user to a room', async () => {
				// Arrange
				const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					stateKey: MOCK_USER_ID,
					event: {
						type: 'm.room.member',
						content: { membership: 'invite' },
						room_id: MOCK_ROOM_ID,
					},
					rejected: false,
				};
				const mockInviteResponse = {
					event: mockInviteEvent.event,
				};
				const mockPersistentEvent = { ...mockInviteEvent };

				mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
				mockStateService.buildEvent.mockResolvedValue(mockInviteEvent as any);
				mockFederationService.inviteUser.mockResolvedValue(mockInviteResponse as any);
				mockStateService.persistStateEvent.mockResolvedValue(undefined);
				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockPersistentEvent);

				// Act
				const result = await inviteService.inviteUserToRoom(
					MOCK_USER_ID,
					MOCK_ROOM_ID,
					MOCK_SENDER,
					false,
				);

				// Assert
				expect(mockStateService.getRoomInformation).toHaveBeenCalledWith(MOCK_ROOM_ID);
				expect(mockStateService.buildEvent).toHaveBeenCalledWith(
					expect.objectContaining({
						type: 'm.room.member',
						content: { membership: 'invite' },
						room_id: MOCK_ROOM_ID,
						state_key: MOCK_USER_ID,
						sender: MOCK_SENDER,
					}),
					MOCK_ROOM_VERSION,
				);
				expect(mockFederationService.inviteUser).toHaveBeenCalledWith(
					mockInviteEvent,
					MOCK_ROOM_VERSION,
				);
				expect(mockStateService.persistStateEvent).toHaveBeenCalled();
				expect(mockFederationService.sendEventToAllServersInRoom).toHaveBeenCalledWith(mockInviteEvent);
				expect(result).toEqual({
					event_id: MOCK_EVENT_ID,
					event: mockPersistentEvent,
					room_id: MOCK_ROOM_ID,
				});
			});

			it('should extract displayname from userId for direct messages', async () => {
				// Arrange
				const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					stateKey: MOCK_USER_ID,
					event: {},
					rejected: false,
				};
				const mockInviteResponse = { event: mockInviteEvent.event };
				const mockPersistentEvent = { ...mockInviteEvent };

				mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
				mockStateService.buildEvent.mockResolvedValue(mockInviteEvent as any);
				mockFederationService.inviteUser.mockResolvedValue(mockInviteResponse as any);
				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockPersistentEvent);

				// Act
				await inviteService.inviteUserToRoom(MOCK_USER_ID, MOCK_ROOM_ID, MOCK_SENDER, true);

				// Assert
				expect(mockStateService.buildEvent).toHaveBeenCalledWith(
					expect.objectContaining({
						content: expect.objectContaining({
							membership: 'invite',
							is_direct: true,
							displayname: 'user',
						}),
					}),
					MOCK_ROOM_VERSION,
				);
			});

			it('should handle displayname extraction correctly when userId has multiple colons', async () => {
				// Arrange
				const userIdWithMultipleColons = '@user:name:remote-server.com';
				const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					stateKey: userIdWithMultipleColons,
					event: {},
					rejected: false,
				};
				const mockInviteResponse = { event: mockInviteEvent.event };
				const mockPersistentEvent = { ...mockInviteEvent };

				mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
				mockStateService.buildEvent.mockResolvedValue(mockInviteEvent as any);
				mockFederationService.inviteUser.mockResolvedValue(mockInviteResponse as any);
				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockPersistentEvent);

				// Act
				await inviteService.inviteUserToRoom(
					userIdWithMultipleColons,
					MOCK_ROOM_ID,
					MOCK_SENDER,
					true,
				);

				// Assert
				expect(mockStateService.buildEvent).toHaveBeenCalledWith(
					expect.objectContaining({
						content: expect.objectContaining({
							displayname: 'user',
						}),
					}),
					MOCK_ROOM_VERSION,
				);
			});
		});

		describe('Happy Path - Local User Invitation', () => {
			it('should successfully invite a local user to a room', async () => {
				// Arrange
				const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					stateKey: MOCK_LOCAL_USER_ID,
					event: {
						type: 'm.room.member',
						content: { membership: 'invite' },
					},
					rejected: false,
				};
				const mockPersistentEvent = { ...mockInviteEvent };

				mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
				mockStateService.buildEvent.mockResolvedValue(mockInviteEvent as any);
				mockStateService.persistStateEvent.mockResolvedValue(undefined);
				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockPersistentEvent);

				// Act
				const result = await inviteService.inviteUserToRoom(
					MOCK_LOCAL_USER_ID,
					MOCK_ROOM_ID,
					MOCK_SENDER,
					false,
				);

				// Assert
				expect(mockStateService.getRoomInformation).toHaveBeenCalledWith(MOCK_ROOM_ID);
				expect(mockStateService.persistStateEvent).toHaveBeenCalledWith(mockInviteEvent);
				expect(mockFederationService.inviteUser).not.toHaveBeenCalled();
				expect(mockFederationService.sendEventToAllServersInRoom).toHaveBeenCalledWith(mockInviteEvent);
				expect(result).toEqual({
					event_id: MOCK_EVENT_ID,
					event: mockPersistentEvent,
					room_id: MOCK_ROOM_ID,
				});
			});

			it('should not call inviteUser for local server users', async () => {
				// Arrange
				const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					stateKey: MOCK_LOCAL_USER_ID,
					event: {},
					rejected: false,
				};

				mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
				mockStateService.buildEvent.mockResolvedValue(mockInviteEvent as any);
				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);

				// Act
				await inviteService.inviteUserToRoom(
					MOCK_LOCAL_USER_ID,
					MOCK_ROOM_ID,
					MOCK_SENDER,
					false,
				);

				// Assert
				expect(mockFederationService.inviteUser).not.toHaveBeenCalled();
			});
		});

		describe('Edge Cases', () => {
			it('should throw error when state_key has no server part', async () => {
				// Arrange
				const invalidUserId = '@user';
				const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					stateKey: invalidUserId,
					event: {},
				};

				mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
				mockStateService.buildEvent.mockResolvedValue(mockInviteEvent as any);

				// Act & Assert
				await expect(
					inviteService.inviteUserToRoom(invalidUserId, MOCK_ROOM_ID, MOCK_SENDER, false),
				).rejects.toThrow('invalid state_key @user, no server_name part');
			});

			it('should throw error when invite event is rejected for local user', async () => {
				// Arrange
				const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					stateKey: MOCK_LOCAL_USER_ID,
					event: {},
					rejected: true,
					rejectedReason: 'User is banned',
				};

				mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
				mockStateService.buildEvent.mockResolvedValue(mockInviteEvent as any);
				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);

				// Act & Assert
				await expect(
					inviteService.inviteUserToRoom(MOCK_LOCAL_USER_ID, MOCK_ROOM_ID, MOCK_SENDER, false),
				).rejects.toThrow('User is banned');
			});

			it('should handle empty stateKey', async () => {
				// Arrange
				const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					stateKey: '',
					event: {},
				};

				mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
				mockStateService.buildEvent.mockResolvedValue(mockInviteEvent as any);

				// Act & Assert
				await expect(
					inviteService.inviteUserToRoom('', MOCK_ROOM_ID, MOCK_SENDER, false),
				).rejects.toThrow('invalid state_key , no server_name part');
			});

			it('should handle userId without @ prefix for displayname extraction', async () => {
				// Arrange
				const userIdWithoutAt = 'user:remote-server.com';
				const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					stateKey: userIdWithoutAt,
					event: {},
					rejected: false,
				};
				const mockInviteResponse = { event: mockInviteEvent.event };

				mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
				mockStateService.buildEvent.mockResolvedValue(mockInviteEvent as any);
				mockFederationService.inviteUser.mockResolvedValue(mockInviteResponse as any);
				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);

				// Act
				await inviteService.inviteUserToRoom(userIdWithoutAt, MOCK_ROOM_ID, MOCK_SENDER, true);

				// Assert
				expect(mockStateService.buildEvent).toHaveBeenCalledWith(
					expect.objectContaining({
						content: expect.objectContaining({
							displayname: 'user',
						}),
					}),
					MOCK_ROOM_VERSION,
				);
			});

			it('should handle userId with only server part for displayname extraction', async () => {
				// Arrange
				const userIdOnlyServer = ':remote-server.com';
				const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					stateKey: userIdOnlyServer,
					event: {},
					rejected: false,
				};
				const mockInviteResponse = { event: mockInviteEvent.event };

				mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
				mockStateService.buildEvent.mockResolvedValue(mockInviteEvent as any);
				mockFederationService.inviteUser.mockResolvedValue(mockInviteResponse as any);
				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);

				// Act
				await inviteService.inviteUserToRoom(userIdOnlyServer, MOCK_ROOM_ID, MOCK_SENDER, true);

				// Assert
				expect(mockStateService.buildEvent).toHaveBeenCalledWith(
					expect.objectContaining({
						content: expect.objectContaining({
							displayname: '',
						}),
					}),
					MOCK_ROOM_VERSION,
				);
			});
		});

		describe('Failure Conditions', () => {
			it('should propagate error when getRoomInformation fails', async () => {
				// Arrange
				const error = new Error('Room not found');
				mockStateService.getRoomInformation.mockRejectedValue(error);

				// Act & Assert
				await expect(
					inviteService.inviteUserToRoom(MOCK_USER_ID, MOCK_ROOM_ID, MOCK_SENDER, false),
				).rejects.toThrow('Room not found');
			});

			it('should propagate error when buildEvent fails', async () => {
				// Arrange
				const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
				const error = new Error('Failed to build event');
				mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
				mockStateService.buildEvent.mockRejectedValue(error);

				// Act & Assert
				await expect(
					inviteService.inviteUserToRoom(MOCK_USER_ID, MOCK_ROOM_ID, MOCK_SENDER, false),
				).rejects.toThrow('Failed to build event');
			});

			it('should propagate error when inviteUser fails for remote users', async () => {
				// Arrange
				const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					stateKey: MOCK_USER_ID,
					event: {},
				};
				const error = new Error('Federation service error');

				mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
				mockStateService.buildEvent.mockResolvedValue(mockInviteEvent as any);
				mockFederationService.inviteUser.mockRejectedValue(error);

				// Act & Assert
				await expect(
					inviteService.inviteUserToRoom(MOCK_USER_ID, MOCK_ROOM_ID, MOCK_SENDER, false),
				).rejects.toThrow('Federation service error');
			});

			it('should propagate error when persistStateEvent fails for local users', async () => {
				// Arrange
				const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					stateKey: MOCK_LOCAL_USER_ID,
					event: {},
					rejected: false,
				};
				const error = new Error('Failed to persist event');

				mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
				mockStateService.buildEvent.mockResolvedValue(mockInviteEvent as any);
				mockStateService.persistStateEvent.mockRejectedValue(error);

				// Act & Assert
				await expect(
					inviteService.inviteUserToRoom(MOCK_LOCAL_USER_ID, MOCK_ROOM_ID, MOCK_SENDER, false),
				).rejects.toThrow('Failed to persist event');
			});

			it('should propagate error when persistStateEvent fails for remote users', async () => {
				// Arrange
				const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					stateKey: MOCK_USER_ID,
					event: {},
					rejected: false,
				};
				const mockInviteResponse = { event: mockInviteEvent.event };
				const error = new Error('Failed to persist event');

				mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
				mockStateService.buildEvent.mockResolvedValue(mockInviteEvent as any);
				mockFederationService.inviteUser.mockResolvedValue(mockInviteResponse as any);
				mockStateService.persistStateEvent.mockRejectedValue(error);
				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);

				// Act & Assert
				await expect(
					inviteService.inviteUserToRoom(MOCK_USER_ID, MOCK_ROOM_ID, MOCK_SENDER, false),
				).rejects.toThrow('Failed to persist event');
			});
		});

		describe('Integration Behavior', () => {
			it('should call sendEventToAllServersInRoom asynchronously without awaiting', async () => {
				// Arrange
				const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					stateKey: MOCK_LOCAL_USER_ID,
					event: {},
					rejected: false,
				};

				mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
				mockStateService.buildEvent.mockResolvedValue(mockInviteEvent as any);
				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);

				// Make sendEventToAllServersInRoom return a promise that resolves after a delay
				let sendEventPromiseResolved = false;
				mockFederationService.sendEventToAllServersInRoom.mockImplementation(() => {
					return new Promise((resolve) => {
						setTimeout(() => {
							sendEventPromiseResolved = true;
							resolve(undefined);
						}, 100);
					});
				});

				// Act
				await inviteService.inviteUserToRoom(
					MOCK_LOCAL_USER_ID,
					MOCK_ROOM_ID,
					MOCK_SENDER,
					false,
				);

				// Assert - the function should return before sendEventToAllServersInRoom completes
				expect(mockFederationService.sendEventToAllServersInRoom).toHaveBeenCalled();
				expect(sendEventPromiseResolved).toBe(false);
			});

			it('should create PersistentEventBase from raw event using factory', async () => {
				// Arrange
				const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					stateKey: MOCK_LOCAL_USER_ID,
					event: { type: 'm.room.member' },
					rejected: false,
				};
				const mockPersistentEvent = { ...mockInviteEvent, isPersistent: true };

				mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
				mockStateService.buildEvent.mockResolvedValue(mockInviteEvent as any);
				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockPersistentEvent);

				// Act
				const result = await inviteService.inviteUserToRoom(
					MOCK_LOCAL_USER_ID,
					MOCK_ROOM_ID,
					MOCK_SENDER,
					false,
				);

				// Assert
				expect(PersistentEventFactory.createFromRawEvent).toHaveBeenCalledWith(
					mockInviteEvent.event,
					MOCK_ROOM_VERSION,
				);
				expect(result.event).toBe(mockPersistentEvent);
			});
		});
	});

	describe('processInvite', () => {
		const mockEvent: PduForType<'m.room.member'> = {
			type: 'm.room.member',
			content: { membership: 'invite' },
			room_id: MOCK_ROOM_ID,
			state_key: MOCK_USER_ID,
			sender: MOCK_SENDER,
			origin_server_ts: Date.now(),
			event_id: MOCK_EVENT_ID,
		} as any;

		describe('Happy Path - Host Server Processing', () => {
			it('should process invite when this server is the host', async () => {
				// Arrange
				const hostRoomId = `\!room:${MOCK_SERVER_NAME}`;
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					rejected: false,
				};

				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);
				mockStateService.signEvent.mockResolvedValue(undefined);
				mockStateService.persistStateEvent.mockResolvedValue(undefined);

				// Act
				const result = await inviteService.processInvite(
					mockEvent,
					hostRoomId,
					MOCK_EVENT_ID,
					MOCK_ROOM_VERSION,
				);

				// Assert
				expect(PersistentEventFactory.createFromRawEvent).toHaveBeenCalledWith(
					mockEvent,
					MOCK_ROOM_VERSION,
				);
				expect(mockStateService.signEvent).toHaveBeenCalledWith(mockInviteEvent);
				expect(mockStateService.persistStateEvent).toHaveBeenCalledWith(mockInviteEvent);
				expect(result).toBe(mockInviteEvent);
			});

			it('should not send transaction when this server is the host', async () => {
				// Arrange
				const hostRoomId = `\!room:${MOCK_SERVER_NAME}`;
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					rejected: false,
				};

				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);
				mockStateService.signEvent.mockResolvedValue(undefined);
				mockStateService.persistStateEvent.mockResolvedValue(undefined);

				// Act
				await inviteService.processInvite(mockEvent, hostRoomId, MOCK_EVENT_ID, MOCK_ROOM_VERSION);

				// Assert
				expect(mockFederationService.sendEventToAllServersInRoom).not.toHaveBeenCalled();
			});

			it('should throw error if invite event is rejected on host server', async () => {
				// Arrange
				const hostRoomId = `\!room:${MOCK_SERVER_NAME}`;
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					rejected: true,
					rejectedReason: 'User not allowed',
				};

				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);
				mockStateService.signEvent.mockResolvedValue(undefined);

				// Act & Assert
				await expect(
					inviteService.processInvite(mockEvent, hostRoomId, MOCK_EVENT_ID, MOCK_ROOM_VERSION),
				).rejects.toThrow('User not allowed');
			});
		});

		describe('Happy Path - Non-Host Server Processing', () => {
			it('should process invite when this server is not the host but has room state', async () => {
				// Arrange
				const remoteRoomId = `\!room:${MOCK_REMOTE_SERVER}`;
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					rejected: false,
				};
				const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };

				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);
				mockStateService.signEvent.mockResolvedValue(undefined);
				mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
				mockStateService.persistStateEvent.mockResolvedValue(undefined);

				// Act
				const result = await inviteService.processInvite(
					mockEvent,
					remoteRoomId,
					MOCK_EVENT_ID,
					MOCK_ROOM_VERSION,
				);

				// Assert
				expect(mockStateService.getRoomInformation).toHaveBeenCalledWith(remoteRoomId);
				expect(mockStateService.persistStateEvent).toHaveBeenCalledWith(mockInviteEvent);
				expect(result).toBe(mockInviteEvent);
			});

			it('should handle case when server does not have room state', async () => {
				// Arrange
				const remoteRoomId = `\!room:${MOCK_REMOTE_SERVER}`;
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					rejected: false,
				};

				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);
				mockStateService.signEvent.mockResolvedValue(undefined);
				mockStateService.getRoomInformation.mockRejectedValue(new Error('Room state not found'));

				// Spy on console.error
				const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

				// Act
				const result = await inviteService.processInvite(
					mockEvent,
					remoteRoomId,
					MOCK_EVENT_ID,
					MOCK_ROOM_VERSION,
				);

				// Assert
				expect(mockStateService.getRoomInformation).toHaveBeenCalledWith(remoteRoomId);
				expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error));
				expect(mockStateService.persistStateEvent).not.toHaveBeenCalled();
				expect(result).toBe(mockInviteEvent);

				consoleErrorSpy.mockRestore();
			});

			it('should throw error if invite is rejected when server has room state', async () => {
				// Arrange
				const remoteRoomId = `\!room:${MOCK_REMOTE_SERVER}`;
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					rejected: true,
					rejectedReason: 'Invalid signature',
				};
				const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };

				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);
				mockStateService.signEvent.mockResolvedValue(undefined);
				mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);

				// Act & Assert
				await expect(
					inviteService.processInvite(mockEvent, remoteRoomId, MOCK_EVENT_ID, MOCK_ROOM_VERSION),
				).rejects.toThrow('Invalid signature');
			});
		});

		describe('Edge Cases', () => {
			it('should throw error when roomId has no server part', async () => {
				// Arrange
				const invalidRoomId = '\!room';

				// Act & Assert
				await expect(
					inviteService.processInvite(mockEvent, invalidRoomId, MOCK_EVENT_ID, MOCK_ROOM_VERSION),
				).rejects.toThrow('Invalid roomId \!room');
			});

			it('should throw error when eventId does not match', async () => {
				// Arrange
				const wrongEventId = '$wrongevent';
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
				};

				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);

				// Act & Assert
				await expect(
					inviteService.processInvite(mockEvent, MOCK_ROOM_ID, wrongEventId, MOCK_ROOM_VERSION),
				).rejects.toThrow('Invalid eventId $wrongevent');
			});

			it('should handle empty roomId', async () => {
				// Act & Assert
				await expect(
					inviteService.processInvite(mockEvent, '', MOCK_EVENT_ID, MOCK_ROOM_VERSION),
				).rejects.toThrow('Invalid roomId ');
			});

			it('should handle roomId with only server part', async () => {
				// Arrange
				const roomIdOnlyServer = `:${MOCK_SERVER_NAME}`;
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					rejected: false,
				};

				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);
				mockStateService.signEvent.mockResolvedValue(undefined);
				mockStateService.persistStateEvent.mockResolvedValue(undefined);

				// Act
				const result = await inviteService.processInvite(
					mockEvent,
					roomIdOnlyServer,
					MOCK_EVENT_ID,
					MOCK_ROOM_VERSION,
				);

				// Assert - should treat as host server since server name matches
				expect(mockStateService.persistStateEvent).toHaveBeenCalled();
				expect(result).toBe(mockInviteEvent);
			});
		});

		describe('Failure Conditions', () => {
			it('should propagate error when signEvent fails', async () => {
				// Arrange
				const error = new Error('Failed to sign event');
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
				};

				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);
				mockStateService.signEvent.mockRejectedValue(error);

				// Act & Assert
				await expect(
					inviteService.processInvite(mockEvent, MOCK_ROOM_ID, MOCK_EVENT_ID, MOCK_ROOM_VERSION),
				).rejects.toThrow('Failed to sign event');
			});

			it('should propagate error when persistStateEvent fails on host server', async () => {
				// Arrange
				const hostRoomId = `\!room:${MOCK_SERVER_NAME}`;
				const error = new Error('Failed to persist');
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					rejected: false,
				};

				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);
				mockStateService.signEvent.mockResolvedValue(undefined);
				mockStateService.persistStateEvent.mockRejectedValue(error);

				// Act & Assert
				await expect(
					inviteService.processInvite(mockEvent, hostRoomId, MOCK_EVENT_ID, MOCK_ROOM_VERSION),
				).rejects.toThrow('Failed to persist');
			});

			it('should propagate error when PersistentEventFactory.createFromRawEvent fails', async () => {
				// Arrange
				const error = new Error('Failed to create persistent event');
				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockImplementation(() => {
					throw error;
				});

				// Act & Assert
				await expect(
					inviteService.processInvite(mockEvent, MOCK_ROOM_ID, MOCK_EVENT_ID, MOCK_ROOM_VERSION),
				).rejects.toThrow('Failed to create persistent event');
			});
		});

		describe('Integration Behavior', () => {
			it('should sign event before checking if server is host', async () => {
				// Arrange
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					rejected: false,
				};
				const callOrder: string[] = [];

				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);
				mockStateService.signEvent.mockImplementation(async () => {
					callOrder.push('signEvent');
				});
				mockStateService.persistStateEvent.mockImplementation(async () => {
					callOrder.push('persistStateEvent');
				});

				// Act
				await inviteService.processInvite(mockEvent, MOCK_ROOM_ID, MOCK_EVENT_ID, MOCK_ROOM_VERSION);

				// Assert
				expect(callOrder).toEqual(['signEvent', 'persistStateEvent']);
			});

			it('should catch and log errors from getRoomInformation without rethrowing', async () => {
				// Arrange
				const remoteRoomId = `\!room:${MOCK_REMOTE_SERVER}`;
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					rejected: false,
				};
				const error = new Error('Room not found');

				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);
				mockStateService.signEvent.mockResolvedValue(undefined);
				mockStateService.getRoomInformation.mockRejectedValue(error);

				const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

				// Act
				const result = await inviteService.processInvite(
					mockEvent,
					remoteRoomId,
					MOCK_EVENT_ID,
					MOCK_ROOM_VERSION,
				);

				// Assert - should not throw, but should log error
				expect(consoleErrorSpy).toHaveBeenCalledWith(error);
				expect(result).toBe(mockInviteEvent);

				consoleErrorSpy.mockRestore();
			});

			it('should validate eventId matches before signing', async () => {
				// Arrange
				const wrongEventId = '$different';
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
				};

				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);

				// Act & Assert
				await expect(
					inviteService.processInvite(mockEvent, MOCK_ROOM_ID, wrongEventId, MOCK_ROOM_VERSION),
				).rejects.toThrow('Invalid eventId $different');

				// Verify signEvent was never called
				expect(mockStateService.signEvent).not.toHaveBeenCalled();
			});
		});

		describe('Room Version Handling', () => {
			it('should pass correct room version to PersistentEventFactory', async () => {
				// Arrange
				const customRoomVersion = '9' as RoomVersion;
				const mockInviteEvent = {
					eventId: MOCK_EVENT_ID,
					rejected: false,
				};

				(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);
				mockStateService.signEvent.mockResolvedValue(undefined);
				mockStateService.persistStateEvent.mockResolvedValue(undefined);

				// Act
				await inviteService.processInvite(mockEvent, MOCK_ROOM_ID, MOCK_EVENT_ID, customRoomVersion);

				// Assert
				expect(PersistentEventFactory.createFromRawEvent).toHaveBeenCalledWith(
					mockEvent,
					customRoomVersion,
				);
			});
		});
	});

	describe('Logger Integration', () => {
		it('should create logger on service instantiation', () => {
			// Assert
			expect(createLogger).toHaveBeenCalledWith('InviteService');
		});

		it('should log debug message when inviting user', async () => {
			// Arrange
			const mockLogger = (createLogger as jest.Mock).mock.results[0].value;
			const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
			const mockInviteEvent = {
				eventId: MOCK_EVENT_ID,
				stateKey: MOCK_LOCAL_USER_ID,
				event: {},
				rejected: false,
			};

			mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
			mockStateService.buildEvent.mockResolvedValue(mockInviteEvent as any);
			(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);

			// Act
			await inviteService.inviteUserToRoom(MOCK_LOCAL_USER_ID, MOCK_ROOM_ID, MOCK_SENDER, false);

			// Assert
			expect(mockLogger.debug).toHaveBeenCalledWith(
				`Inviting ${MOCK_LOCAL_USER_ID} to room ${MOCK_ROOM_ID}`,
			);
		});
	});

	describe('Type Safety and Contract', () => {
		it('should return correct structure from inviteUserToRoom', async () => {
			// Arrange
			const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
			const mockInviteEvent = {
				eventId: MOCK_EVENT_ID,
				stateKey: MOCK_LOCAL_USER_ID,
				event: { type: 'm.room.member' },
				rejected: false,
			};
			const mockPersistentEvent = { ...mockInviteEvent, isPersistent: true };

			mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
			mockStateService.buildEvent.mockResolvedValue(mockInviteEvent as any);
			(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockPersistentEvent);

			// Act
			const result = await inviteService.inviteUserToRoom(
				MOCK_LOCAL_USER_ID,
				MOCK_ROOM_ID,
				MOCK_SENDER,
				false,
			);

			// Assert
			expect(result).toHaveProperty('event_id');
			expect(result).toHaveProperty('event');
			expect(result).toHaveProperty('room_id');
			expect(typeof result.event_id).toBe('string');
			expect(typeof result.room_id).toBe('string');
		});

		it('should accept all four parameters for inviteUserToRoom', async () => {
			// Arrange
			const mockRoomInformation = { room_version: MOCK_ROOM_VERSION };
			const mockInviteEvent = {
				eventId: MOCK_EVENT_ID,
				stateKey: MOCK_USER_ID,
				event: {},
				rejected: false,
			};

			mockStateService.getRoomInformation.mockResolvedValue(mockRoomInformation);
			mockStateService.buildEvent.mockResolvedValue(mockInviteEvent as any);
			mockFederationService.inviteUser.mockResolvedValue({ event: {} } as any);
			(PersistentEventFactory.createFromRawEvent as jest.Mock).mockReturnValue(mockInviteEvent);

			// Act & Assert - should not throw
			await expect(
				inviteService.inviteUserToRoom(MOCK_USER_ID, MOCK_ROOM_ID, MOCK_SENDER, true),
			).resolves.toBeDefined();

			await expect(
				inviteService.inviteUserToRoom(MOCK_USER_ID, MOCK_ROOM_ID, MOCK_SENDER, false),
			).resolves.toBeDefined();

			// Should work without isDirectMessage parameter (defaults to false)
			await expect(
				inviteService.inviteUserToRoom(MOCK_USER_ID, MOCK_ROOM_ID, MOCK_SENDER),
			).resolves.toBeDefined();
		});
	});
});