import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put
} from "@nestjs/common";
import { RoomService } from "../../services/room.service";

interface UpdateRoomNameDto {
  name: string;
  senderUserId: string;
  targetServer: string;
}

@Controller("internal/rooms")
export class InternalRoomController {
  constructor(private readonly roomService: RoomService) {}

  @Post()
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

  @Put("/:roomId/name")
    async updateRoomNameEndpoint(
      @Param("roomId") roomId: string,
      @Body() body: UpdateRoomNameDto,
    ): Promise<{ eventId: string }> {
      const { name, senderUserId, targetServer } = body;
  
      // TODO: Add proper authentication and authorization here.
      // For example, verify that `senderUserId` is allowed to update this room's name.
      // const authenticatedUserId = request.user.id; // Example if using Passport or similar
      // if (authenticatedUserId !== senderUserId) {
      //   throw new HttpException("Mismatch in sender ID", HttpStatus.FORBIDDEN);
      // }
  
      // TODO: Move it to Zod validation
      if (!name || typeof name !== 'string' || name.trim() === '') {
        throw new HttpException("Room name must be a non-empty string", HttpStatus.BAD_REQUEST);
      }
      if (!senderUserId || typeof senderUserId !== 'string' || senderUserId.trim() === '') {
        throw new HttpException("Sender ID must be a non-empty string", HttpStatus.BAD_REQUEST);
      }
      if (!roomId || typeof roomId !== 'string' || roomId.trim() === '') {
        throw new HttpException("Room ID must be a non-empty string", HttpStatus.BAD_REQUEST);
      }
  
      try {
        const eventId = await this.roomService.updateRoomName(roomId, name.trim(), senderUserId, targetServer);
        return { eventId };
      } catch (error) {
        if (error instanceof HttpException) {
          throw error;
        }
        throw new HttpException(
          `Failed to update room name: ${error instanceof Error ? error.message : String(error)}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
} 