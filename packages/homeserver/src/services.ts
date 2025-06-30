import { container } from "tsyringe";
import { RoomService } from "./services/room.service";
import { MessageService } from "./services/message.service";
import { EventService } from "./services/event.service";
import { InviteService } from "./services/invite.service";
import { WellKnownService } from "./services/well-known.service";
import { ProfilesService } from "./services/profiles.service";

export interface HomeserverServices {
  room: RoomService;
  message: MessageService;
  event: EventService;
  invite: InviteService;
  wellKnown: WellKnownService;
  profile: ProfilesService;
}

export function getAllServices(): HomeserverServices {
  return {
    room: container.resolve(RoomService),
    message: container.resolve(MessageService),
    event: container.resolve(EventService),
    invite: container.resolve(InviteService),
    wellKnown: container.resolve(WellKnownService),
    profile: container.resolve(ProfilesService),
  };
}
