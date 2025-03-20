// // /v2/server/{keyID}
// // /v2/server/
// // /v2/server

// // /v2/query
// // /v2/query/{serverName}/{keyID}
// // /v1/send/{txnID}

// // /v1/invite/{roomID}/{eventID}
// // /v2/invite/{roomID}/{eventID}
// // /v3/invite/{roomID}/{userID}
// // /v1/3pid/onbind
// // /v1/exchange_third_party_invite/{roomID}
// // /v1/event/{eventID}
// // /v1/state/{roomID}
// // /v1/state_ids/{roomID}
// // /v1/event_auth/{roomID}/{eventID}
// // /v1/query/directory
// // /v1/query/profile
// // /v1/user/devices/{userID}
// // /v1/peek/{roomID}/{peekID}
// // /v1/make_join/{roomID}/{userID}
// // /v1/send_join/{roomID}/{eventID}
// // /v2/send_join/{roomID}/{eventID}
// // /v1/make_leave/{roomID}/{userID}
// // /v1/send_leave/{roomID}/{eventID}
// // /v2/send_leave/{roomID}/{eventID}
// // /v1/version
// // /v1/get_missing_events/{roomID}
// // /v1/backfill/{roomID}
// // /v1/publicRooms
// // /v1/user/keys/claim
// // /v1/user/keys/query
// // /v1/openid/userinfo
// // /v1/hierarchy/{roomID}

import Elysia from "elysia";
import { app } from "@hs/homeserver";
import { fakeEndpoints } from "@hs/fake";
import { routerWithMongodb } from "@hs/homeserver/src/plugins/mongodb";

import { config } from "./config";
import { db } from "./mongo";
import { routerWithKeyManager } from "@hs/homeserver/src/plugins/keys";

new Elysia({
	handler: {
		standardHostname: false,
	},
})
	.decorate("config", config)
	.use(routerWithMongodb(db))
	.use(routerWithKeyManager(db, config))
	.use(app)
	.use(fakeEndpoints)
	.listen(config.port, (context) => {
		console.log(
			`🦊 Homeserver is running at http://${context.hostname}:${context.port}`,
		);
	});
