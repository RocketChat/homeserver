# Matrix Federation SDK

A simple SDK for Matrix server-to-server communication. This SDK provides a clean interface for making Matrix federation API calls, handling the complex authentication and request signing required by the Matrix specification.

## Features

- Simple, Promise-based API for all Matrix federation endpoints
- Automatic request signing and authentication
- DNS-based server discovery
- Typed responses using Zod schemas
- Comprehensive error handling

## Installation

```bash
# From project root
cd homeserver/packages/federation-sdk
npm install
npm run build
```

## Usage

### Basic Setup

```typescript
import { FederationClient } from '@hs/federation-sdk';
import { generateKeyPairsFromString } from '../../homeserver/src/keys';

// Create signing key
const signingKey = await generateKeyPairsFromString(
  "ed25519 myKey yourPrivateKeyHere"
);

// Create federation client
const client = new FederationClient({
  serverName: "your-server.com",
  signingKey: signingKey,
  debug: true // Optional, enables detailed logging
});
```

### Getting Server Version

```typescript
const targetServer = "matrix.org";

try {
  const version = await client.getVersion(targetServer);
  console.log(`Server version: ${version.server.name} ${version.server.version}`);
} catch (error) {
  console.error(`Error getting version: ${error}`);
}
```

### Querying Room State

```typescript
const targetServer = "matrix.org";
const roomId = "!someRoomId:matrix.org";

try {
  // First get room version
  const roomVersion = await client.getRoomVersion(targetServer, roomId);
  console.log(`Room version: ${roomVersion}`);
  
  // Get state IDs
  const stateIds = await client.getStateIds(targetServer, roomId);
  console.log(`Room has ${stateIds.pdu_ids.length} state events`);
  
  if (stateIds.pdu_ids.length > 0) {
    // Use an event ID to get room state (required by most servers)
    const eventId = stateIds.pdu_ids[0];
    
    // Get full state using a reference event ID
    const state = await client.getState(targetServer, roomId, undefined, undefined, eventId);
    console.log(`Got ${state.pdus.length} state events`);
    
    // Get specific state type
    const powerLevels = await client.getState(
      targetServer, 
      roomId, 
      "m.room.power_levels", 
      "", 
      eventId
    );
    console.log("Power levels:", powerLevels);
  }
} catch (error) {
  console.error(`Error querying room: ${error}`);
}
```

### Sending Events

```typescript
const targetServer = "matrix.org";
const event = {
  type: "m.room.message",
  room_id: "!someRoomId:matrix.org",
  sender: "@youruser:your-server.com",
  content: {
    msgtype: "m.text",
    body: "Hello from Federation SDK!"
  },
  // other required fields
};

try {
  const response = await client.sendEvent(targetServer, event);
  console.log("Event sent successfully:", response);
} catch (error) {
  console.error(`Error sending event: ${error}`);
}
```

### Room Joining Flow

```typescript
const targetServer = "matrix.org";
const roomId = "!someRoomId:matrix.org";
const userId = "@youruser:your-server.com";

try {
  // 1. Prepare to join
  const makeJoinResponse = await client.makeJoin(targetServer, roomId, userId);
  console.log(`Got make_join response with room version ${makeJoinResponse.room_version}`);
  
  // 2. Complete the event (sign it, add hashes, etc.)
  const joinEvent = completeJoinEvent(makeJoinResponse.event);
  
  // 3. Send the join
  const sendJoinResponse = await client.sendJoin(
    targetServer, 
    roomId, 
    joinEvent.event_id, 
    joinEvent
  );
  
  console.log(`Join successful! Got ${sendJoinResponse.state.length} state events`);
} catch (error) {
  console.error(`Join failed: ${error}`);
}
```

## API Documentation

See the [Matrix Federation API Specification](https://spec.matrix.org/v1.7/server-server-api/) for more details on the underlying protocol.

## License

MIT