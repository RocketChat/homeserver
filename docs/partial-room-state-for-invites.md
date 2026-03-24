# Partial Room State for Pending Invites

## Problem

The homeserver SDK cannot process room events (e.g., ban, kick) targeting users who have only received an invite but have not yet joined the room. This is because event validation requires the room version, which is obtained from the `m.room.create` event stored locally. Since the server never joined the room on behalf of the invited user, no room state — including `m.room.create` — exists in the local event store.

### What happens today

1. Server A invites a user on Server B (our homeserver)
2. Server B receives the invite via the `/v2/invite` endpoint, stores the invite event as an outlier, and emits the membership event to the application layer
3. The application creates a subscription with `status: INVITED`
4. Server A sends a subsequent room event (e.g., `membership: ban`) targeting the invited user
5. Server B receives the event as a PDU in a `/v1/send` transaction
6. `EventService.validateEvent()` calls `StateService.getRoomVersion()`, which looks up the `m.room.create` event in the local event store
7. No `m.room.create` exists (the server only has the outlier invite event) -> `UnknownRoomError` is thrown
8. The event is discarded. The invite remains stuck in the application layer with no way to accept or reject it

### Affected scenarios

- **Ban after invite**: admin bans an invited user before they accept. The ban event is discarded, and the invite stays visible to the user. Attempting to accept or reject results in an error since the originating server already considers the user banned.
- **Any room event targeting a pending invitee**: the same validation failure applies to kicks, power level changes, or any PDU for a room where the server only has invite state.
- **Bidirectional**: this happens regardless of which server initiates the action. Whether the ban comes from another Rocket.Chat instance or from a Synapse/Element server, our homeserver is the one that fails to process it.

## How Synapse handles this

Synapse (the reference Matrix homeserver) maintains **partial room state** for rooms where the server has only received an invite. When a server receives an invite, the `unsigned.invite_room_state` field in the invite event contains stripped state events (typically `m.room.create`, `m.room.join_rules`, `m.room.name`, etc.). Synapse stores this partial state and uses it to:

1. Know the room version for event validation and serialization
2. Display room metadata (name, topic, avatar) to the invited user before they join
3. Process subsequent events for the room even before the server has fully joined

This allows Synapse to handle bans, kicks, and other membership changes targeting invited users, because it can validate the incoming events against the partial state obtained from the invite.

### Relevant spec sections

- [Matrix Spec: Inviting to a room (Federation API)](https://spec.matrix.org/v1.13/server-server-api/#inviting-to-a-room) — describes `invite_room_state` in the `unsigned` field
- [Matrix Spec: Stripped state](https://spec.matrix.org/v1.13/client-server-api/#stripped-state) — defines the minimal state events included with invites

## Current workaround

As a temporary measure, we added a `homeserver.matrix.membership.rejected` event to the SDK. When `validateEvent` fails with `UnknownRoomError` for a `m.room.member` event, instead of silently discarding it, the SDK emits this event. The application layer (Rocket.Chat) listens for it and cleans up the local `INVITED` subscription so the invite does not remain stuck in the UI.

This is not a proper fix — it bypasses validation entirely for these events and only handles the specific case of cleaning up invites. It does not enable the server to properly participate in rooms where it only has invite state.

## Proposed solution

Store partial room state from `unsigned.invite_room_state` when processing incoming invites. This would involve:

1. **On invite receipt** (`InviteService`): extract `invite_room_state` from the invite event's `unsigned` field and persist the stripped state events (at minimum `m.room.create`) in the event store, marked as partial/stripped state
2. **On `getRoomVersion`** (`StateService`): fall back to partial state when full room state is not available, so that event validation can succeed for rooms with pending invites
3. **On join**: replace partial state with full state obtained via `/send_join`
4. **On invite rejection/retraction**: clean up partial state

This would align our behavior with the spec and with Synapse, enabling proper processing of all room events for rooms where the server has pending invites.

---

# Server Set Routing After Ban

## Problem

`getServerSetInRoom` (in `StateService`) only includes servers that have at least one user with `membership: 'join'` in the room state. When a user is banned, their membership changes from `join` to `ban`. If they were the only user from their server in the room, their server is excluded from the destination set for subsequent events.

This means events that happen **after** the ban — including the unban (kick/leave) event — are never sent to the banned user's server.

### What happens today

1. Server A bans a user from Server B
2. Ban event is sent to Server B via `sendEventToAllServersInRoom` (the user still had `join` membership when the server set was computed for sending the ban)
3. Server B processes the ban event, state updates membership to `ban`
4. Server A unbans the user (sends a `membership: leave` via `kickUser`)
5. `sendEventToAllServersInRoom` computes the server set — Server B has no users with `join` membership → **Server B is excluded from destinations**
6. The leave (unban) event is never delivered to Server B
7. Later, Server A tries to re-invite the user — builds an invite event whose `prev_events` reference the leave event
8. Server A sends the invite to Server B via the `/v2/invite` endpoint
9. Server B has the `m.room.create` event (user had previously joined), so `processInvite` calls `handlePdu`
10. `handlePdu` → `_resolveStateAtEvent` → looks for `stateId` of `prev_events` → the leave event was never received → **"no previous state for event"** error
11. Invite processing fails, Server A gets a 500 response

### Impact

- After a ban+unban cycle in a federated room, the user cannot be re-invited
- The state chain on the remote server becomes broken because intermediate events are missing
- This affects RC ↔ RC federation. RC ↔ Element (Synapse) works because Synapse handles server routing differently

### Root cause

The Matrix spec states that servers should continue receiving events for rooms where they have **any** membership state (join, invite, ban, leave with prior membership). Our `getServerSetInRoom` only considers `join` membership, which is too restrictive.

### Proposed fix

`getServerSetInRoom` should include servers that have users with `ban` or `invite` membership in addition to `join`. A banned user's server still needs to receive room events (at minimum the unban event) to maintain a consistent state chain.

From the spec perspective, the set of servers that should receive events ("resident servers") includes any server that has at least one user in the room with membership `join` or `invite`. For `ban`, the server should receive at minimum the events needed to transition out of the banned state.

A simpler alternative: when sending a ban-related event (membership: leave after ban), explicitly add the target user's server to the destination set regardless of their current membership.
