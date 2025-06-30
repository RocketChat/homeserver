# homeserver

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

Explanation how the repository is structured:

```
# General idea

The idea is to have a single repository that contains all the code for the homeserver to run as standalone or as a dependency for other projects.

The repository is structured in packages, each package contains its own responsibility, and each one should be helpful if you are developing your own matrix homeserver.


## `/packages/federation-sdk`

This package contains the core functionality of the homeserver.

All services/interfaces/logics that could be shared should be placed (or at least exported) here.


## `/packages/homeserver`

This package contains the a homeserver implementation. It shows how the code from `/packages/federation-sdk` can be used to create a homeserver.
```

This project was created using `bun init` in bun v1.0.30. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
