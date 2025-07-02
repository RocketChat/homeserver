import type { RouteDefinition } from './types/route.types';

// Import all route arrays
import { versionsRoutes } from './controllers/federation/versions.controller';
import { pingRoutes } from './controllers/internal/ping.controller';
import { inviteRoutes } from './controllers/federation/invite.controller';
import { profilesRoutes } from './controllers/federation/profiles.controller';
import { sendJoinRoutes } from './controllers/federation/send-join.controller';
import { transactionsRoutes } from './controllers/federation/transactions.controller';
import { messageRoutes } from './controllers/internal/message.controller';
import { roomRoutes } from './controllers/internal/room.controller';
import { internalInviteRoutes } from './controllers/internal/invite.controller';
import { serverKeyRoutes } from './controllers/key/server.controller';
import { wellKnownRoutes } from './controllers/well-known/well-known.controller';

export function getAllRoutes(): RouteDefinition[] {
  return [
    ...versionsRoutes,
    ...pingRoutes,
    ...inviteRoutes,
    ...profilesRoutes,
    ...sendJoinRoutes,
    ...transactionsRoutes,
    ...messageRoutes,
    ...roomRoutes,
    ...internalInviteRoutes,
    ...serverKeyRoutes,
    ...wellKnownRoutes,
  ];
}

export {
  versionsRoutes,
  pingRoutes,
  inviteRoutes,
  profilesRoutes,
  sendJoinRoutes,
  transactionsRoutes,
  messageRoutes,
  roomRoutes,
  internalInviteRoutes,
  serverKeyRoutes,
  wellKnownRoutes,
};