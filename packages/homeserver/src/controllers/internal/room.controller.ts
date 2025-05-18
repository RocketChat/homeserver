import {
    Body,
    Controller,
    HttpException,
    HttpStatus,
    Post
} from "@nestjs/common";
import { RoomService } from "../../services/room.service";

@Controller("internal")
export class InternalRoomController {
  constructor(private readonly roomService: RoomService) {}

  @Post("rooms")
  async createRoomEndpoint(@Body() body: { username: string, sender: string }): Promise<unknown> {
    const { username, sender } = body;
    
    try {
      return this.roomService.createRoom(username, sender);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to create room: ${error instanceof Error ? error.message : String(error)}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
} 