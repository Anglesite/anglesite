# Anglesite MCP Sidecar

The Anglesite MCP Sidecar powers source-aware editing for the native
[Anglesite app](https://github.com/Anglesite/Anglesite-app). It is a Node.js
MCP server, bundled into the app's container image; it is not a standalone
site generator or agent runtime.

The server exposes tools for annotations, source edits and undo, structured
component editing, and site content creation. It operates on a site's source
repository supplied through `ANGLESITE_PROJECT_ROOT`.

## Run locally

```sh
npm ci
ANGLESITE_PROJECT_ROOT=/path/to/site node server/index.mjs
```

By default, the server uses stdio. Set `ANGLESITE_MCP_TRANSPORT=http` to run a
Streamable HTTP server instead. `ANGLESITE_MCP_HOST` and
`ANGLESITE_MCP_PORT` configure its bind address and port.

## Development

Node.js 22 or later is required.

```sh
npm test
```

Changes to the MCP tool schema require a paired change in
[`Anglesite/Anglesite-app`](https://github.com/Anglesite/Anglesite-app).

## License

[ISC](LICENSE)
