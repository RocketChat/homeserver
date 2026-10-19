# Matrix & Synapse Compatibility

Tracks which Matrix spec features and room versions this homeserver supports, and how that lines up with Synapse, the server our users federate with most. Re-check it on every Synapse minor release and every spec release (see [How to update this document](#how-to-update-this-document)).

**Scope:** the SDK path (`packages/federation-sdk`, `packages/room`, `packages/core`, `packages/crypto`). The REST controllers in `packages/homeserver` are not the entrypoint and are not covered.

## Current status

| | |
|---|---|
| **Last reviewed** | 2026-10-16 |
| **SDK version reviewed** | `@rocket.chat/federation-sdk` 0.8.1 (`58f112b6`) |
| **Room versions supported** | 3–11 (1, 2 and 12 are not supported) |
| **Default for new local rooms** | 10, configurable through `defaultRoomVersion` (`packages/federation-sdk/src/services/config.service.ts:6`) |
| **Latest Synapse checked** | 1.163.0 (2026-10-14). Its default room version is **12**. |
| **Latest Matrix spec checked** | v1.19 (2026-07-08). It recommends room version **12** as the default. |

> [!WARNING]
> **Synapse ≥ 1.162.0 creates v12 rooms by default, and we can't join v12 rooms.** When a user on a current Synapse creates a room and invites a Rocket.Chat user, the invite fails. Rooms created on our side, and Synapse rooms that are v11 or older, still work. A Synapse admin can work around this with `default_room_version: "11"` in `homeserver.yaml`. That only affects rooms created after the change, and any room later upgraded to v12 drops our users.

## Room versions

| Version | Implementation | Can create locally | Can join / receive | Notes |
|---|---|---|---|---|
| 1, 2 | — | ❌ | ❌ | Commented out in `PersistentEventFactory.supportedRoomVersions`. These versions use a different event ID format. |
| 3, 4, 5 | `PersistentEventV3` | ✅ | ✅ | |
| 6, 7 | `PersistentEventV6` | ✅ | ✅ | v7 knock auth rules are incomplete. |
| 8 | `PersistentEventV8` | ✅ | ✅ | Restricted-room join rules are incomplete. |
| 9, 10 | `PersistentEventV9` | ✅ | ✅ | **Default.** v10 integer-only power-level checks are incomplete. |
| 11 | `PersistentEventV11` | ✅ | ✅ | Added in #409. Tested locally but **not yet tested against Synapse**. |
| 12 | — | ❌ | ❌ | Not implemented. See [What room v12 needs](#what-room-v12-needs). |

Versions are mapped to classes in `packages/room/src/manager/factory.ts`. "Supported" means events of that version are built and verified. It does not mean every auth rule is implemented: `supportedRoomVersions` over-claims v7, v8, v10 and v11 (missing knock, restricted joins, third-party invites, integer power levels). See [room-v11-compliance-report.md](room-v11-compliance-report.md) for details.

When a remote room uses a version we don't support:

- **Outbound join:** `make_join` sends `ver=3…11`, so the remote server answers `M_INCOMPATIBLE_ROOM_VERSION`. That is correct.
- **Inbound invite:** `PersistentEventFactory.createFromRawEvent` throws a plain `Error`. The spec expects `400 M_INCOMPATIBLE_ROOM_VERSION` on `PUT /v2/invite`. **To check:** whether the Rocket.Chat route converts this into the correct error code.

## Synapse compatibility

| Synapse | Default room version | v12 available | Compatibility with us |
|---|---|---|---|
| < 1.136.0 | 10 | ❌ | ✅ Fully compatible. |
| 1.136.0 – 1.157.x | 10 | ✅ | ✅ Works, unless someone explicitly creates or upgrades a room to v12. |
| 1.158.0 – 1.161.x | 11 | ✅ | ⚠️ New Synapse rooms are v11. We support v11, but haven't tested it against Synapse. |
| **≥ 1.162.0** | **12** | ✅ | ❌ **New Synapse rooms are v12, which we can't join.** Rooms we create (v10) still work. |

Synapse changes that affect us:

| Synapse | Date | Change | Impact |
|---|---|---|---|
| 1.136.0 | 2025-08-12 | Room v12 added (coordinated security release, CVE-2025-49090). Default unchanged. | v12 rooms exist only if someone creates one explicitly. |
| 1.158.0 | 2026-08-04 | Default room version 10 → 11 (MSC4239, spec v1.14). | Synapse is now one version ahead of our default. |
| 1.162.0 | 2026-09-29 | Default room version 11 → 12 (element-hq/synapse#20130). | **Breaks invites from Synapse into new rooms.** |
| 1.162.0 | 2026-09-29 | Synapse sends full PDUs in `invite_room_state`/`knock_room_state` and warns when it receives stripped ones. **From 2027-06-01 it rejects them**, but only for v12 rooms (element-hq/synapse#19723). | No effect today. Becomes a blocker once we add v12 (see MSC4311 below). |

## Spec versions

We don't claim conformance to any single spec version. The table below shows how each recent release affects the server-server API and room versions. Client-server, application service, push and identity changes are left out.

| Spec | Released | Relevant changes | Our status |
|---|---|---|---|
| v1.14 | — | Recommended default room version → 11 (MSC4239). | ⚠️ Our default is 10 (reverted in #413). It can be configured to 11. |
| v1.16 | 2025-09-17 | Room v12 (MSC4304, MSC4291, MSC4289, MSC4297). Recommended default → 12. `invite_room_state` rules (MSC4311). An event's `auth_events` must be in the same room, all versions (MSC4307). | ❌ v12 not supported. ❌ MSC4311 not implemented. MSC4307 not reviewed. |
| v1.17 | 2025-12-18 | Clarifications: for restricted joins (v8–12), "able to invite" includes being joined. Users with redact power can redact events they couldn't send (v3–12). | Not reviewed. |
| v1.18 | 2026-03-25 | Removed `/v1/send_join` and `/v1/send_leave` (MSC4376). Policy servers (MSC4284). Validation of PDUs on membership endpoints. | ✅ We call only `/v2/send_join`, `/v2/send_leave` and `/v2/invite`. ❌ Policy servers not implemented. |
| v1.19 | 2026-07-08 | Server ACLs are case-insensitive (MSC4436). Handling of multiple signatures. `query/profile` behavior. | ❌ ACL globs are matched case-sensitively (`event-authorization.service.ts:178`, no `i` flag). Others not reviewed. |

## What room v12 needs

These are the main changes needed to support v12. It is not a full plan.

- **MSC4291: room ID = `!` + reference hash of the create event, with no domain.** `PersistentEventBase.residentServer` (`packages/room/src/manager/event-wrapper.ts:120`) takes the server from the room ID's domain, and the SDK uses it in about 26 places. In v12 the create event also has no `room_id`.
- **MSC4289: room creators have unlimited power level.** The creators are `sender` plus `additional_creators`. Auth rules and power-level checks need a separate creator path.
- **MSC4297: state resolution v2.1.**
- **MSC4311: full PDUs in `invite_room_state`.** We currently send stripped events for *all* current state (`state.service.ts:167`). For v12 we must send the `m.room.create` PDU and full PDUs for the rest. From 2027-06-01 Synapse rejects v12 invites that don't comply. We also need to validate incoming `invite_room_state`.

## How to update this document

Do this on every Synapse minor release (roughly every two weeks) and every spec release (roughly every quarter):

1. **Synapse:** read [`CHANGES.md`](https://github.com/element-hq/synapse/blob/develop/CHANGES.md) since the last version in [Current status](#current-status). Search for `room version`, `default`, `federation`, `MSC`, and the *Deprecations and Removals* section. Record anything that changes what Synapse sends us or accepts from us.
2. **Spec:** read `https://spec.matrix.org/<version>/changelog/<version>/`, covering only the *Server-Server API* and *Room Versions* sections. Add a row to [Spec versions](#spec-versions).
3. **Our side:** when room-version support or the default changes, update the [Room versions](#room-versions) table and the default in [Current status](#current-status).
4. Update [Current status](#current-status) and add a line to [Review log](#review-log).

## Review log

| Date | Synapse | Spec | SDK | Notes |
|---|---|---|---|---|
| 2026-10-16 | 1.163.0 | v1.19 | 0.8.1 | Initial version. Found that Synapse 1.162.0 breaks invites from Synapse into new rooms (default v12). Found two gaps: MSC4311 and case-sensitive ACLs. |

## Sources

- Synapse changelog: <https://github.com/element-hq/synapse/blob/develop/CHANGES.md>
- Synapse default bump to v12: <https://github.com/element-hq/synapse/pull/20130>
- Synapse MSC4311 rollout: <https://github.com/element-hq/synapse/pull/19723>
- Spec room versions: <https://spec.matrix.org/latest/rooms/>
- Spec changelogs: <https://spec.matrix.org/v1.19/changelog/v1.16/> (and `v1.17`, `v1.18`, `v1.19`)
- MSC4311: <https://github.com/matrix-org/matrix-spec-proposals/blob/main/proposals/4311-stripped-state-create-event.md>
