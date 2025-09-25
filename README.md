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
bun run bundle:sdk
```

### Run at Rocket.Chat side

```shell
yarn link ../homeserver/federation-bundle
```
