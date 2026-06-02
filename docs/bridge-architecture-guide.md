# Matrix Bridge Architecture Guide

A comprehensive guide to how bridges work with Matrix homeservers via the Application Service (AS) API. Written as a reference for implementing bridge support in any homeserver.

## Overview

Bridges are external services that connect other messaging protocols (IRC, Slack, Telegram, etc.) to Matrix. They use the **Application Service API** — a standardized protocol for bidirectional event flow between a homeserver and an external service.

---

## 1. Registration

Each bridge registers with the homeserver via a YAML registration file. The homeserver admin configures which registration files to load.

### Registration File Structure

```yaml
id: my_irc_bridge                    # Unique identifier for the bridge
url: http://localhost:9999            # URL where bridge receives events from homeserver
as_token: as_token_secret_123         # Token the bridge sends to homeserver (bridge → HS auth)
hs_token: hs_token_secret_456         # Token homeserver sends to bridge (HS → bridge auth)
sender_localpart: bridge_bot          # Localpart for the bridge bot user (e.g., @bridge_bot:example.com)

# Namespaces define what users/aliases/rooms the bridge manages
namespaces:
  users:
    - exclusive: true                 # Only this bridge can create these users
      regex: "@irc_.*"               # Users matching this pattern belong to this bridge
  aliases:
    - exclusive: true
      regex: "#irc_.*"               # Room aliases this bridge manages
  rooms: []

# Optional: 3rd-party protocol support for /thirdparty/* endpoints
protocols:
  - irc

# Optional feature flags
de.sorunome.msc2409.push_ephemeral: true    # Receive typing, read receipts, etc.
org.matrix.msc3202: true                     # Receive device list changes
```

### Key Concepts

- **`as_token`**: Bridge → Homeserver authentication. The bridge includes this in requests to prove its identity.
- **`hs_token`**: Homeserver → Bridge authentication. The homeserver includes this when pushing events to the bridge.
- **`sender_localpart`**: The "bridge bot" user. This is the default user the bridge acts as when not impersonating a ghost user.
- **Exclusive namespaces**: Only the owning bridge can create/manage resources matching the regex. The homeserver must reject attempts by other clients to register users or create aliases in exclusive namespaces.
- **Non-exclusive namespaces**: The bridge receives events about matching resources, but other clients can also create them.

### Homeserver Responsibilities at Registration Load Time

1. Parse and validate the registration YAML.
2. Store the registration in memory/database.
3. Create the bridge bot user (`sender_localpart`) if it doesn't exist.
4. Index namespace regexes for fast lookup during event routing.

---

## 2. Communication: Homeserver → Bridge

The homeserver pushes events to the bridge via HTTP.

### Transaction Endpoint

```
PUT {bridge_url}/_matrix/app/v1/transactions/{txnId}
Authorization: Bearer <hs_token>
```

**Request body:**

```json
{
  "events": [
    {
      "type": "m.room.message",
      "room_id": "!room123:example.com",
      "sender": "@user:example.com",
      "content": {"body": "Hello", "msgtype": "m.text"},
      "event_id": "$event123",
      "origin_server_ts": 1234567890
    }
  ],
  "de.sorunome.msc2409.ephemeral": [
    {
      "type": "m.typing",
      "room_id": "!room123:example.com",
      "content": {"user_ids": ["@user:example.com"]}
    }
  ],
  "ephemeral": [
    {
      "type": "m.typing",
      "room_id": "!room123:example.com",
      "content": {"user_ids": ["@user:example.com"]}
    }
  ],
  "de.sorunome.msc2409.to_device": [],
  "org.matrix.msc3202.device_one_time_key_counts": {},
  "org.matrix.msc3202.device_lists": {"changed": [], "left": []}
}
```

> **Ephemeral events under two keys.** Ephemeral events (typing, receipts, presence) are sent under *both* the unstable `de.sorunome.msc2409.ephemeral` key (what Synapse emits and most bridges read) and the stable `ephemeral` key (Matrix v1.13+). Sending both maximizes bridge compatibility. See `transaction-sender.service.ts`.

**Bridge must respond:** HTTP 200 with `{}` on success.

**Transaction ID (`txnId`)**: Monotonically increasing. Bridges should deduplicate by `txnId` in case the homeserver retries.

### Batching

Events are not pushed one-at-a-time. The router accumulates events and EDUs per appservice into a batch that flushes when **either** limit is hit:

- **Batch window**: 100 ms since the first event in the batch (`BATCH_WINDOW_MS`).
- **Max batch size**: 50 events/EDUs combined (`MAX_BATCH_SIZE`).

This keeps transaction volume low while bounding delivery latency. See `event-router.service.ts`.

### What Events to Push

The homeserver must determine which bridges are "interested" in each event. A bridge is interested if any of the following match:

1. **Room ID** matches the bridge's room namespace regex.
2. **Room alias** (any alias for that room) matches the bridge's alias namespace regex.
3. **Any member in the room** matches the bridge's user namespace regex (i.e., a ghost user is in the room).
4. **The event sender** matches the bridge's user namespace regex.

### Retry and Recovery

If a bridge is unreachable:

1. Persist the transaction (status `pending`) before attempting delivery, so it survives a restart.
2. On a non-2xx response or network error, mark the transaction `failed` and the bridge `down` (recording the error).
3. On a 2xx response, mark the transaction `sent` and the bridge `up`.
4. Retry eligible pending/failed transactions with **exponential backoff**: `min(1000 * 2^attempts, 60000)` ms (initial 1 s, capped at 60 s).
5. Track per-bridge state so it can resume from where it left off.

> **Implementation caveat (retries).** This homeserver stores only the event *IDs* in the transaction record, not the full event bodies. Retries therefore send an **empty** transaction body purely to test connectivity and reset the bridge to `up`; the missed events are not re-delivered. A more complete implementation would persist enough to replay the original payload. See `transaction-sender.service.ts` (`retryPending`).

### State Tracking (per bridge)

The homeserver tracks per-bridge delivery state (`AppServiceState`):

| Field | Purpose |
|-------|---------|
| `state` | `up` or `down` |
| `lastTxnId` | Last transaction ID allocated (monotonic counter) |
| `streamOrdering` | Last event stream position delivered |
| `readReceiptStreamId` | Last read receipt delivered |
| `presenceStreamId` | Last presence update delivered |
| `toDeviceStreamId` | Last to-device message delivered |
| `lastError` / `lastErrorAt` | Last delivery error and when it occurred |

---

## 3. Communication: Bridge → Homeserver

The bridge uses the standard **Matrix Client-Server API** to interact with the homeserver, with special AS authentication.

### Authentication

The bridge authenticates using the `as_token`:

```
Authorization: Bearer <as_token>
```

Or legacy (deprecated):

```
?access_token=<as_token>
```

### Acting as Another User (Impersonation)

The bridge can act as any user within its namespace by appending:

```
?user_id=@irc_alice:example.com
```

The homeserver must:

1. Verify the `as_token` is valid.
2. Verify the target `user_id` is within the bridge's user namespace.
3. Execute the request as if that user made it.

### Key Operations a Bridge Performs

#### a) Register Ghost/Virtual Users

```http
POST /_matrix/client/v3/register
Authorization: Bearer <as_token>

{
  "auth": {"type": "m.login.application_service"},
  "username": "irc_alice"
}
```

**Homeserver must:**
- Validate the `as_token`.
- Check that the requested username falls within the bridge's user namespace.
- Create the user with an association to the bridge (`appservice_id` in the DB).
- Skip CAPTCHA, email verification, and other interactive auth steps.
- Ghost users have no password (empty password hash).

#### b) Send Messages as Ghost Users

```http
PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}?user_id=@irc_alice:example.com
Authorization: Bearer <as_token>

{"body": "Hello from IRC!", "msgtype": "m.text"}
```

#### c) Join/Leave Rooms as Ghost Users

```http
POST /_matrix/client/v3/join/{roomIdOrAlias}?user_id=@irc_alice:example.com
Authorization: Bearer <as_token>
```

#### d) Set Display Names and Avatars for Ghost Users

```http
PUT /_matrix/client/v3/profile/@irc_alice:example.com/displayname?user_id=@irc_alice:example.com
Authorization: Bearer <as_token>

{"displayname": "alice (IRC)"}
```

#### e) Create Rooms

```http
POST /_matrix/client/v3/createRoom
Authorization: Bearer <as_token>

{
  "room_alias_name": "irc_general",
  "name": "#general (IRC)",
  "visibility": "public"
}
```

---

## 4. Query Endpoints (Bridge Must Implement)

The homeserver calls these when it encounters an unknown user or room alias that matches a bridge's namespace.

### User Query

```
GET {bridge_url}/_matrix/app/v1/users/{userId}
Authorization: Bearer <hs_token>
```

**When called:** A client queries a user ID that matches the bridge's namespace but doesn't exist yet.

**Bridge response:**
- `200 {}` — "Yes, I know this user." The homeserver should then allow the bridge to lazily create it.
- `404` — "I don't know this user."

### Room Alias Query

```
GET {bridge_url}/_matrix/app/v1/rooms/{roomAlias}
Authorization: Bearer <hs_token>
```

**When called:** A client tries to join/resolve a room alias matching the bridge's namespace that doesn't exist yet.

**Bridge response:**
- `200 {}` — "Yes, this room exists." The bridge is expected to create the room (via Client-Server API) before or shortly after responding.
- `404` — "I don't know this room."

### Third-Party Protocol Lookup (Optional)

```
GET {bridge_url}/_matrix/app/v1/thirdparty/protocol/{protocol}
GET {bridge_url}/_matrix/app/v1/thirdparty/user/{protocol}?fields...
GET {bridge_url}/_matrix/app/v1/thirdparty/location/{protocol}?fields...
```

These enable discovery — mapping between Matrix and third-party identifiers.

---

## 5. Ghost/Virtual User Management

### User Lifecycle

1. **Creation**: Bridge registers user via `/register` with `m.login.application_service` auth.
2. **Profile setup**: Bridge sets display name and avatar.
3. **Room participation**: Bridge joins the user to rooms, sends messages on their behalf.
4. **Cleanup** (optional): Bridge can deactivate users that are no longer needed.

### Database Requirements

The homeserver needs to track which users belong to which bridge:

```
users table:
  - user_id: TEXT (e.g., @irc_alice:example.com)
  - password_hash: TEXT (empty for ghost users)
  - appservice_id: TEXT NULLABLE (bridge ID, NULL for normal users)
```

### Lookup Operations Needed

- `get_app_service_by_user_id(user_id)` — Which bridge owns this user?
- `is_user_in_appservice_namespace(user_id)` — Does this user match any bridge's namespace?
- `get_appservices_interested_in_user(user_id)` — Which bridges care about events from this user?

---

## 6. Room Bridging and Interest Detection

### How Rooms Get Bridged

**Method 1: Bridge creates the room proactively**
- Bridge calls `POST /createRoom` with a room alias in its namespace.
- Any user joining that alias lands in the bridged room.

**Method 2: Lazy creation via alias query**
- User tries to join `#irc_general:example.com`.
- Homeserver doesn't find the alias, queries the bridge via room alias query endpoint.
- Bridge creates the room and responds 200.
- User joins the newly created room.

**Method 3: Invite-based bridging**
- A real user invites a ghost user (or bridge bot) to a room.
- Bridge accepts the invite and starts bridging that room.

### Interest Detection Algorithm

For each event, determine which bridges should receive it:

```python
def get_interested_bridges(event, all_bridges):
    interested = []
    for bridge in all_bridges:
        if bridge.matches_room_id(event.room_id):
            interested.append(bridge)
        elif any(bridge.matches_alias(a) for a in get_aliases(event.room_id)):
            interested.append(bridge)
        elif any(bridge.matches_user(m) for m in get_members(event.room_id)):
            interested.append(bridge)
        elif bridge.matches_user(event.sender):
            interested.append(bridge)
    return interested
```

To resolve a room's aliases and members for steps 2 and 3, the router uses an injected **room-state resolver** callback that reads the latest resolved room state (canonical aliases + members). See `event-router.service.ts` and the resolver wired up in `federation-sdk/src/index.ts`.

> **Implementation note (member matching).** In this codebase the member-based check (step 3) is narrower than the generic algorithm: a member only triggers interest when it equals the bridge's *own* bot user ID (`@{senderLocalpart}:{serverName}`) **and** matches the user namespace regex (commit "match user id with server name"). In practice, interest is driven mainly by room ID, alias, and sender matches; the bridge bot's presence in a room counts, but other ghost members do not by themselves. See `namespace-matcher.service.ts` (`getInterestedAppServices`).

## 7. Complete Message Flow Examples

### External Protocol → Matrix

```
1. IRC user "alice" sends "Hello" in #general
2. IRC bridge receives the message
3. Bridge checks if @irc_alice:hs.example.com exists
   - If not: POST /register to create ghost user
   - If not in room: POST /join to join the bridged room
4. Bridge sends message:
   PUT /rooms/!bridged:hs.example.com/send/m.room.message/txn1?user_id=@irc_alice:hs.example.com
   Body: {"body": "Hello", "msgtype": "m.text"}
5. Homeserver stores event, delivers to room members
6. Other bridges interested in this room also receive the event via transaction push
```

### Matrix → External Protocol

```
1. Matrix user @bob:hs.example.com sends "Hi" in !bridged:hs.example.com
2. Homeserver determines IRC bridge is interested (ghost users in room)
3. Homeserver pushes transaction to bridge:
   PUT http://bridge:9999/_matrix/app/v1/transactions/42
   Body: {"events": [{sender: "@bob:hs.example.com", body: "Hi", ...}]}
4. Bridge receives event, translates to IRC format
5. Bridge sends "Hi" as bob to #general on IRC
6. Bridge responds HTTP 200 to homeserver
```

---

## 8. Implementation Checklist for a Homeserver

### Registration Management
- [ ] Parse AS registration YAML files
- [ ] Store registrations (id, url, as_token, hs_token, sender_localpart, namespaces)
- [ ] Create bridge bot user on registration load
- [ ] Index namespace regexes for fast matching

### Authentication
- [ ] Recognize `as_token` in `Authorization: Bearer` header and `access_token` query param
- [ ] Support `?user_id=` impersonation parameter
- [ ] Validate impersonated user is within bridge's namespace
- [ ] Support `m.login.application_service` auth type in `/register`

### Event Routing
- [ ] Detect interested bridges per event (room ID, aliases, members, sender matching)
- [ ] Queue events per bridge
- [ ] Push transactions to bridge URL with `hs_token` auth
- [ ] Handle transaction acknowledgment (HTTP 200)
- [ ] Implement retry with exponential backoff on failure
- [ ] Track per-bridge stream positions for resumption
- [ ] Deduplicate transactions by `txnId`

### Query Protocol
- [ ] Query bridge for unknown users in its namespace (`GET /users/{userId}`)
- [ ] Query bridge for unknown room aliases in its namespace (`GET /rooms/{roomAlias}`)
- [ ] Optional: Support third-party protocol lookup endpoints

### Ghost User Management
- [ ] Allow bridges to register users in their namespace without password/captcha
- [ ] Store `appservice_id` association on ghost users
- [ ] Allow bridges to set profiles (displayname, avatar) for ghost users
- [ ] Enforce exclusive namespace restrictions (reject non-bridge registration in exclusive namespaces)

### Ephemeral Events (Optional but Recommended)
- [ ] Push typing notifications to interested bridges
- [ ] Push read receipts to interested bridges
- [ ] Push presence updates to interested bridges
- [ ] Push to-device messages to interested bridges
- [ ] Respect `de.sorunome.msc2409.push_ephemeral` flag
- [ ] Send ephemeral events under both the unstable (`de.sorunome.msc2409.ephemeral`) and stable (`ephemeral`) keys for compatibility
- [ ] Convert federation EDUs to client-server ephemeral shapes (coalesce typing, re-key receipts, fan out presence)

### Database Schema

```sql
-- Bridge registrations (or load from config into memory)
CREATE TABLE application_services (
    id TEXT PRIMARY KEY,
    url TEXT,
    as_token TEXT UNIQUE,
    hs_token TEXT,
    sender_localpart TEXT
);

-- Namespace patterns
CREATE TABLE application_service_namespaces (
    as_id TEXT REFERENCES application_services(id),
    type TEXT,          -- 'users', 'aliases', 'rooms'
    regex TEXT,
    exclusive BOOLEAN
);

-- Per-bridge delivery state
CREATE TABLE application_services_state (
    as_id TEXT PRIMARY KEY REFERENCES application_services(id),
    state TEXT,                    -- 'up' or 'down'
    stream_ordering BIGINT,
    read_receipt_stream_id BIGINT,
    presence_stream_id BIGINT,
    to_device_stream_id BIGINT,
    device_list_stream_id BIGINT
);

-- Transaction queue
CREATE TABLE application_services_txns (
    as_id TEXT REFERENCES application_services(id),
    txn_id BIGINT,
    event_ids TEXT,                -- JSON array of event IDs
    PRIMARY KEY (as_id, txn_id)
);

-- Users table needs appservice_id column
ALTER TABLE users ADD COLUMN appservice_id TEXT REFERENCES application_services(id);
```

---

## 9. Synapse-Specific Source Reference

These files in the Synapse codebase serve as a reference implementation:

| File | Purpose |
|------|---------|
| `synapse/appservice/__init__.py` | `ApplicationService` class, namespace/interest matching |
| `synapse/appservice/api.py` | HTTP client for calling bridges |
| `synapse/appservice/scheduler.py` | Transaction queuing, retry, backoff |
| `synapse/handlers/appservice.py` | Event routing to interested bridges |
| `synapse/config/appservice.py` | Registration file parsing |
| `synapse/handlers/register.py` | Ghost user registration (`appservice_register`) |
| `synapse/handlers/directory.py` | Room alias resolution with bridge queries |
| `synapse/api/auth/base.py` | AS token authentication and impersonation |
| `synapse/storage/databases/main/appservice.py` | Database operations for AS state |
| `synapse/rest/client/thirdparty.py` | Third-party protocol lookup endpoints |
| `docs/application_services.md` | Official Synapse AS documentation |

---

## 10. Existing Bridge SDKs

These SDKs implement the bridge-side of the AS API:

| Language | SDK | Notes |
|----------|-----|-------|
| Python | [mautrix-python](https://github.com/mautrix/python) | Most popular, powers mautrix-telegram, mautrix-signal, etc. |
| Node.js | [matrix-appservice-bridge](https://github.com/matrix-org/matrix-appservice-bridge) | Official Matrix.org SDK |
| Go | [mautrix-go](https://github.com/mautrix/go) | Powers mautrix-whatsapp, mautrix-discord |
| Rust | [matrix-rust-sdk](https://github.com/matrix-org/matrix-rust-sdk) | Has appservice module |

Studying how these SDKs interact with the homeserver is useful for understanding the protocol from the bridge's perspective.

---

## 11. Relevant Matrix Spec Sections

- [Application Service API](https://spec.matrix.org/latest/application-service-api/)
- [Client-Server API — Registration](https://spec.matrix.org/latest/client-server-api/#registration)
- [MSC2409 — Ephemeral events for appservices](https://github.com/matrix-org/matrix-spec-proposals/pull/2409)
- [MSC3202 — Device list changes for appservices](https://github.com/matrix-org/matrix-spec-proposals/pull/3202)

---

## 12. This Homeserver's Implementation

The Application Service support in this repository lives in the `@rocket.chat/federation-appservice` package, with supporting changes in `federation-sdk`, `federation-core`, and `federation-room`. It currently powers an **XMPP bridge**. This section maps the concepts above onto the actual code.

### Source File Reference

| File | Purpose |
|------|---------|
| `packages/appservice/src/models/appservice.model.ts` | `AppServiceRegistration`, `AppServiceNamespaces`, `AppServiceState`, `AppServiceTransaction`, `AppServiceEphemeralEvent`, and the in-memory `CachedAppService` (with compiled regexes) |
| `packages/appservice/src/services/registration.service.ts` | Loads registrations from config, caches them with compiled namespaces, indexes by `asToken`, tracks state |
| `packages/appservice/src/services/namespace-matcher.service.ts` | Namespace/exclusivity matching and `getInterestedAppServices()` interest detection |
| `packages/appservice/src/services/event-router.service.ts` | Routes persistent + ephemeral events to interested bridges; batching (100 ms / 50 events) |
| `packages/appservice/src/services/transaction-sender.service.ts` | `PUT /_matrix/app/v1/transactions/{txnId}` with `hs_token` auth; retry/backoff; up/down state |
| `packages/appservice/src/services/bridge-query.service.ts` | Bridge query endpoints: user, room alias, third-party protocol/user/location |
| `packages/appservice/src/utils/edu-to-appservice.ts` (+ `.spec.ts`) | Converts federation EDUs (typing/receipt/presence) into client-server ephemeral events |
| `packages/appservice/src/config-provider.ts` | `AppServiceConfigProvider` DI token — supplies `serverName` and XMPP config |
| `packages/federation-sdk/src/sdk.ts` | Public SDK surface for appservice operations (see below) |
| `packages/federation-sdk/src/services/directory.service.ts` + `repositories/room-alias.repository.ts` | Canonical room-alias storage and resolution |
| `packages/room/src/manager/room-state.ts` | `setRoomStateResolver` — exposes canonical aliases + members used for interest matching |
| `packages/core/src/utils/fetch.ts` | HTTP/HTTPS fetch used to reach bridges (see below) |

### Config-Driven Registration (no YAML/DB)

Unlike Synapse's YAML registration files, this homeserver builds the bridge registration **entirely from app config**. `RegistrationService.initialize()` reads `AppConfig.xmpp`:

```ts
xmpp?: {
  bridgeURL: string;   // url
  hsToken: string;     // HS → bridge auth
  asToken: string;     // bridge → HS auth
}
```

When present, it synthesizes a single registration with fixed values:

- `_id`: `"xmpp"`, `senderLocalpart`: `"_xmpp_bot"`, `protocols`: `["xmpp"]`
- Namespaces: users `@_xmpp_.*` (exclusive), aliases `#_xmpp_.*` (exclusive), rooms empty

Re-running `setConfig()` re-initializes the cache and ensures the bridge bot user exists (`ensureSenderUsersForAllRegistrations()`). There is no `application_services` config-file parser yet — adding more bridges means extending the config schema and `RegistrationService`.

### EDU → Ephemeral Event Conversion

`eduBatchToAppServiceEphemeral()` translates federation EDUs into the client-server shapes bridges expect:

- **`m.typing`** — coalesced per room; emits one event per room whose `content.user_ids` is the set of currently-typing users (last value per user in the batch wins).
- **`m.receipt`** — re-keyed from the federation shape (`room → user → {data, event_ids}`) to the client-server shape (`event_id → "m.read" → user → {ts, thread_id?}`); receipts for the same room merge into one event.
- **`m.presence`** — each entry in the EDU's `push` array fans out into its own `m.presence` event, hoisting `user_id` to a top-level `sender`.

### SDK Surface (`federation-sdk`)

The SDK exposes the appservice machinery to the rest of the homeserver and to the bridge-facing controllers:

- Registration lookup: `getAllRegistrations()`, `getRegistrationById()`, `getRegistrationByAsToken()`
- Startup: `ensureSenderUsersForAllRegistrations()` (creates/ensures the bridge bot user)
- Queries: `getAllProtocols()`, `queryThirdPartyProtocol/User/Location()`, `pingAppService()`, `getAppServiceState()`
- Namespace checks: `isExclusiveNamespace()`, `isUserInAppServiceNamespace()`
- Room participation: `joinUser()` and `joinXMPPChatRoom()` — the latter builds an `#_xmpp_…` alias, queries the bridge, resolves the alias via the directory, and joins the user.

The bridge bot user is created as a regular Rocket.Chat bot user on startup (commit "create appservice user as a rocketchat bot").

### HTTP Support for Bridges

`packages/core/src/utils/fetch.ts` selects the transport by URL scheme (`http` vs `https`), so bridges can be reached over plain **HTTP** (e.g. a local XMPP bridge at `http://localhost:…`). For HTTPS it sets the TLS `servername` (SNI) from the `Host` header so certificate verification works on multihomed servers.
