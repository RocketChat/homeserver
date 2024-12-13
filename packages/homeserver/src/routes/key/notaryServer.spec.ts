import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { generateKeyPairsFromString } from "../../keys";
import Elysia from "elysia";
import { mock, clearMocks } from "bun-bagel";
import { signJson } from "../../signJson";
import { filterServerResponse } from "./notaryServer";
import { keyV2Endpoints } from ".";

describe('Notary Server Requests', async () => {
    let app: Elysia<any, any, any, any, any, any>;
    const remoteServerName = "hs1";
    const remoteSignature = await generateKeyPairsFromString(
        "ed25519 a_HDhg WntaJ4JP5WbZZjDShjeuwqCybQ5huaZAiowji7tnIEw",
    );
    const localServerName = "rc1";
    const localSignature = await generateKeyPairsFromString(
        "ed25519 0 44Ve8dmV9y53MteX2bHSfJYXDJP/v3Pdjz/chZkOLyE",
    );
    const responseWithoutSignature = {
        "old_verify_keys": {},
        "server_name": "hs1",
        "valid_until_ts": 1734184604097,
        "verify_keys": {
            "ed25519:a_HDhg": {
                "key": "7dhilbxkbkcIAYMVc2yqRQ8mqfeVhuY9dU0hLvYpQFM"
            }
        }
    }

    afterEach(() => {
        clearMocks();
    });

    beforeAll(async () => {
        app = new Elysia()
            .decorate("config", {
                path: "./config.json",
                signingKeyPath: "./keys/ed25519.signing.key",
                port: 8080,
                signingKey: [
                    localSignature
                ],
                name: localServerName,
                version: "org.matrix.msc3757.10",
            })
            .decorate("mongo", {
                getValidServerKeysFromLocal: async () => {
                    return;
                },
                storeServerKeys: async () => {
                    return;
                },
                serversCollection: {
                    findOne: async () => {
                        return;
                    },
                } as any,
            })
            .use(keyV2Endpoints)
    });

    describe('GET /_matrix/key/v2/query/:serverName', () => {

        it("should return the correct response with the correct signatures from both local and remote servers", async () => {
            const remoteSigned = await signJson(responseWithoutSignature, remoteSignature, remoteServerName);
            const localSigned = await signJson(responseWithoutSignature, localSignature, localServerName);

            mock("https://hs1:8448/_matrix/key/v2/server", { data: remoteSigned });

            const resp = await app.handle(
                new Request(
                    'http://localhost/_matrix/key/v2/query/hs1',
                ),
            );

            expect(resp.status).toBe(200);
            const content = await resp.json();

            expect(content).toEqual({
                server_keys: [
                    {
                        ...localSigned,
                        signatures: {
                            ...localSigned.signatures,
                            ...remoteSigned.signatures,
                        }
                    }
                ]
            })
        });

        it("should return an empty response when keys were not being retrieved succesfully from remote", async () => {
            mock("https://hs1:8448/_matrix/key/v2/server", { throw: new Error("Error") });
            const resp = await app.handle(
                new Request(
                    'http://localhost/_matrix/key/v2/query/hs1',
                ),
            );

            expect(resp.status).toBe(200);
            const content = await resp.json();

            expect(content).toEqual({
                server_keys: []
            })
        });
    });

    describe('POST /_matrix/key/v2/query', async () => {
        it("should return the correct response with the correct signatures from both local and remote servers", async () => {
            const remoteSigned = await signJson(responseWithoutSignature, remoteSignature, remoteServerName);
            const localSigned = await signJson(responseWithoutSignature, localSignature, localServerName);

            mock("https://hs1:8448/_matrix/key/v2/server", { data: remoteSigned });

            const resp = await app.handle(
                new Request('http://localhost/_matrix/key/v2/query', {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({
                        server_keys: {
                            'hs1': {
                                'ed25519:a_HDhg': {
                                    minimum_valid_until_ts: 1734184604097 - 1000,
                                }
                            }
                        }
                    }),
                }
                ),
            );

            expect(resp.status).toBe(200);
            const content = await resp.json();

            expect(content).toEqual({
                server_keys: [
                    {
                        ...localSigned,
                        signatures: {
                            ...localSigned.signatures,
                            ...remoteSigned.signatures,
                        }
                    }
                ]
            })
        });

        it("should return an empty response when there is no filter", async () => {
            const resp = await app.handle(
                new Request('http://localhost/_matrix/key/v2/query', {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({
                        server_keys: {
                        }
                    }),
                }
                ),
            );

            expect(resp.status).toBe(200);
            const content = await resp.json();

            expect(content).toEqual({
                server_keys: []
            })
        });

        it("should return an empty response when it was not possible to retrieve the keys from remote server", async () => {
            mock("https://hs1:8448/_matrix/key/v2/server", { throw: new Error("Error") });

            const resp = await app.handle(
                new Request('http://localhost/_matrix/key/v2/query', {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({
                        server_keys: {
                        }
                    }),
                }
                ),
            );

            expect(resp.status).toBe(200);
            const content = await resp.json();

            expect(content).toEqual({
                server_keys: []
            })
        });

    });

    describe('#filterServerResponse()', () => {
        it('should return all the server keys when there is a filter for a specific key and its a valid ts', () => {
            const serverKeys = [
                {
                    "server_name": "example.org",
                    "verify_keys": {
                        "ed25519:abc123": {
                            "key": "VGhpcyBzaG91bGQgYmUgYSByZWFsIGVkMjU1MTkgcGF5bG9hZA"
                        }
                    },
                    "old_verify_keys": {
                        "ed25519:0ldk3y": {
                            "expired_ts": 1532645052628,
                            "key": "VGhpcyBzaG91bGQgYmUgeW91ciBvbGQga2V5J3MgZWQyNTUxOSBwYXlsb2FkLg"
                        }
                    },
                    "signatures": {
                        "example.org": {
                            "ed25519:abc123": "VGhpcyBzaG91bGQgYWN0dWFsbHkgYmUgYSBzaWduYXR1cmU"
                        }
                    },
                    "valid_until_ts": 1652262000000
                }
            ];

            const filter = {
                "example.org": {
                    "ed25519:abc123": {
                        minimum_valid_until_ts: 1652262000000 - 1000,
                    },
                },
            };

            const result = filterServerResponse(serverKeys, filter);

            expect(result).toEqual(serverKeys);
        });

        it('should return an empty array if the provided filter key does not exists in the response', () => {
            const serverKeys = [
                {
                    "server_name": "example.org",
                    "verify_keys": {
                        "ed25519:abc123": {
                            "key": "VGhpcyBzaG91bGQgYmUgYSByZWFsIGVkMjU1MTkgcGF5bG9hZA"
                        }
                    },
                    "old_verify_keys": {
                        "ed25519:0ldk3y": {
                            "expired_ts": 1532645052628,
                            "key": "VGhpcyBzaG91bGQgYmUgeW91ciBvbGQga2V5J3MgZWQyNTUxOSBwYXlsb2FkLg"
                        }
                    },
                    "signatures": {
                        "example.org": {
                            "ed25519:abc123": "VGhpcyBzaG91bGQgYWN0dWFsbHkgYmUgYSBzaWduYXR1cmU"
                        }
                    },
                    "valid_until_ts": 1652262000000
                }
            ];

            const filter = {
                "example.org": {
                    "ed25519:0": {
                        minimum_valid_until_ts: 1652262000000 - 1000,
                    },
                },
            };

            const result = filterServerResponse(serverKeys, filter);

            expect(result).toEqual([]);
        });

        it('should return all the server keys when there is no filter applied for a server', () => {
            const serverKeys = [
                {
                    "server_name": "example.org",
                    "verify_keys": {
                        "ed25519:abc123": {
                            "key": "VGhpcyBzaG91bGQgYmUgYSByZWFsIGVkMjU1MTkgcGF5bG9hZA"
                        }
                    },
                    "old_verify_keys": {
                        "ed25519:0ldk3y": {
                            "expired_ts": 1532645052628,
                            "key": "VGhpcyBzaG91bGQgYmUgeW91ciBvbGQga2V5J3MgZWQyNTUxOSBwYXlsb2FkLg"
                        }
                    },
                    "signatures": {
                        "example.org": {
                            "ed25519:abc123": "VGhpcyBzaG91bGQgYWN0dWFsbHkgYmUgYSBzaWduYXR1cmU"
                        }
                    },
                    "valid_until_ts": 1652262000000
                }
            ];

            const filter = {
                "example.org": {
                },
            };

            const result = filterServerResponse(serverKeys, filter);

            expect(result).toEqual(serverKeys);
        });

        it('should return the first server keys only when the filter wipe out the other element (by having ts invalid)', () => {
            const serverKeys = [
                {
                    "server_name": "example.org",
                    "verify_keys": {
                        "ed25519:abc123": {
                            "key": "VGhpcyBzaG91bGQgYmUgYSByZWFsIGVkMjU1MTkgcGF5bG9hZA"
                        }
                    },
                    "old_verify_keys": {
                        "ed25519:0ldk3y": {
                            "expired_ts": 1532645052628,
                            "key": "VGhpcyBzaG91bGQgYmUgeW91ciBvbGQga2V5J3MgZWQyNTUxOSBwYXlsb2FkLg"
                        }
                    },
                    "signatures": {
                        "example.org": {
                            "ed25519:abc123": "VGhpcyBzaG91bGQgYWN0dWFsbHkgYmUgYSBzaWduYXR1cmU"
                        }
                    },
                    "valid_until_ts": 1652262000000
                },
                {
                    "server_name": "example2.org",
                    "verify_keys": {
                        "ed25519:auto": {
                            "key": "VGhpcyBzaG91bGQgYmUgYSByZWFsIGVkMjU1MTkgcGF5bG9Lia"
                        }
                    },
                    "old_verify_keys": {
                        "ed25519:0ldk3y": {
                            "expired_ts": 1532645052628,
                            "key": "VGhpcyBzaG91bGQgYmUgeW91ciBvbGQga2V5J3MgZWQyNTUxOSBwYXlsb2FkLg"
                        }
                    },
                    "signatures": {
                        "example2.org": {
                            "ed25519:auto": "VGhpcyBzaG91bGQgYWN0dWFsbHkgYmUgYSBzaWduYXR1354"
                        }
                    },
                    "valid_until_ts": 1652262000001
                }
            ] as any;

            const filter = {
                "example.org": {
                    "ed25519:abc123": {
                        minimum_valid_until_ts: 1652262000000 - 1000,
                    },
                },
                "example2.org": {
                    "ed25519:auto": {
                        minimum_valid_until_ts: 1652262000001 + 1000,
                    },
                },
            };

            const result = filterServerResponse(serverKeys, filter);

            expect(result).toEqual([serverKeys[0]]);
        });

        it('should return the all the server keys when the first item is valid and theres no filter for the second', () => {
            const serverKeys = [
                {
                    "server_name": "example.org",
                    "verify_keys": {
                        "ed25519:abc123": {
                            "key": "VGhpcyBzaG91bGQgYmUgYSByZWFsIGVkMjU1MTkgcGF5bG9hZA"
                        }
                    },
                    "old_verify_keys": {
                        "ed25519:0ldk3y": {
                            "expired_ts": 1532645052628,
                            "key": "VGhpcyBzaG91bGQgYmUgeW91ciBvbGQga2V5J3MgZWQyNTUxOSBwYXlsb2FkLg"
                        }
                    },
                    "signatures": {
                        "example.org": {
                            "ed25519:abc123": "VGhpcyBzaG91bGQgYWN0dWFsbHkgYmUgYSBzaWduYXR1cmU"
                        }
                    },
                    "valid_until_ts": 1652262000000
                },
                {
                    "server_name": "example2.org",
                    "verify_keys": {
                        "ed25519:auto": {
                            "key": "VGhpcyBzaG91bGQgYmUgYSByZWFsIGVkMjU1MTkgcGF5bG9Lia"
                        }
                    },
                    "old_verify_keys": {
                        "ed25519:0ldk3y": {
                            "expired_ts": 1532645052628,
                            "key": "VGhpcyBzaG91bGQgYmUgeW91ciBvbGQga2V5J3MgZWQyNTUxOSBwYXlsb2FkLg"
                        }
                    },
                    "signatures": {
                        "example2.org": {
                            "ed25519:auto": "VGhpcyBzaG91bGQgYWN0dWFsbHkgYmUgYSBzaWduYXR1354"
                        }
                    },
                    "valid_until_ts": 1652262000001
                }
            ] as any;

            const filter = {
                "example.org": {
                    "ed25519:abc123": {
                        minimum_valid_until_ts: 1652262000000 - 1000,
                    },
                },
                "example2.org": {
                },
            };

            const result = filterServerResponse(serverKeys, filter);

            expect(result).toEqual(serverKeys);
        });


        it('should return the all the server keys when the first item is valid and all (multiple) fitler for the second are valid', () => {
            const serverKeys = [
                {
                    "server_name": "example.org",
                    "verify_keys": {
                        "ed25519:abc123": {
                            "key": "VGhpcyBzaG91bGQgYmUgYSByZWFsIGVkMjU1MTkgcGF5bG9hZA"
                        }
                    },
                    "old_verify_keys": {
                        "ed25519:0ldk3y": {
                            "expired_ts": 1532645052628,
                            "key": "VGhpcyBzaG91bGQgYmUgeW91ciBvbGQga2V5J3MgZWQyNTUxOSBwYXlsb2FkLg"
                        }
                    },
                    "signatures": {
                        "example.org": {
                            "ed25519:abc123": "VGhpcyBzaG91bGQgYWN0dWFsbHkgYmUgYSBzaWduYXR1cmU"
                        }
                    },
                    "valid_until_ts": 1652262000000
                },
                {
                    "server_name": "example2.org",
                    "verify_keys": {
                        "ed25519:auto": {
                            "key": "VGhpcyBzaG91bGQgYmUgYSByZWFsIGVkMjU1MTkgcGF5bG9Lia"
                        },
                        "ed25519:auto2": {
                            "key": "VGhpcyBzaG91bGQgYmUgYSByZWFsIGVkMjU1MTkgcGF5bG9Lia"
                        }
                    },
                    "old_verify_keys": {
                        "ed25519:0ldk3y": {
                            "expired_ts": 1532645052628,
                            "key": "VGhpcyBzaG91bGQgYmUgeW91ciBvbGQga2V5J3MgZWQyNTUxOSBwYXlsb2FkLg"
                        }
                    },
                    "signatures": {
                        "example2.org": {
                            "ed25519:auto": "VGhpcyBzaG91bGQgYWN0dWFsbHkgYmUgYSBzaWduYXR1354"
                        }
                    },
                    "valid_until_ts": 1652262000001
                }
            ] as any;

            const filter = {
                "example.org": {
                    "ed25519:abc123": {
                        minimum_valid_until_ts: 1652262000000 - 1000,
                    },
                },
                "example2.org": {
                    "ed25519:auto": {
                        minimum_valid_until_ts: 1652262000001 - 6000,
                    },
                    "ed25519:auto2": {
                        minimum_valid_until_ts: 1652262000001 - 5000,
                    },
                },
            };

            const result = filterServerResponse(serverKeys, filter);

            expect(result).toEqual(serverKeys);
        });

    });
});