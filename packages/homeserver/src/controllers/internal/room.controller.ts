import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put
} from "@nestjs/common";
import { z } from 'zod';
import { RoomService } from "../../services/room.service";
import { ZodValidationPipe } from '../../validation/pipes/zod-validation.pipe';

const UpdateRoomNameDtoSchema = z.object({
  name: z.string().trim().min(1, { message: "Room name must be a non-empty string" }),
  senderUserId: z.string().trim().min(1, { message: "Sender ID must be a non-empty string" }),
  targetServer: z.string().trim().min(1, { message: "Target server must be a non-empty string" }),
});

type UpdateRoomNameDto = z.infer<typeof UpdateRoomNameDtoSchema>;

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
      @Param("roomId", new ZodValidationPipe(z.string().trim().min(1, { message: "Room ID must be a non-empty string" }))) roomId: string,
      @Body(new ZodValidationPipe(UpdateRoomNameDtoSchema)) body: UpdateRoomNameDto,
    ): Promise<{ eventId: string }> {
      const { name, senderUserId, targetServer } = body;
  
      try {
        const eventId = await this.roomService.updateRoomName(roomId.trim(), name, senderUserId, targetServer);
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