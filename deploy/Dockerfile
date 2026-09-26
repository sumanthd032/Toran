# The deployed hall: one Toran Core serving the built Twin, its API, the
# curation queues and the simulated visitors, on one port. D-163.
#
# Built from a checkout that has already run `npm run build:data` and
# `npm run build:hall`, because the archive and the export are made from
# sources that are not in the repository. From the repository root:
#
#   docker build -f deploy/Dockerfile -t toran-hall .
#   docker run -p 8787:8787 --env-file deploy/toran.env -v toran-data:/srv/toran/data toran-hall
#
# The official Node image carries full ICU, which the Twin's dates need (D-148).
FROM node:22-bookworm-slim

WORKDIR /srv/toran

# The user first, so the files it must write are copied as its own. A chown
# afterwards would copy all of data/ into a second layer and double the image.
RUN useradd --system --home /srv/toran toran

COPY package.json ./
COPY packages/contracts packages/contracts
COPY packages/narrate/package.json packages/narrate/package.json
COPY packages/narrate/src packages/narrate/src
COPY apps/core apps/core
COPY apps/web/src/fleet/devices.ts apps/web/src/fleet/devices.ts
COPY tools tools
COPY pipeline pipeline
COPY apps/web/public/kiosk apps/web/public/kiosk
COPY --chown=toran:toran apps/web/public/archive apps/web/public/archive
COPY apps/web/out apps/web/out
COPY --chown=toran:toran data data
COPY deploy/entrypoint.sh deploy/entrypoint.sh

# The workspace links npm would make, without installing anything: Core's
# only dependencies are these two packages from this repository (D-131).
RUN mkdir -p node_modules/@toran \
  && ln -s ../../packages/contracts node_modules/@toran/contracts \
  && ln -s ../../packages/narrate node_modules/@toran/narrate

USER toran

ENV TORAN_CORE_HOST=0.0.0.0 \
    TORAN_CORE_PORT=8787 \
    TORAN_CORE_DB=/srv/toran/data/core.sqlite \
    TORAN_WEB_ROOT=apps/web/out \
    TORAN_SIMULATE_HALL=1

# What a curator decides lives here, and outlives the container.
VOLUME ["/srv/toran/data"]
EXPOSE 8787
ENTRYPOINT ["/srv/toran/deploy/entrypoint.sh"]
