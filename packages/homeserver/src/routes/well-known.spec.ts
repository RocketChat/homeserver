import { describe, expect, it } from "bun:test";
import type { Config } from "../plugins/config";
import { EncryptionValidAlgorithm } from "../signJson";
import Elysia from "elysia";
import { generateKeyPairsFromString } from "../keys";
import { app } from "..";

describe('well-known endpoint', () => {

    it("should return the m.server property", async () => {
        const config: Config = {
            path: "./config.json",
            signingKeyPath: "./keys/ed25519.signing.key",
            port: 8080,
            signingKey: [
                await generateKeyPairsFromString(
                    "ed25519 a_XRhW YjbSyfqQeGto+OFswt+XwtJUUooHXH5w+czSgawN63U",
                ),
            ],
            name: "rc1",
            version: "org.matrix.msc3757.10",
        };
        const resp = await new Elysia({
            name: "rc1",
        })
            .decorate("config", config)
            .use(app)
            .handle(new Request("http://localhost/.well-known/matrix/server"));

        expect(resp.status).toBe(200);
        expect(resp.headers.get("Content-Type")).toBe("application/octet-stream");
        expect(resp.headers.get("ETag")).toBeDefined();
        expect(await resp.json()).toEqual({
            "m.server": "rc1:443",
        });
    });
});