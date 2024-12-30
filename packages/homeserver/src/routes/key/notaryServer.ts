import { Elysia, t } from "elysia";
import { NotaryServerKeysDTO } from "../../dto";
import { getSignaturesFromRemote, signJson } from "../../signJson";
import { isConfigContext } from "../../plugins/isConfigContext";
import { makeRequest } from "../../makeRequest";
import type { Config } from "../../plugins/config";
import { makeGetServerKeysFromServerProcedure } from "../../procedures/getServerKeysFromRemote";
import { isMongodbContext } from "../../plugins/isMongodbContext";
import type { Response as ServerKeysResponse } from "@hs/core/src/server";
import { isTruthy } from "../../helpers/array";

const parseNotaryResult = async (serverKeys: ServerKeysResponse, config: Config): Promise<ServerKeysResponse> => {
    const { signatures, ...rest } = serverKeys;
    const signed = await signJson(rest, config.signingKey[0], config.name);

    return {
        ...signed,
        signatures: {
            ...signed.signatures,
            ...signatures
        }
    }
}

export const filterServerResponse = (serverKeys: ServerKeysResponse[], filter: {
    [x: string]: {
        [x: string]: {
            minimum_valid_until_ts: number;
        };
    };
}): ServerKeysResponse[] => {
    const servers = Object.keys(filter);
    if (servers.length === 0) {
        return [];
    }

    return serverKeys.filter((serverKey) => {
        const { server_name, valid_until_ts } = serverKey;
        if (!filter[server_name]) {
            return false;
        }

        const filterKeys = Object.keys(filter[server_name]);
        if (filterKeys.length === 0) {
            return true;
        }

        const verifyKeys = Object.keys(serverKey.verify_keys);
        const filteredVerifyKeys = filterKeys.filter((key) => verifyKeys.includes(key));
        if (filteredVerifyKeys.length === 0) {
            return false;
        }

        const greatestTSInFilter = Math.max(...filteredVerifyKeys.map((key) => filter[server_name][key].minimum_valid_until_ts));

        return valid_until_ts > greatestTSInFilter;
    });
}

const getServerKeysFromRemote = async (serverName: string, config: Config) => {
    const result = await makeRequest({
        method: "GET",
        domain: serverName,
        uri: "/_matrix/key/v2/server",
        signingName: config.name,
    });

    const [signature] = await getSignaturesFromRemote(result, serverName);

    if (!signature) {
        throw new Error(`Signatures not found for ${serverName}`);
    }

    return result;
}

export const notaryServerRoutes = new Elysia()
    .get(
        "/query/:serverName",
        async ({ params, body, ...context }) => {
            if (!isConfigContext(context)) {
                throw new Error("No config context");
            }
            if (!isMongodbContext(context)) {
                throw new Error("No mongodb context");
            }

            const { config, mongo } = context;
            const getPublicKeyFromServer = makeGetServerKeysFromServerProcedure(
                mongo.getValidServerKeysFromLocal,
                async () => getServerKeysFromRemote(params.serverName, config),
                mongo.storeServerKeys,
            );

            const serverKeys = await getPublicKeyFromServer(params.serverName, '');
            if (!serverKeys) {
                return { server_keys: [] };
            }

            return {
                server_keys: [await parseNotaryResult(serverKeys, config)],
            };
        },
        {
            params: t.Object(
                {
                    serverName: t.String({
                        description: "The server name to query for keys.",
                    }),
                },
                {
                    examples: [
                        {
                            serverName: "matrix.org",
                        },
                    ],
                },
            ),
            response: NotaryServerKeysDTO,
            detail: {
                description:
                    "Query for another server’s keys. The receiving (notary) server must sign the keys returned by the queried server.",
                operationId: "getServerKeysThroughNotaryServerRequest",
            },
        },
    )
    .post('/query', async ({ params, body, ...context }) => {
        if (!isConfigContext(context)) {
            throw new Error("No config context");
        }
        if (!isMongodbContext(context)) {
            throw new Error("No mongodb context");
        }

        const { config, mongo } = context;
        const servers = Object.keys(body.server_keys);

        if (servers.length === 0) {
            return { server_keys: [] };
        }

        const getPublicKeyFromServer = makeGetServerKeysFromServerProcedure(
            mongo.getValidServerKeysFromLocal,
            async (serverName: string) => getServerKeysFromRemote(serverName, config),
            mongo.storeServerKeys,
        );

        const response = (
            await Promise.all(
                servers
                    .map(async (serverName) => {
                        const serverKeys = await getPublicKeyFromServer(serverName, '');
                        if (serverKeys) {
                            return parseNotaryResult(serverKeys, config);
                        }
                    })))
            .filter(isTruthy);
            

        return {
            server_keys: filterServerResponse(response, body.server_keys),
        }
    },
        {
            body: t.Object({
                server_keys: t.Record(
                    t.String(),
                    t.Record(
                        t.String(),
                        t.Object(
                            {
                                minimum_valid_until_ts: t.Integer({
                                    format: "int64",
                                    description:
                                        "A millisecond POSIX timestamp in milliseconds indicating when the returned certificates will need to be valid until to be useful to the requesting server.",
                                    examples: [1532645052628],
                                }),
                            },
                        )
                    ),
                ),
            },
                {
                    examples: [
                        {
                            "server_keys": {
                                "hs1": {
                                    "ed25519:0": {
                                        "minimum_valid_until_ts": 1234567890
                                    }
                                }
                            }
                        }
                    ],
                },),
            response: NotaryServerKeysDTO,
            detail: {
                description:
                    "Query for keys from multiple servers in a batch format. The receiving (notary) server must sign the keys returned by the queried servers.",
                operationId: "getServerKeysThroughNotaryServerBatchRequest",
            },
        }
    );
