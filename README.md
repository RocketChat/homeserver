# Rocket.Chat Homeserver

A Matrix Federation homeserver implementation for server-to-server communication.

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0) - see the [LICENSE](LICENSE) file for details.

### Network Interaction & Source Availability

As required by AGPL-3.0 Section 13, if you run a modified version of this software on a network server, you must provide users interacting with it remotely an opportunity to receive the Corresponding Source of your modified version.

For information on how to comply with this requirement:
- The source code is available at: https://github.com/RocketChat/homeserver
- When deploying modifications, ensure users can access your modified source code
- Consider implementing a "Source" link in your server's API responses or documentation


## Installation

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
