import Elysia from "elysia";

export const profileEndpoints = new Elysia()
    .get('/query/profile', () => ({
        "avatar_url": "mxc://matrix.org/MyC00lAvatar",
        "displayname": "John Doe"
    }))

