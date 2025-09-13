import path from 'node:path';

jest.mock('node:fs', () => ({
  existsSync: jest.fn(() => false),
}));

// Mock dotenv to prevent reading real env
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Capture plugin functions to assert order of registration
const swaggerPluginFn = jest.fn((app: any) => app);
jest.mock('@elysiajs/swagger', () => ({
  swagger: jest.fn(() => swaggerPluginFn),
}));

// Provide a lightweight Elysia mock that records .use calls
const useCalls: any[] = [];
class ElysiaMock {
  used: any[] = useCalls;
  use(fn: any) {
    this.used.push(fn);
    return this;
  }
}
jest.mock('elysia', () => ({
  __esModule: true,
  default: ElysiaMock,
}));

// Mock all internal plugin modules with identifiable functions
const makePlugin = (name: string) => {
  const plugin = Object.defineProperty(jest.fn((app: any) => app), 'name', { value: name });
  return plugin;
};

const invitePlugin = makePlugin('invitePlugin');
const profilesPlugin = makePlugin('profilesPlugin');
const roomPlugin = makePlugin('roomPlugin');
const sendJoinPlugin = makePlugin('sendJoinPlugin');
const transactionsPlugin = makePlugin('transactionsPlugin');
const versionsPlugin = makePlugin('versionsPlugin');
const internalDirectMessagePlugin = makePlugin('internalDirectMessagePlugin');
const internalInvitePlugin = makePlugin('internalInvitePlugin');
const internalMessagePlugin = makePlugin('internalMessagePlugin');
const pingPlugin = makePlugin('pingPlugin');
const internalRoomPlugin = makePlugin('internalRoomPlugin');
const serverKeyPlugin = makePlugin('serverKeyPlugin');
const wellKnownPlugin = makePlugin('wellKnownPlugin');

jest.mock('../../src/controllers/federation/invite.controller', () => ({ invitePlugin }));
jest.mock('../../src/controllers/federation/profiles.controller', () => ({ profilesPlugin }));
jest.mock('../../src/controllers/federation/rooms.controller', () => ({ roomPlugin }));
jest.mock('../../src/controllers/federation/send-join.controller', () => ({ sendJoinPlugin }));
jest.mock('../../src/controllers/federation/transactions.controller', () => ({ transactionsPlugin }));
jest.mock('../../src/controllers/federation/versions.controller', () => ({ versionsPlugin }));
jest.mock('../../src/controllers/internal/direct-message.controller', () => ({ internalDirectMessagePlugin }));
jest.mock('../../src/controllers/internal/invite.controller', () => ({ internalInvitePlugin }));
jest.mock('../../src/controllers/internal/message.controller', () => ({ internalMessagePlugin }));
jest.mock('../../src/controllers/internal/ping.controller', () => ({ pingPlugin }));
jest.mock('../../src/controllers/internal/room.controller', () => ({ internalRoomPlugin }));
jest.mock('../../src/controllers/key/server.controller', () => ({ serverKeyPlugin }));
jest.mock('../../src/controllers/well-known/well-known.controller', () => ({ wellKnownPlugin }));

// Mock federation SDK: capture config options constructed and container options passed in
const createFederationContainerMock = jest.fn(async (_opts: any, _config: any) => ({ mockContainer: true, _opts, _config }));
class MockConfigService {
  public options: any;
  constructor(opts: any) {
    this.options = opts;
  }
}
jest.mock('@hs/federation-sdk', () => ({
  ConfigService: MockConfigService,
  createFederationContainer: createFederationContainerMock,
}));

// Import after mocks are set up
import { setup, appPromise } from '../homeserver.module.spec';
import * as fs from 'node:fs';
import * as dotenv from 'dotenv';
import { swagger } from '@elysiajs/swagger';
import type { Emitter } from '@rocket.chat/emitter';

describe('homeserver.module setup', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    (useCalls as any[]).length = 0;
    process.env = { ...ORIGINAL_ENV }; // shallow clone
    delete process.env.SERVER_NAME;
    delete process.env.SERVER_PORT;
    delete process.env.MONGODB_URI;
    delete process.env.DATABASE_NAME;
    delete process.env.DATABASE_POOL_SIZE;
    delete process.env.MATRIX_DOMAIN;
    delete process.env.MATRIX_KEY_REFRESH_INTERVAL;
    delete process.env.CONFIG_FOLDER;
    delete process.env.SERVER_VERSION;
    delete process.env.MEDIA_MAX_FILE_SIZE;
    delete process.env.MEDIA_ALLOWED_MIME_TYPES;
    delete process.env.MEDIA_ENABLE_THUMBNAILS;
    delete process.env.MEDIA_UPLOAD_RATE_LIMIT;
    delete process.env.MEDIA_DOWNLOAD_RATE_LIMIT;
    (fs.existsSync as jest.Mock).mockReturnValue(false);
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('loads .env when present using dotenv.config with correct path', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const cwdEnvPath = path.resolve(process.cwd(), '.env');

    const result = await setup();

    expect(result).toHaveProperty('app');
    expect(result).toHaveProperty('container');
    expect(dotenv.config).toHaveBeenCalledWith({ path: cwdEnvPath });
  });

  it('does not call dotenv.config when .env is absent', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    await setup();

    expect(dotenv.config).not.toHaveBeenCalled();
  });

  it('constructs ConfigService with default values when env not set', async () => {
    await setup();

    // Config instance is passed as the 2nd arg to createFederationContainer
    expect(createFederationContainerMock).toHaveBeenCalledTimes(1);
    const passedConfig = createFederationContainerMock.mock.calls[0][1] as MockConfigService;
    expect(passedConfig).toBeInstanceOf(MockConfigService);

    // Validate critical defaults
    expect(passedConfig.options.serverName).toBe('rc1');
    expect(passedConfig.options.port).toBe(8080);
    expect(passedConfig.options.database).toEqual({
      uri: 'mongodb://localhost:27017/matrix',
      name: 'matrix',
      poolSize: 10,
    });
    expect(passedConfig.options.matrixDomain).toBe('rc1');
    expect(passedConfig.options.keyRefreshInterval).toBe(60);
    expect(passedConfig.options.signingKeyPath).toBe('./rc1.signing.key');
    expect(passedConfig.options.version).toBe('1.0');
    expect(passedConfig.options.media.maxFileSize).toBe(100 * 1024 * 1024);
    expect(passedConfig.options.media.allowedMimeTypes).toEqual([
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'text/plain',
      'application/pdf',
      'video/mp4',
      'audio/mpeg',
      'audio/ogg',
    ]);
    // Notice: code uses (env === 'true') || true, which always evaluates to true
    expect(passedConfig.options.media.enableThumbnails).toBe(true);
    expect(passedConfig.options.media.rateLimits).toEqual({
      uploadPerMinute: 10,
      downloadPerMinute: 60,
    });
  });

  it('respects environment variables for configuration', async () => {
    process.env.SERVER_NAME = 'example';
    process.env.SERVER_PORT = '9090';
    process.env.MONGODB_URI = 'mongodb://db:27017/hs';
    process.env.DATABASE_NAME = 'hs';
    process.env.DATABASE_POOL_SIZE = '42';
    process.env.MATRIX_DOMAIN = 'example.org';
    process.env.MATRIX_KEY_REFRESH_INTERVAL = '120';
    process.env.CONFIG_FOLDER = '/etc/hs/sign.key';
    process.env.SERVER_VERSION = '2.1.5';
    process.env.MEDIA_MAX_FILE_SIZE = '5';
    process.env.MEDIA_ALLOWED_MIME_TYPES = 'image/jpeg,application/json';
    process.env.MEDIA_ENABLE_THUMBNAILS = 'false'; // code still ORs with true
    process.env.MEDIA_UPLOAD_RATE_LIMIT = '7';
    process.env.MEDIA_DOWNLOAD_RATE_LIMIT = '99';

    await setup();

    const passedConfig = createFederationContainerMock.mock.calls[0][1] as MockConfigService;

    expect(passedConfig.options.serverName).toBe('example');
    expect(passedConfig.options.port).toBe(9090);
    expect(passedConfig.options.database).toEqual({
      uri: 'mongodb://db:27017/hs',
      name: 'hs',
      poolSize: 42,
    });
    expect(passedConfig.options.matrixDomain).toBe('example.org');
    expect(passedConfig.options.keyRefreshInterval).toBe(120);
    expect(passedConfig.options.signingKeyPath).toBe('/etc/hs/sign.key');
    expect(passedConfig.options.version).toBe('2.1.5');
    // 5 MiB converted to bytes
    expect(passedConfig.options.media.maxFileSize).toBe(5 * 1024 * 1024);
    expect(passedConfig.options.media.allowedMimeTypes).toEqual(['image/jpeg', 'application/json']);
    expect(passedConfig.options.media.enableThumbnails).toBe(true); // due to "=== 'true' || true" in source
    expect(passedConfig.options.media.rateLimits).toEqual({
      uploadPerMinute: 7,
      downloadPerMinute: 99,
    });
  });

  it('passes emitter via containerOptions to createFederationContainer', async () => {
    const emitter: Partial<Emitter<any>> = { on: jest.fn(), emit: jest.fn() };
    await setup({ emitter: emitter as any });

    expect(createFederationContainerMock).toHaveBeenCalledTimes(1);
    const containerOpts = createFederationContainerMock.mock.calls[0][0];
    expect(containerOpts).toEqual({ emitter });
  });

  it('registers swagger and internal/federation plugins in correct order', async () => {
    await setup();

    // swagger(...) called once and returns swaggerPluginFn
    expect(swagger).toHaveBeenCalledTimes(1);
    expect(useCalls[0]).toBe(swaggerPluginFn);

    const expectedOrder = [
      swaggerPluginFn,
      invitePlugin,
      profilesPlugin,
      sendJoinPlugin,
      transactionsPlugin,
      versionsPlugin,
      internalDirectMessagePlugin,
      internalInvitePlugin,
      internalMessagePlugin,
      pingPlugin,
      internalRoomPlugin,
      serverKeyPlugin,
      wellKnownPlugin,
      roomPlugin,
    ];

    expect(useCalls).toEqual(expectedOrder);
  });

  it('returns app and container from setup()', async () => {
    const { app, container } = await setup();
    expect(app).toBeInstanceOf(ElysiaMock as any);
    expect(container).toEqual(expect.objectContaining({ mockContainer: true }));
  });

  it('appPromise resolves to the app instance', async () => {
    const app = await appPromise;
    // appPromise uses default setup() call under the hood
    expect(app).toBeDefined();
    expect((app as any).used).toBeDefined();
  });
});