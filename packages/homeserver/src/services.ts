import { container } from 'tsyringe';
import { RoomService } from './services/room.service';
import { MessageService } from './services/message.service';
import { EventService } from './services/event.service';
import { InviteService } from './services/invite.service';

export interface HomeserverServices {
  room: RoomService;
  message: MessageService;
  event: EventService;
  invite: InviteService;
}

export function getAllServices(): HomeserverServices {
  return {
    room: container.resolve(RoomService),
    message: container.resolve(MessageService),
    event: container.resolve(EventService),
    invite: container.resolve(InviteService),
  };
}