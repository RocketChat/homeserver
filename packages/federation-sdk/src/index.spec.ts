/* 
Note on testing framework:
- These tests are authored to run under the repository's existing test runner (Jest or Vitest).
- If running under Vitest, vi is available; under Jest, jest is available.
- We create a small shim so the same test file works in both without adding dependencies.
*/

const testApi = (() => {
  const g: any = globalThis as any;
  if (g.vi) return { spy: g.vi.spyOn.bind(g.vi), mock: g.vi.fn.bind(g.vi), reset: g.vi.resetAllMocks?.bind(g.vi) ?? (() => {}), clear: g.vi.clearAllMocks?.bind(g.vi) ?? (() => {}) };
  if (g.jest) return { spy: g.jest.spyOn.bind(g.jest), mock: g.jest.fn.bind(g.jest), reset: g.jest.resetAllMocks?.bind(g.jest) ?? (() => {}), clear: g.jest.clearAllMocks?.bind(g.jest) ?? (() => {}) };
  throw new Error("No supported test framework detected: expected vi or jest on globalThis.");
})();

import * as Tsyringe from 'tsyringe';

// Import subject under test
import {
  getAllServices,
  // Services we'll assert are resolved
  ConfigService,
  EduService,
  EventAuthorizationService,
  EventService,
  FederationRequestService,
  InviteService,
  MediaService,
  MessageService,
  ProfilesService,
  RoomService,
  SendJoinService,
  ServerService,
  StateService,
  WellKnownService,
  // Selected runtime exports to sanity check re-exports
  FederationModule,
  FederationRequestService as FederationRequestServiceExport,
  FederationService,
  SignatureVerificationService,
  WellKnownService as WellKnownServiceExport,
  DatabaseConnectionService,
  EduService as EduServiceExport,
  ServerService as ServerServiceExport,
  EventAuthorizationService as EventAuthorizationServiceExport,
  EventStateService,
  MissingEventService,
  ProfilesService as ProfilesServiceExport,
  EventFetcherService,
  InviteService as InviteServiceExport,
  MediaService as MediaServiceExport,
  MessageService as MessageServiceExport,
  EventService as EventServiceExport,
  RoomService as RoomServiceExport,
  StateService as StateServiceExport,
  StagingAreaService,
  SendJoinService as SendJoinServiceExport,
  EventEmitterService,
  MissingEventListener,
  // Queues and utils
  BaseQueue,
  getErrorMessage,
  USERNAME_REGEX,
  ROOM_ID_REGEX,
  LockManagerService,
  EventRepository,
  RoomRepository,
  ServerRepository,
  KeyRepository,
  StateRepository,
  StagingAreaListener,
  createFederationContainer,
  DependencyContainer
} from './index';

describe('packages/federation-sdk/src/index.ts public API', () => {
  beforeEach(() => {
    testApi.reset?.();
    testApi.clear?.();
  });

  it('should expose key runtime exports', () => {
    // Modules / classes (existence checks)
    expect(FederationModule).toBeDefined();
    expect(FederationService).toBeDefined();
    expect(SignatureVerificationService).toBeDefined();
    expect(DatabaseConnectionService).toBeDefined();
    expect(EventStateService).toBeDefined();
    expect(MissingEventService).toBeDefined();
    expect(EventFetcherService).toBeDefined();
    expect(StagingAreaService).toBeDefined();
    expect(EventEmitterService).toBeDefined();
    expect(MissingEventListener).toBeDefined();
    expect(StagingAreaListener).toBeDefined();
    // Re-export sanity (aliases point to same runtime)
    expect(WellKnownServiceExport).toBe(WellKnownService);
    expect(EduServiceExport).toBe(EduService);
    expect(ServerServiceExport).toBe(ServerService);
    expect(EventAuthorizationServiceExport).toBe(EventAuthorizationService);
    expect(ProfilesServiceExport).toBe(ProfilesService);
    expect(InviteServiceExport).toBe(InviteService);
    expect(MediaServiceExport).toBe(MediaService);
    expect(MessageServiceExport).toBe(MessageService);
    expect(EventServiceExport).toBe(EventService);
    expect(RoomServiceExport).toBe(RoomService);
    expect(StateServiceExport).toBe(StateService);
    expect(SendJoinServiceExport).toBe(SendJoinService);
    // Utils and constants
    expect(typeof getErrorMessage).toBe('function');
    expect(USERNAME_REGEX).toBeInstanceOf(RegExp);
    expect(ROOM_ID_REGEX).toBeInstanceOf(RegExp);
    // Queues / Base types
    expect(BaseQueue).toBeDefined();
    // Container helpers
    expect(createFederationContainer).toBeDefined();
    expect(DependencyContainer).toBeDefined();
    // Repositories
    expect(EventRepository).toBeDefined();
    expect(RoomRepository).toBeDefined();
    expect(ServerRepository).toBeDefined();
    expect(KeyRepository).toBeDefined();
    expect(StateRepository).toBeDefined();
    // Additional runtime export check
    expect(FederationRequestServiceExport).toBe(FederationRequestService);
  });

  describe('getAllServices()', () => {
    function makeMockInstances() {
      // Unique objects to ensure identity mapping
      return {
        room: { name: 'room' },
        message: { name: 'message' },
        media: { name: 'media' },
        event: { name: 'event' },
        invite: { name: 'invite' },
        wellKnown: { name: 'wellKnown' },
        profile: { name: 'profile' },
        state: { name: 'state' },
        sendJoin: { name: 'sendJoin' },
        server: { name: 'server' },
        config: { name: 'config' },
        edu: { name: 'edu' },
        request: { name: 'request' },
        federationAuth: { name: 'federationAuth' },
      } as const;
    }

    function arrangeContainerResolveMock(instances: ReturnType<typeof makeMockInstances>) {
      // Spy on container.resolve and route by token
      const spy = testApi.spy(Tsyringe, 'container', 'get'); // Not available; fallback approach below
      // In environments where spying on "container.resolve" directly is easier:
      const resolveSpy = testApi.spy(Tsyringe.container as any, 'resolve');
      (Tsyringe.container.resolve as unknown as jest.Mock | ((...args:any[])=>any)).mockImplementation((cls: any) => {
        switch (cls) {
          case RoomService: return instances.room;
          case MessageService: return instances.message;
          case MediaService: return instances.media;
          case EventService: return instances.event;
          case InviteService: return instances.invite;
          case WellKnownService: return instances.wellKnown;
          case ProfilesService: return instances.profile;
          case StateService: return instances.state;
          case SendJoinService: return instances.sendJoin;
          case ServerService: return instances.server;
          case ConfigService: return instances.config;
          case EduService: return instances.edu;
          case FederationRequestService: return instances.request;
          case EventAuthorizationService: return instances.federationAuth;
          default:
            throw new Error('Unexpected token passed to container.resolve');
        }
      });
      return resolveSpy;
    }

    it('returns a mapping of all services resolved from tsyringe container', () => {
      const instances = makeMockInstances();
      const resolveSpy = arrangeContainerResolveMock(instances);

      const result = getAllServices();

      // ensure resolve called for each service token exactly once
      const expectedTokens = [
        RoomService,
        MessageService,
        MediaService,
        EventService,
        InviteService,
        WellKnownService,
        ProfilesService,
        StateService,
        SendJoinService,
        ServerService,
        ConfigService,
        EduService,
        FederationRequestService,
        EventAuthorizationService,
      ];
      for (const token of expectedTokens) {
        expect(resolveSpy).toHaveBeenCalledWith(token);
      }
      expect(resolveSpy).toHaveBeenCalledTimes(expectedTokens.length);

      // result shape and identity
      expect(result).toEqual(instances);
      // identity checks
      expect(result.room).toBe(instances.room);
      expect(result.federationAuth).toBe(instances.federationAuth);
    });

    it('propagates errors thrown by container.resolve', () => {
      const error = new Error('boom');
      const resolveSpy = testApi.spy(Tsyringe.container as any, 'resolve');
      (Tsyringe.container.resolve as unknown as jest.Mock | ((...args:any[])=>any)).mockImplementation((cls: any) => {
        if (cls === RoomService) throw error;
        return {};
      });

      expect(() => getAllServices()).toThrow(error);
      expect(resolveSpy).toHaveBeenCalledWith(RoomService);
    });

    it('resolves fresh instances on each call (no shared object reuse by function wrapper)', () => {
      const first = { name: 'first' };
      const second = { name: 'second' };
      const resolveSpy = testApi.spy(Tsyringe.container as any, 'resolve');
      let call = 0;
      (Tsyringe.container.resolve as unknown as jest.Mock | ((...args:any[])=>any)).mockImplementation((cls: any) => {
        // Return different objects for room per call to ensure we call container each time
        if (cls === RoomService) {
          call += 1;
          return call === 1 ? first : second;
        }
        return {};
      });

      const a = getAllServices();
      const b = getAllServices();
      expect(a.room).toBe(first);
      expect(b.room).toBe(second);
      expect(resolveSpy).toHaveBeenCalledWith(RoomService);
      expect(resolveSpy).toHaveBeenCalledTimes(2 + 2 * 13); // 14 tokens per call; soft check below to be resilient

      // Soft assertion: exactly 14 calls per invocation
      const callsPerInvocation = 14;
      expect((resolveSpy as any).mock.calls.length % callsPerInvocation).toBe(0);
    });
  });
});