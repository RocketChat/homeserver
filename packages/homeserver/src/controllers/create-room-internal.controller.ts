import { Inject, Post } from "@nestjs/common";

import { Controller } from "@nestjs/common";
import { ConfigService } from "../services/config.service";
import { EventService } from "../services/event.service";
import { FederationService } from "../services/federation.service";
import { RoomService } from "../services/room.service";
import { Logger } from "../utils/logger";

@Controller("internal")
export class CreateRoomInternalController {
	private readonly logger = new Logger('CreateRoomInternalController');

	constructor(
    @Inject(FederationService) private readonly federationService: FederationService,
    @Inject(EventService) private readonly eventService: EventService,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(RoomService) private readonly roomService: RoomService,
  ) {}

@Post('create-room')
  async createRoom(@Body() body) {
    const room = await this.roomService.createRoom(body);
  }
}