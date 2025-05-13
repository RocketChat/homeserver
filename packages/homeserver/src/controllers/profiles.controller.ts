import { Body, Controller, Get, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import { ProfilesService } from '../services/profiles.service';
import { Logger } from "../utils/logger";

const logger = new Logger("ProfilesController");

@Controller('/_matrix/federation/v1')
@Injectable()
export class ProfilesController {
    constructor(
        @Inject(ProfilesService) private readonly profilesService: ProfilesService
    ) {}

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
        @Query() query: any
    ) {
        return this.profilesService.makeJoin(roomId, userId, query.ver);
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
        @Query() query: any
    ) {
        return this.profilesService.eventAuth(roomId, eventId);
    }
}