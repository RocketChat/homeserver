import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "./config.service";
import { verifySignaturesFromRemote } from "../signJson";
import { KeyRepository } from "../repositories/key.repository";
import type { WithId } from "mongodb";
import type { V2KeyQueryBody, V2KeyQueryResponse } from "@hs/core/src/query";
import { getKeyPair, type SigningKey } from "../keys";
import type { KeyV2ServerResponse, ServerKey } from "@hs/typings";

const logger = new Logger("KeyService");

@Injectable()
export class KeyService {
  private key: SigningKey | undefined;

  constructor(
    @Inject(ConfigService)
    private readonly configService: ConfigService,
    @Inject(KeyRepository) private readonly keyRepository: KeyRepository
  ) {
    this.configService.getSigningKey().then((key) => {
      this.key = key[0];
    });
  }

  private shouldRefetchKey(
    serverName: string, // for logging
    key: ServerKey["keys"][string],
    validUntil?: number // minimum_valid_until_ts
  ) {
    if (validUntil) {
      if (key.expiresAt < validUntil) {
        logger.log(
          `Key for ${serverName} is expired, ${key.expiresAt} < ${validUntil}, refetching keys`
        );
        return true;
      }

      return false;
    }

    if ((key._createdAt.getTime() + key.expiresAt) / 2 < Date.now()) {
      logger.log(`Half life for key for ${serverName} is expired`);
      return true;
    }
  }

  async validateKeySignature(
    serverName: string,
    serverkey: KeyV2ServerResponse
  ) {
    const signatureKey = serverkey.signatures[serverName];
    if (!signatureKey) {
      throw new Error(`No signature key found for origin server ${serverName}`);
    }

    // validate the response first
    for (const keyId of Object.keys(signatureKey)) {
      const { key } = serverkey.verify_keys[keyId] ?? {};
      if (key) {
        await verifySignaturesFromRemote(
          serverkey,
          serverName,
          async () => new Uint8Array(Buffer.from(key, "base64"))
        );
      }
    }
  }

  // TODO: support using separate notary server, for now we use the same server
  // since using the same server, we do not need to verify the signature, or rather we can not.
  // because this is the only way we get fetch the key of the server we are using.
  // TODO: once notary server is implemented, we need to verify the signature of the server we are using.
  // one could say this implementation is not the most ideal.
  // however, gotta use this path to get the tests to pass
  async fetchKeysRemote(serverName: string): Promise<KeyV2ServerResponse> {
    // this doesn't need to be signed request
    // notmal http is enough

    // 1. get the response from the server
    const response = await fetch(
      // TODO: move to federation-sdk
      `https://${serverName}/_matrix/key/v2/server`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch keys from ${serverName}`);
    }

    const data: KeyV2ServerResponse = await response.json(); // intentional throw

    // weird but to be sure
    if (data.server_name !== serverName) {
      throw new Error(
        `Server name mismatch: ${data.server_name} !== ${serverName}`
      );
    }

    // make sure is signed by the originating server
    await this.validateKeySignature(serverName, data);

    return data;
  }

  convertKeyToKeyV2ServerResponse(
    key: ServerKey
  ): Omit<KeyV2ServerResponse, "signatures"> {
    const { serverName, keys } = key;

    const verifyKeys = {} as KeyV2ServerResponse["verify_keys"];
    const oldVerifyKeys = {} as KeyV2ServerResponse["old_verify_keys"];

    let validUntilTs = 0;

    for (const [keyId, { key, expiresAt, expiredTs }] of Object.entries(keys)) {
      if (expiredTs) {
        oldVerifyKeys[keyId] = { expired_ts: expiredTs, key };
        continue;
      }

      // any other key should not be expired
      verifyKeys[keyId] = { key };

      // pick the largest - it should always be one
      if (expiresAt > validUntilTs) {
        validUntilTs = expiresAt;
      }
    }

    return {
      server_name: serverName,
      verify_keys: verifyKeys,
      old_verify_keys: oldVerifyKeys,
      valid_until_ts: validUntilTs,
    };
  }

  convertKeyV2ServerResponseToKey(keyResponse: KeyV2ServerResponse) {
    const keys = {} as ServerKey["keys"];

    for (const keyId of Object.keys(keyResponse.verify_keys)) {
      const { key } = keyResponse.verify_keys[keyId];
      keys[keyId] = {
        key,
        _createdAt: new Date(),
        expiresAt: keyResponse.valid_until_ts,
      };
    }

    for (const keyId of Object.keys(keyResponse.old_verify_keys)) {
      const { key, expired_ts } = keyResponse.old_verify_keys[keyId];
      keys[keyId] = {
        key,
        _createdAt: new Date(),
        expiresAt: keyResponse.valid_until_ts,
        expiredTs: expired_ts,
      };
    }
    return {
      serverName: keyResponse.server_name,
      keys,
    };
  }

  // fetchKeys completes a query request essentially
  async fetchAndStoreKey(
    serverName: string,
    { keyId, validUntil }: { keyId?: string; validUntil?: number }
  ): Promise<ServerKey["keys"] | null> {
    // 1. check db
    const { keys = {} } =
      (await this.keyRepository.findAllKeyForServerName(serverName)) ?? {};

    logger.log(`Key for ${serverName}: ${JSON.stringify(keys)}`);

    const validKeys = Object.entries(keys).filter(([id, key]) => {
      return (
        keyId === id && !this.shouldRefetchKey(serverName, key, validUntil)
      );
    });

    logger.log(
      `Found ${validKeys.length} keys in db for ${serverName}, ${JSON.stringify(
        validKeys
      )}`
    );

    // we return these valid keys
    if (validKeys.length > 0) {
      //   const validKeyObj = validKeys.reduce((acc, [keyId, key]) => {
      //     acc[keyId] = key;
      //     return acc;
      //   }, {} as ServerKey["keys"]);

      //   return this.convertKeyToKeyV2ServerResponse({
      //     serverName,
      //     keys: validKeyObj,
      //   });
      return keys;
    }

    logger.log(
      `No valid keys found in db for ${serverName}, fetching remote keys`
    );

    try {
      const remoteKeys = await this.fetchKeysRemote(serverName);

      logger.log(
        `Fetched keys for ${serverName}, JSON: ${JSON.stringify(remoteKeys)}`
      );

      // if not expired store, irrespective of the keyId as we may use this later to validate requests or events
      for (const keyId of Object.keys(remoteKeys.verify_keys)) {
        const stored = await this.keyRepository.storeKey(
          serverName,
          keyId,
          remoteKeys.verify_keys[keyId].key,
          remoteKeys.valid_until_ts
        );

        logger.log(
          `Stored key for ${serverName} ${keyId}: ${JSON.stringify(stored)}`
        );
      }

      if (keyId && !Object.keys(remoteKeys.verify_keys).includes(keyId)) {
        // was not asked about this key
        logger.log(
          `Was not asked about this key ${keyId}, returning empty array`
        );
        return null;
      }

      // for /query controller yes this is a bit double work, however returning as ServerKey['keys'] makes the service feel more internal than external.
      // coupled with the higher use it's a "meh" decision.
      // TODO: maybe have a separate path ????
      return this.convertKeyV2ServerResponseToKey(remoteKeys).keys;
    } catch (e) {
      logger.error(
        `Error fetching keys for ${serverName}: ${e}, returning cached keys`
      );
      return keys;
    }
  }

  async getValidVerifyKey(
    serverName: string,
    keyId: string
  ): Promise<string | null> {
    let depth = 0;
    const _fetch = async () => {
      if (depth) {
        return null;
      }

      const key = await this.keyRepository.findKey(serverName, keyId);

      if (
        !key ||
        key.keys[keyId].expiredTs ||
        key.keys[keyId].expiresAt < Date.now()
      ) {
        logger.error(
          `Key for ${serverName} is expired, ${
            key?.keys[keyId].expiresAt
          } < ${Date.now()}`
        );

        // we try to refetch the key
        await this.fetchAndStoreKey(serverName, {
          keyId,
          validUntil: Date.now(),
        });

        depth++;

        return _fetch();
      }
      return key.keys[keyId].key;
    };

    return _fetch();
  }

  async getValidVerifyKeys(serverName: string, keyIds: string[]) {
    const keys = await this.keyRepository.findAllKeyForServerName(serverName);

    const keysToFind = keys
      ? Object.keys(keys.keys).filter((keyId) => !keyIds.includes(keyId))
      : keyIds;

    const foundKeys = await Promise.all(
      keysToFind.map((keyToFind) =>
        this.fetchAndStoreKey(serverName, {
          keyId: keyToFind,
          validUntil: Date.now(),
        })
      )
    );

    if (keys) {
      // ?/
      //
    }

    return foundKeys;
  }

  //   async fetchKeysFromServer(
  //     notaryServerName: string,
  //     request: Record<string, Record<string, { validUntil: number }>>
  //   ) {
  //     const foundkeys = [];
  //     const notaryQueryRequest = {} as V2KeyQueryBody["server_keys"];

  //     // FIXME: pointless
  //     for (const [serverName, filter] of Object.entries(request)) {
  //       for (const [keyId, { validUntil }] of Object.entries(filter)) {
  //         const keys = await this.keyRepository.findKeys(
  //           serverName,
  //           keyId,
  //           validUntil
  //         );
  //         const keysArray = await keys.toArray();

  //         if (keysArray.length === 0) {
  //           notaryQueryRequest[serverName] = {
  //             [keyId]: { minimum_valid_until_ts: validUntil },
  //           };
  //         } else {
  //           foundkeys.push(...keysArray);
  //         }
  //       }
  //     }

  //     if (Object.keys(notaryQueryRequest).length > 0) {
  //       // make sure we have the keys for the notary server
  //       const notaryKeys = await this.fetchKeys(notaryServerName, {
  //         keyId: undefined,
  //         validUntil: undefined,
  //       });

  //       const notaryQueryResponse = await fetch(
  //         `https://${notaryServerName}/_matrix/key/v2/query`,
  //         {
  //           method: "POST",
  //           body: JSON.stringify(notaryQueryRequest),
  //         }
  //       );

  //       if (!notaryQueryResponse.ok) {
  //         throw new Error(
  //           `Failed to fetch keys from notary server ${notaryServerName}`
  //         );
  //       }

  //       const notaryQueryResponseData: V2KeyQueryResponse =
  //         await notaryQueryResponse.json();

  //       for (const serverKey of notaryQueryResponseData.server_keys) {
  //         try {
  //           await this.validateKeySignature(notaryServerName, serverKey);
  //         } catch (e) {
  //           logger.error(
  //             `Error validating key signature for ${notaryServerName}: ${e}`
  //           );
  //           continue;
  //         }

  //         foundkeys.push(serverKey);
  //       }
  //     }

  //     await Promise.all(foundkeys.map((key) => this.keyRepository.storeKey(key)));

  //     return foundkeys;
  //   }
}
