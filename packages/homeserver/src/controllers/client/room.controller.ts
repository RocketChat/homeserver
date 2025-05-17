import { Controller, Post, Body, HttpException, HttpStatus, Logger, UsePipes, Inject } from '@nestjs/common';
import { ConfigService } from '../../services/config.service';
import { z } from 'zod';
import { ClientRoomService } from '../../services/client/room.service';
import { ZodValidationPipe } from '../../validation/pipes';

const createRoomSchema = z.object({
    username: z.string({
        required_error: 'Username is required',
        invalid_type_error: 'Username must be a string',
    }).min(1, 'Username cannot be empty'),
    sender: z.string({
        required_error: 'Sender is required',
        invalid_type_error: 'Sender must be a string',
    }).min(1, 'Sender cannot be empty'),
});

const inviteUserToRoomSchema = z.object({
    username: z.string({
        required_error: 'Username is required',
        invalid_type_error: 'Username must be a string',
    }).min(1, 'Username cannot be empty'),
    sender: z.string({
        invalid_type_error: 'Sender must be a string',
    }).min(1, 'Sender cannot be empty').optional(),
    roomId: z.string({
        invalid_type_error: 'Room ID must be a string',
    }).min(1, 'Room ID cannot be empty').optional(),
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type InviteUserToRoomInput = z.infer<typeof inviteUserToRoomSchema>;

@Controller('matrix/client/rooms')
export class ClientRoomsController {
    private readonly logger = new Logger(ClientRoomsController.name);

    constructor(
        private readonly configService: ConfigService,
        private readonly roomService: ClientRoomService,
    ) {
    }

    @Post('/createRoom')
    @UsePipes(new ZodValidationPipe(createRoomSchema))
    async createRoom(@Body() createRoomInput: CreateRoomInput) {
        try {
            return this.roomService.create(createRoomInput.username, createRoomInput.sender);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new HttpException({
                success: false,
                message: 'Failed to create room',
                error: errorMessage,
            }, HttpStatus.BAD_REQUEST);
        }
    }

    @Post('/inviteUserToRoom')
    @UsePipes(new ZodValidationPipe(inviteUserToRoomSchema))
    async inviteUserToRoom(@Body() inviteUserToRoomInput: InviteUserToRoomInput) {
        try {
            return this.roomService.invite(inviteUserToRoomInput);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new HttpException({
                success: false,
                message: 'Failed to invite user to room',
                error: errorMessage,
            }, HttpStatus.BAD_REQUEST);
        }
    }
}
