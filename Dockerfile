# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1 as base

# install dependencies into temp directory
# this will cache them and speed up future builds
FROM base AS install
RUN mkdir -p /temp/dev
COPY . /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# install with --production (exclude devDependencies)
RUN bun build /temp/dev/index.ts --compile --outfile /temp/dev/bin/app

# copy production dependencies and source code into final image
FROM base AS release

EXPOSE 3000/tcp

# run the app
USER bun

WORKDIR /usr/src/app

COPY --from=install /temp/dev/bin/app .
COPY --from=install /temp/dev/config.json .

CMD [ "./app" ]
