import { Body, Controller, Get, Param, Post, Query, UsePipes } from '@nestjs/common';
import { ProfilesService } from '../../services/profiles.service';
import { z } from 'zod';
import { ZodValidationPipe } from '../../validation/pipes/zod-validation.pipe';

const MakeJoinQueryParamsSchema = z.object({
    ver: z.array(z.string()).optional()
});

type MakeJoinQueryParamsDto = z.infer<typeof MakeJoinQueryParamsSchema>;
type MakeJoinResponseDto = {
    room_version: string;
    event: {
        content: {
            membership: 'join';
            join_authorised_via_users_server?: string;
            [key: string]: any;
        };
        room_id: string;
        sender: string;
        state_key: string;
        type: 'm.room.member';
        origin_server_ts: number;
        origin: string;
        [key: string]: any;
    };
};
@Controller('/_matrix/federation/v1')
export class ProfilesController {
    constructor(private readonly profilesService: ProfilesService) { }

    @Get("/query/profile")
    async queryProfile(@Query() queryParams: { user_id: string }) {
        return this.profilesService.queryProfile(queryParams.user_id);
    }

    @Post("/user/keys/query")
    async queryKeys(@Body() body: { device_keys: Record<string, string> }) {
        return this.profilesService.queryKeys(body.device_keys);
    }

    @Get("/user/devices/:userId")
    async getDevices(@Param("userId") userId: string) {
        return this.profilesService.getDevices(userId);
    }

    @Get("/make_join/:roomId/:userId")
    async makeJoin(
        @Param("roomId") roomId: string,
        @Param("userId") userId: string,
        @Query(new ZodValidationPipe(MakeJoinQueryParamsSchema)) query: MakeJoinQueryParamsDto,
    ): Promise<MakeJoinResponseDto> {
        const response = await this.profilesService.makeJoin(roomId, userId, query.ver);

        return {
            room_version: response.room_version,
            event: {
                ...response.event,
                content: {
                    ...response.event.content,
                    membership: 'join',
                    join_authorised_via_users_server: response.event.content.join_authorised_via_users_server,

                },
                room_id: response.event.room_id,
                sender: response.event.sender,
                state_key: response.event.state_key,
                type: 'm.room.member',
                origin_server_ts: response.event.origin_server_ts,
                origin: response.event.origin,
            }
        }
    }

    @Post("/get_missing_events/:roomId")
    async getMissingEvents(
        @Param("roomId") roomId: string,
        @Body() body: { earliest_events: string[], latest_events: string[], limit: number }
    ) {
        return this.profilesService.getMissingEvents(
            roomId,
            body.earliest_events,
            body.latest_events,
            body.limit
        );
    }

    @Get("/event_auth/:roomId/:eventId")
    async eventAuth(
        @Param("roomId") roomId: string,
        @Param("eventId") eventId: string,
    ) {
        return this.profilesService.eventAuth(roomId, eventId);
    }
}