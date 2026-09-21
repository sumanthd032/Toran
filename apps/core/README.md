# Toran Core

The institutional server. It holds the fleet's configuration, the anonymous card
sessions, and the API keys that cannot ship inside a static export.

Every route Core serves is one a kiosk can do without. Search, reading, the
provenance graph, the manuscripts and the cached translations run against files
on the device and never reach this server. That is what makes the offline claim
checkable rather than aspirational: if Core is unplugged, the top six rows of
the degradation matrix do not move.

## Running it

```sh
npm run core
```

That is the whole of it. There is no build step, no migration command and no
container. Node reads the TypeScript directly and the schema is applied on boot.

| Variable | Default | What it does |
| --- | --- | --- |
| `TORAN_CORE_PORT` | `8787` | Port to listen on |
| `TORAN_CORE_HOST` | `127.0.0.1` | Set to `0.0.0.0` to serve a hall LAN |
| `TORAN_CORE_DB` | `data/core.sqlite` | The store |
| `TORAN_CORE_ORIGINS` | `*` | Comma-separated CORS allow list |

`TORAN_CORE_ORIGINS` defaults to any origin because a hall LAN has no other
origin on it. A deployment reachable from outside the hall must set it.

## Routes

All under `/v1`.

| Method | Path | Who calls it |
| --- | --- | --- |
| `GET` | `/status` | Anyone, to find out what this deployment serves |
| `GET` | `/fleet` | The Twin, for the hall's live state |
| `GET` | `/fleet/:deviceId` | A kiosk, for its own config |
| `PUT` | `/fleet/:deviceId` | The Curator Console and the Twin |
| `POST` | `/fleet/:deviceId/beat` | Every kiosk, every 30 seconds |
| `GET` | `/session/:token` | A kiosk, when a Sutra card is tapped |
| `PUT` | `/session/:token` | A kiosk, when a visitor changes or keeps something |
| `DELETE` | `/session/:token` | The entrance, when a card goes back in the bowl |

A version bump means a new prefix, not an edit to these.

## What the store cannot hold

The session tables have no column for a device, a query, a reading time or an
order of visits, and `tools/verify-core.mjs` checks the schema for one rather
than taking this paragraph's word for it. A card token is bound to a piece of
plastic, not to a person. A returned card is deleted. Everything else expires
twelve hours after it was issued, and a Core restarted the next morning sweeps
what is left.

## Deployments

The same command runs all three shapes in `ARCHITECTURE.md` section 7: a
workstation inside DAIC, a laptop at a demo, a Raspberry Pi beside the kiosks.
What changes is the database file and the port. The kiosks do not know which
they are talking to.

## Dependencies

None. Core uses `node:http` and `node:sqlite`, both of which ship with the
runtime the rest of the repository already requires. `node:sqlite` is marked
experimental in Node 22, which is why `npm run core` starts with
`--no-warnings=ExperimentalWarning`; the API it uses is `DatabaseSync`,
`prepare`, `run`, `get` and `all`, and nothing beyond that.
