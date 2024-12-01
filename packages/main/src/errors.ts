interface ErrorResponse<TCode extends string> {
  errcode: TCode;
  error: string;
}

function createError<const TCode extends string>(
  code: TCode,
  message: string
): ErrorResponse<TCode>;
function createError<const TCode extends string, TExtra extends object>(
  code: TCode,
  message: string,
  extra: TExtra
): ErrorResponse<TCode> & TExtra;
function createError(code: string, message: string, extra?: object) {
  return {
    errcode: code,
    error: message,
    ...extra,
  };
}

// Common errors

/** Forbidden access, e.g. joining a room without permission, failed login. */
export const forbidden = (error: string) => createError("M_FORBIDDEN", error);
/** The access or refresh token specified was not recognised. */
export const unknownToken = (
  error: string,
  { softLogout }: { softLogout?: boolean } = {}
) =>
  createError("M_UNKNOWN_TOKEN", error, {
    ...(softLogout !== undefined && { soft_logout: softLogout }),
  });
/** No access token was specified for the request. */
export const missingToken = (error: string) =>
  createError("M_MISSING_TOKEN", error);
/** The account has been locked and cannot be used at this time. */
export const userLocked = (error: string) =>
  createError("M_USER_LOCKED", error);
/** Request contained valid JSON, but it was malformed in some way, e.g. missing required keys, invalid values for keys. */
export const badJSON = (error: string) => createError("M_BAD_JSON", error);
/** Request did not contain valid JSON. */
export const notJSON = (error: string) => createError("M_NOT_JSON", error);
/** No resource was found for this request. */
export const notFound = (error: string) => createError("M_NOT_FOUND", error);
/** Too many requests have been sent in a short period of time. Wait a while then try again. */
export const limitExceeded = (error: string) =>
  createError("M_LIMIT_EXCEEDED", error);
/**
 * The server did not understand the request.
 *
 * This is expected to be returned with a 404 HTTP status code if the endpoint is not implemented or a 405 HTTP status code if the endpoint is implemented, but the incorrect HTTP method is used.
 */
export const unrecognized = (error: string) =>
  createError("M_UNRECOGNIZED", error);
/** An unknown error has occurred. */
export const unknown = (error: string) => createError("M_UNKNOWN", error);

// Other errors

/** The request was not correctly authorized. Usually due to login failures. */
export const unauthorized = (error: string) =>
  createError("M_UNAUTHORIZED", error);

/**
 * The user ID associated with the request has been deactivated.
 *
 * Typically for endpoints that prove authentication, such as /login.
 */
export const userDeactivated = (error: string) =>
  createError("M_USER_DEACTIVATED", error);

/** Encountered when trying to register a user ID which has been taken. */
export const userInUse = (error: string) => createError("M_USER_IN_USE", error);

/** Encountered when trying to register a user ID which is not valid. */
export const invalidUsername = (error: string) =>
  createError("M_INVALID_USERNAME", error);

/** Sent when the room alias given to the createRoom API is already in use. */
export const roomInUse = (error: string) => createError("M_ROOM_IN_USE", error);

/** Sent when the initial state given to the createRoom API is invalid. */
export const invalidRoomState = (error: string) =>
  createError("M_INVALID_ROOM_STATE", error);

/** Sent when a threepid given to an API cannot be used because the same threepid is already in use. */
export const threepidInUse = (error: string) =>
  createError("M_THREEPID_IN_USE", error);

/** Sent when a threepid given to an API cannot be used because no record matching the threepid was found. */
export const threepidNotFound = (error: string) =>
  createError("M_THREEPID_NOT_FOUND", error);

/** Authentication could not be performed on the third-party identifier. */
export const threePidAuthFailed = (error: string) =>
  createError("M_THREEPID_AUTH_FAILED", error);

/**
 * The server does not permit this third-party identifier.
 *
 * This may happen if the server only permits, for example, email addresses from a particular domain.
 */
export const threePidDenied = (error: string) =>
  createError("M_THREEPID_DENIED", error);

/** The client’s request used a third-party server, e.g. identity server, that this server does not trust. */
export const serverNotTrusted = (error: string) =>
  createError("M_SERVER_NOT_TRUSTED", error);

/** The client’s request to create a room used a room version that the server does not support. */
export const unsupportedRoomVersion = (error: string) =>
  createError("M_UNSUPPORTED_ROOM_VERSION", error);

/**
 * The client attempted to join a room that has a version the server does not support.
 *
 * Inspect the room_version property of the error response for the room’s version.
 */
export const incompatibleRoomVersion = (error: string) =>
  createError("M_INCOMPATIBLE_ROOM_VERSION", error);

/** The state change requested cannot be performed, such as attempting to unban a user who is not banned. */
export const badState = (error: string) => createError("M_BAD_STATE", error);

/** The room or resource does not permit guests to access it. */
export const guestAccessForbidden = (error: string) =>
  createError("M_GUEST_ACCESS_FORBIDDEN", error);

/** A Captcha is required to complete the request. */
export const captchaNeeded = (error: string) =>
  createError("M_CAPTCHA_NEEDED", error);

/** The Captcha provided did not match what was expected. */
export const captchaInvalid = (error: string) =>
  createError("M_CAPTCHA_INVALID", error);

/** A required parameter was missing from the request. */
export const missingParam = (error: string) =>
  createError("M_MISSING_PARAM", error);

/**
 * A parameter that was specified has the wrong value.
 *
 * For example, the server expected an integer and instead received a string.
 */
export const invalidParam = (error: string) =>
  createError("M_INVALID_PARAM", error);

/** The request or entity was too large. */
export const tooLarge = (error: string) => createError("M_TOO_LARGE", error);

/** The resource being requested is reserved by an application service, or the application service making the request has not created the resource. */
export const exclusive = (error: string) => createError("M_EXCLUSIVE", error);

/**
 * The request cannot be completed because the homeserver has reached a resource limit imposed on it.
 *
 * For example, a homeserver held in a shared hosting environment may reach a resource limit if it starts using too much memory or disk space.
 *
 * The error MUST have an admin_contact field to provide the user receiving the error a place to reach out to.
 *
 * Typically, this error will appear on routes which attempt to modify state (e.g.: sending messages, account data, etc) and not routes which only read state (e.g.: /sync, get account data, etc).
 */
export const resourceLimitExceeded = (
  error: string,
  { adminContact }: { adminContact: string }
) =>
  createError("M_RESOURCE_LIMIT_EXCEEDED", error, {
    admin_contact: adminContact,
  });

/** The user is unable to reject an invite to join the server notices room. */
export const cannotLeaveServerNoticeRoom = (error: string) =>
  createError("M_CANNOT_LEAVE_SERVER_NOTICE_ROOM", error);
