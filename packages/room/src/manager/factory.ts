import {
  type PduMembershipEventContent,
  PduTypeRoomCreate,
  PduTypeRoomMember,
  PduTypeRoomPowerLevels,
  type PduCreateEventContent,
  type PduV1,
  PduTypeRoomName,
  type PduRoomNameEventContent,
  PduTypeRoomJoinRules,
  type PduJoinRuleEventContent,
  PduTypeRoomMessage,
} from "../types/v1";
import type { PduV3 } from "../types/v3";
import type { PduPowerLevelsEventV10Content, PduV10 } from "../types/v10";

import { PersistentEventV1 } from "./v1";
import { PersistentEventV3 } from "./v3";
import { PersistentEventV10 } from "./v10";

import type {
  PduVersionForRoomVersionWithOnlyRequiredFields,
  RoomVersion,
} from "./type";
import type { PersistentEventBase } from "./event-wrapper";
import { PersistentEventV6 } from "./v6";
import { PersistentEventV8 } from "./v8";
import { PersistentEventV9 } from "./v9";
import { PersistentEventV11 } from "./v11";

// Utility function to create a random ID for room creation
function createRoomIdPrefix(length: number) {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters[randomIndex];
  }
  return result;
}

// The idea is to ALWAYS use this to create different events
export class PersistentEventFactory {
  static createFromRawEvent(
    event: PduV1 | PduV3 | PduV10,
    roomVersion: RoomVersion
  ): PersistentEventBase<RoomVersion> {
    switch (roomVersion) {
      case "1":
      case "2":
        return new PersistentEventV1(event as any, true);
      case "3":
      case "4":
      case "5":
        return new PersistentEventV3(event as any, true);
      case "6":
      case "7":
        return new PersistentEventV6(event as any, true);
      case "8":
        return new PersistentEventV8(event as any, true);
      case "9":
        return new PersistentEventV9(event as any, true);
      case "10":
        return new PersistentEventV10(event as any, true);
      case "11":
        return new PersistentEventV11(event as any, true);
      default:
        throw new Error(`Unknown room version: ${roomVersion}`);
    }
  }

  // create individual events

  // a m.room.create event, adds the roomId too
  static newCreateEvent(creator: string, roomVersion: RoomVersion) {
    if (roomVersion !== "11") {
      throw new Error(`Room version ${roomVersion} is not supported`);
    }

    const createContent: PduCreateEventContent = {
      room_version: roomVersion,
      creator,
      "m.federate": true,
    };

    const domain = creator.split(":").pop();

    const roomId = `!${createRoomIdPrefix(8)}:${domain}`;

    const eventPartial: PduVersionForRoomVersionWithOnlyRequiredFields<"11"> = {
      type: PduTypeRoomCreate,
      state_key: "",
      content: createContent,
      sender: creator,
      origin_server_ts: Date.now(),
      room_id: roomId,
      prev_events: [],
      auth_events: [],
      depth: 0,
    };

    // FIXME: typing
    return new PersistentEventV11(eventPartial as any);
  }

  static newMembershipEvent(
    roomId: string,
    sender: string,
    userId: string,
    membership: PduMembershipEventContent["membership"],
    roomInformation: PduCreateEventContent
  ) {
    if (roomInformation.room_version !== "11") {
      throw new Error(
        `Room version ${roomInformation.room_version} is not supported`
      );
    }

    const displayname = userId.split(":").shift()?.slice(1);

    if (!displayname) {
      throw new Error(
        "Displayname not found while trying to create a membership event"
      );
    }

    // @ts-ignore
    // TODO: those props are not mandatory
    const membershipContent: PduMembershipEventContent = {
      membership,
      displayname,
      // is_direct: roomInformation.type === 'direct',
      // join_authorised_via_users_server: '',
    };

    const eventPartial: PduVersionForRoomVersionWithOnlyRequiredFields<"11"> = {
      type: PduTypeRoomMember,
      content: membershipContent,
      sender: sender,
      origin_server_ts: Date.now(),
      room_id: roomId,
      state_key: userId,
      // fix these in the caller
      prev_events: [],
      auth_events: [],
      depth: 0,
    };

    // FIXME: typing
    return new PersistentEventV11(eventPartial as any);
  }

  static newPowerLevelEvent(
    roomId: string,
    sender: string,
    content: PduPowerLevelsEventV10Content,
    roomVersion: RoomVersion
  ) {
    if (roomVersion !== "11") {
      throw new Error(`Room version ${roomVersion} is not supported`);
    }

    const eventPartial: PduVersionForRoomVersionWithOnlyRequiredFields<"11"> = {
      type: PduTypeRoomPowerLevels,
      content: content,
      sender: sender,
      origin_server_ts: Date.now(),
      room_id: roomId,
      state_key: "",
      prev_events: [],
      auth_events: [],
      depth: 0,
    };

    return new PersistentEventV11(eventPartial as any);
  }

  static newRoomNameEvent(
    roomId: string,
    sender: string,
    name: string,
    roomVersion: RoomVersion
  ) {
    if (roomVersion !== "11") {
      throw new Error(`Room version ${roomVersion} is not supported`);
    }

    const eventPartial: PduVersionForRoomVersionWithOnlyRequiredFields<"11"> = {
      type: PduTypeRoomName,
      // @ts-ignore not sure why this is not working
      content: { name } as PduRoomNameEventContent,
      sender: sender,
      origin_server_ts: Date.now(),
      room_id: roomId,
      state_key: "",
      prev_events: [],
      auth_events: [],
      depth: 0,
    };

    return new PersistentEventV11(eventPartial as any);
  }

  static newJoinRuleEvent(
    roomId: string,
    sender: string,
    joinRule: PduJoinRuleEventContent["join_rule"],
    roomVersion: RoomVersion
  ) {
    if (roomVersion !== "11") {
      throw new Error(`Room version ${roomVersion} is not supported`);
    }

    const eventPartial: PduVersionForRoomVersionWithOnlyRequiredFields<"11"> = {
      type: PduTypeRoomJoinRules,
      content: { join_rule: joinRule },
      sender: sender,
      origin_server_ts: Date.now(),
      room_id: roomId,
      state_key: "",
      prev_events: [],
      auth_events: [],
      depth: 0,
    };

    return new PersistentEventV11(eventPartial as any);
  }

  static newMessageEvent(
    roomId: string,
    sender: string,
    text: string,
    roomVersion: RoomVersion
  ) {
    if (roomVersion !== "11") {
      throw new Error(`Room version ${roomVersion} is not supported`);
    }

    const eventPartial: PduVersionForRoomVersionWithOnlyRequiredFields<"11"> = {
      type: PduTypeRoomMessage,
      content: {
        // @ts-ignore payload copied from synapse, keeping as is for now
        msgtype: "m.text",
        body: text,
      },
      sender: sender,
      origin_server_ts: Date.now(),
      room_id: roomId,
      prev_events: [],
      auth_events: [],
      depth: 0,
    };

    return new PersistentEventV11(eventPartial as any);
  }
}
