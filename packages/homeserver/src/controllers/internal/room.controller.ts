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

const UpdateUserPowerLevelSchema = z.object({
  senderUserId: z.string().min(1), 
  powerLevel: z.number().int(), 
  targetServers: z.array(z.string()).optional(), 
});

const LeaveRoomDtoSchema = z.object({
  senderUserId: z.string().trim().min(1, { message: "Sender ID must be a non-empty string" }),
  targetServers: z.array(z.string()).optional(),
});

const KickUserDtoSchema = z.object({
  userIdToKick: z.string().trim().min(1, { message: "User ID to kick must be a non-empty string" }),
  senderUserId: z.string().trim().min(1, { message: "Sender ID must be a non-empty string" }),
  reason: z.string().optional(),
  targetServers: z.array(z.string()).optional(),
});

type UpdateRoomNameDto = z.infer<typeof UpdateRoomNameDtoSchema>;
type UpdateUserPowerLevelDto = z.infer<typeof UpdateUserPowerLevelSchema>;
type LeaveRoomDto = z.infer<typeof LeaveRoomDtoSchema>;
type KickUserDto = z.infer<typeof KickUserDtoSchema>;

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

	@Put("/:roomId/permissions/:userId")
	async updateUserPowerLevel(
		@Param("roomId", new ZodValidationPipe(z.string().trim().min(1, { message: "Room ID must be a non-empty string" }))) roomId: string,
		@Param("userId", new ZodValidationPipe(z.string().trim().min(1, { message: "User ID must be a non-empty string" }))) userId: string,
		@Body(new ZodValidationPipe(UpdateUserPowerLevelSchema)) body: UpdateUserPowerLevelDto,
	): Promise<{ eventId: string }> {
		try {
			const eventId = await this.roomService.updateUserPowerLevel(
				roomId,
				userId,
				body.powerLevel,
				body.senderUserId,
				body.targetServers,
			);
			return { eventId };
		} catch (error) {
      console.error(error);
			if (error instanceof HttpException) {
				throw error;
			}
			throw new HttpException(
				"Failed to update user power level.",
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
	}

  @Post("/:roomId/leave")
  async leaveRoomEndpoint(
    @Param("roomId", new ZodValidationPipe(z.string().trim().min(1, { message: "Room ID must be a non-empty string" }))) roomId: string,
    @Body(new ZodValidationPipe(LeaveRoomDtoSchema)) body: LeaveRoomDto,
  ): Promise<{ eventId: string }> {
    const { senderUserId, targetServers } = body;

    try {
      const eventId = await this.roomService.leaveRoom(roomId.trim(), senderUserId, targetServers);
      return { eventId };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to leave room: ${error instanceof Error ? error.message : String(error)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("/:roomId/members/:memberId/kick")
  async kickUserFromRoom(
    @Param("roomId", new ZodValidationPipe(z.string().trim().min(1, { message: "Room ID must be a non-empty string" }))) roomId: string,
    @Param("memberId", new ZodValidationPipe(z.string().trim().min(1, { message: "Member ID must be a non-empty string" }))) memberId: string, // This is the user being kicked
    @Body(new ZodValidationPipe(KickUserDtoSchema)) body: KickUserDto,
  ): Promise<{ eventId: string }> {
    const { senderUserId, reason, targetServers } = body;

    if (body.userIdToKick !== memberId) {
        throw new HttpException(
            "User ID in path does not match user ID in body (userIdToKick).",
            HttpStatus.BAD_REQUEST,
        );
    }

    try {
      const eventId = await this.roomService.kickUser(
        roomId.trim(),
        memberId,
        senderUserId,
        reason,
        targetServers,
      );
      return { eventId };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to kick user from room: ${error instanceof Error ? error.message : String(error)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
} 