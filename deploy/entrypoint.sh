#!/bin/sh
# Starts the deployed hall. The archive's derived files are rebuilt from the
# curation logs first, so a container recreated from the image serves every
# decision the logs hold, and not only those baked in when it was built.
# Each build takes under half a second. D-163.
set -eu
cd /srv/toran
node tools/build-archive.mjs >/dev/null
node tools/build-graph.mjs >/dev/null
node tools/build-scans.mjs >/dev/null
exec node --no-warnings=ExperimentalWarning apps/core/src/main.ts
