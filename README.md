# staruml-mcp-extension

StarUML extension that adds HTTP endpoints for element CRUD, project lifecycle, and command execution on `localhost:58322` — so any HTTP client (or MCP server) can drive StarUML programmatically.

**Companion to [`staruml-mcp`](https://github.com/ezrabrilliant/staruml-mcp)** (npm MCP server) — install both to let AI agents (Claude Code, Cursor, VS Code, Codex) use these endpoints as tools.

```
  AI Agent  ──MCP──►  staruml-mcp (npm)  ──HTTP──►  this extension  ──►  StarUML
```

If you only want to curl StarUML from your own scripts, install just this extension.

## Installation

1. Open StarUML
2. Go to **Tools → Extension Manager**
3. Click **Install From URL**
4. Paste: `https://github.com/ezrabrilliant/staruml-mcp-extension`

## Requirements

- StarUML v7+
- StarUML API Server enabled — edit `%APPDATA%\StarUML\settings.json` (Win) / `~/Library/Application Support/StarUML/settings.json` (macOS):

  ```json
  { "apiServer": true, "apiServerPort": 58321 }
  ```

- Port `58322` free on localhost (configurable, see below)

## Preferences

**File → Preferences → MCP Extension** (`preferences/preference.json`):

| Key                      | Default | Meaning                                        |
| ------------------------ | ------- | ---------------------------------------------- |
| `mcp-ext.server.enabled` | `true`  | Start the HTTP server when StarUML starts      |
| `mcp-ext.server.port`    | `58322` | Loopback port; `0` lets the OS pick a free one |

Both take effect after a restart. **Tools → MCP Extension → Server Info...** shows the bound address and the endpoint list.

## Endpoints

All `POST` + JSON body. Base URL: `http://localhost:58322`; `GET /` lists the endpoints.

| Group        | Endpoints                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Commands     | `/get_all_commands`, `/execute_command`                                                                                                                |
| Project      | `/get_project_info`, `/save_project`, `/save_project_as`, `/new_project`, `/open_project`                                                              |
| Element CRUD | `/get_element_by_id`, `/find_elements`, `/create_element`, `/update_element`, `/delete_element`, `/create_element_with_view`, `/create_edge_with_view` |
| Diagrams     | `/create_diagram`, `/switch_diagram`, `/close_diagram`                                                                                                 |

### Responses

Success is `{success: true, data}`. Failure is `{success: false, code, error, details?}`; branch on `code`, `error` is prose. Stack traces are only logged to StarUML's developer console.

| `code`                             | Status | Meaning                                                                      |
| ---------------------------------- | ------ | ---------------------------------------------------------------------------- |
| `INVALID_ARGUMENT`                 | 400    | Body does not match the endpoint's schema; `details` lists `{path, message}` |
| `INVALID_JSON`, `BODY_READ_FAILED` | 400    | Body is not a JSON object                                                    |
| `UNKNOWN_TYPE`                     | 400    | Type name not in the metamodel, or no factory function for it                |
| `NOT_FOUND`, `UNKNOWN_ENDPOINT`    | 404    | No element (of the expected kind) with that id; no such path                 |
| `METHOD_NOT_ALLOWED`               | 405    | Not `POST`                                                                   |
| `NO_PROJECT`                       | 409    | No project open, or it has no file yet                                       |
| `STARUML_ERROR`                    | 422    | StarUML refused, e.g. a factory precondition                                 |
| `INTERNAL`                         | 500    | Defect in the extension                                                      |

### Elements

Every endpoint that returns elements returns summaries by default: `{_id, _type, name, _parent}`, where `_type` is the metamodel class and `_parent` the owner id. The keys carry an underscore, as in `.mdj` files, because `id` and `type` are attribute names in the metamodel. These optional request fields change that:

| Field     | Effect                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| `summary` | `false` returns every saved attribute; references are `{$ref: id}`, never inlined                               |
| `fields`  | Return only `_id`, `_type` and these attributes (`_parent` accepted)                                            |
| `depth`   | Expand owned elements (`ownedElements`, `attributes`, `ownedViews`, ...) this many levels; default 0 = `{$ref}` |

`/find_elements` pages its matches in id order: `limit` (1–1000, default 100) and `cursor` (the previous page's `nextCursor`); `count` is the total.

## Building from source

```bash
npm install
npm run build          # bundles src/ into main.js, which is committed
npm run install:local  # copies main.js, menus/, preferences/ into StarUML's extensions folder
```

Restart StarUML (or **Debug → Reload**) to load the new build.

## Development

| Command                 | What it checks                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`     | `tsc --noEmit` over `src/` and `tests/`                                                                                                                                        |
| `npm run lint`          | ESLint flat config                                                                                                                                                             |
| `npm run format:check`  | Prettier defaults                                                                                                                                                              |
| `npm run test:coverage` | Unit tests against an in-memory `app` (`tests/mock/staruml.ts`), 100% line/branch gate                                                                                         |
| `npm run test:live`     | End-to-end against a running StarUML with this build installed; replaces the open project. `STARUML_LIVE_DIR` sets where `.mdj` files are written                              |
| `npm run test:load`     | 5000 requests at concurrency 50; fails on any error, p99 over `P99_BUDGET_MS` (250) or a handler holding the renderer over `HANDLER_BUDGET_MS` (50), read from `Server-Timing` |

The mock mirrors the 7.1.1 prototypes recorded in `tests/fixtures/app-surface.7.1.1.json`; the live suite compares that fixture with `POST /debug` so the mock cannot drift from StarUML.

## License

MIT © Ezra Brilliant Konterliem
