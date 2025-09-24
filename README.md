# homeserver

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.0.30. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.


## Run locally with Rocket.Chat

### Run at homeserver side
```shell
bun run build
cd packages/federation-sdk
mkdir -p ./link/ && touch ./link/yarn.lock && jq '.dependencies = {}' package.json > ./link/package.json
bun build ./src/index.ts --outfile ./link/dist/bundle.js --target node --format=cjs -e pino -e mongodb -e zod -e pino-pretty -e @rocket.chat/emitter -e reflect-metadata -e tsyringe -e tweetnacl
```

### Run at Rocket.Chat side
```shell
yarn link ../homeserver/packages/federation-sdk/link
cd ee/packages/federation-matrix
yarn link ../../../../homeserver/packages/federation-sdk/link
yarn
```