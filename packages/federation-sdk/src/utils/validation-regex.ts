export const USERNAME_REGEX = /^@[A-Za-z0-9_=/.+-]+:(.+)$/;
// !opaque:server up to room v11 (the capture group is the server), or from v12 the 43 character
// url-safe base64 hash of the create event, which has no server and leaves the group undefined
export const ROOM_ID_REGEX = /^!(?:[A-Za-z0-9_=/.+-]+:(.+)|[A-Za-z0-9_-]{43})$/;
