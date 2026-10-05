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

| Key                                | Default | Meaning                                                                      |
| ---------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `mcp-ext.server.enabled`           | `true`  | Start the HTTP server when StarUML starts                                    |
| `mcp-ext.server.port`              | `58322` | Loopback port; `0` lets the OS pick a free one                               |
| `mcp-ext.server.logLevel`          | `info`  | Developer console output: `error`, `info`, or `debug` (one line per request) |
| `mcp-ext.token`                    | empty   | When set, every request needs `Authorization: Bearer <token>`                |
| `mcp-ext.security.allowedOrigins`  | empty   | Browser origins let through, comma-separated                                 |
| `mcp-ext.limits.maxBodyKiB`        | `4096`  | Largest request body                                                         |
| `mcp-ext.limits.maxBatchOps`       | `500`   | Most ops in one `/batch`                                                     |
| `mcp-ext.limits.timeoutSeconds`    | `60`    | Answer `504` to a request still waiting after this long                      |
| `mcp-ext.limits.commandsPerMinute` | `60`    | `/execute_command` calls per minute, all clients together                    |

Enabled and port take effect after a restart, the others on the next request. **Tools → MCP Extension → Server Info...** shows the bound address, whether a token is required, the allowed origins and the endpoint list; **Generate Access Token...** stores a random token and shows it once.

### Access rules

The server listens on 127.0.0.1 only, but any local process, and any web page through the browser, can reach a loopback port. Every request is checked in this order:

1. An `Origin` header (sent by browsers, not by scripts or the MCP server) not in `allowedOrigins`: `403 FORBIDDEN_ORIGIN`.
2. With `mcp-ext.token` set, a missing or different `Authorization: Bearer` token: `401 UNAUTHORIZED`, also for `GET /`.
3. A `POST` without `Content-Type: application/json` (parameters such as `charset` are fine): `415 UNSUPPORTED_MEDIA_TYPE`. Browsers cannot send that type cross-origin without a preflight, which is refused.
4. A body over `maxBodyKiB`: `413 PAYLOAD_TOO_LARGE`.
5. `/execute_command` over `commandsPerMinute`: `429 RATE_LIMITED` with `Retry-After`.
6. No answer within `timeoutSeconds`: `504 TIMEOUT`. Handlers run on StarUML's UI thread and cannot be cancelled, so the call may still complete; only waits (exports, commands) can time out.

Clients pass the token as a header, e.g. `curl -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{}' localhost:58322/get_project_info`. The live tests, load test and `snapshot:introspect` read it from `STARUML_EXT_TOKEN`.

## Endpoints

All `POST` with `Content-Type: application/json` and a JSON object body. Base URL: `http://localhost:58322`; `GET /` lists the endpoints.

| Group         | Endpoints                                                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalogue     | `/introspect`, `/debug`                                                                                                                                                       |
| Commands      | `/get_all_commands`, `/execute_command`                                                                                                                                       |
| Project       | `/get_project_info`, `/save_project`, `/save_project_as`, `/new_project`, `/open_project`                                                                                     |
| Elements      | `/get_element_by_id`, `/find_elements`, `/create_element`, `/update_element`, `/delete_element`, `/create_element_with_view`                                                  |
| Relationships | `/create_relationship`, `/create_edge_with_view`                                                                                                                              |
| Element parts | `/add_attribute`, `/add_operation`, `/add_parameter`, `/add_enumeration_literal`, `/add_template_parameter`, `/add_slot`, `/add_tag`, `/set_stereotype`, `/set_documentation` |
| Diagrams      | `/create_diagram`, `/switch_diagram`, `/close_diagram`                                                                                                                        |
| Views         | `/layout_diagram`, `/move_views`, `/resize_node`, `/set_view_style`, `/set_z_order`                                                                                           |
| Lookups       | `/get_views_of`, `/get_edge_views_of`, `/get_relationships_of`, `/get_refs_to`, `/get_connected_node_views`                                                                   |
| Editor        | `/get_selection`, `/set_selection`, `/get_editor_state`, `/set_editor_state`                                                                                                  |
| Export        | `/export_diagram`, `/export_pdf`, `/export_html`                                                                                                                              |
| History       | `/undo`, `/redo`, `/is_modified`                                                                                                                                              |

### `/introspect`

Returns the StarUML and extension versions and, unless `include` narrows it, four sections:

- `factory`: the ids `create_element`, `create_element_with_view` and `create_diagram` accept, and what each model-and-view id creates.
- `metamodel`: every type of the loaded metamodel with its kind, super types, attributes (kind and type), view type, relationship kind and which factory creates it. `types` restricts it, `inherited: true` lists inherited attributes too.
- `toolbox`: the diagram editor's palette. An item id can be passed as `type` wherever a model-and-view id is accepted and applies the item's presets (`UMLComposition`, `UMLAsyncMessage`, `UMLInitialState`, ...).
- `endpoints`: the manifest: path, description, `readOnly` and `destructive` flags, and JSON Schemas (2020-12) of the request and of `data` in the response; `errors` gives the status per code and the error body schema. Every request is validated against its schema.

`tests/fixtures/introspect.7.1.1.json` records the answer of 7.1.1; `npm run snapshot:introspect` refreshes it.

### Creating and changing elements

- `create_element` files the element in the owner list typed for it (`attributes` for a UMLAttribute in a class, `columns` for an ERDColumn) unless `field` says otherwise; `properties` sets attributes on creation.
- `create_element_with_view` takes `containerViewId` for views placed on or inside another view (ports, parts, pins, BPMN boundary events, timing diagram parts).
- `create_relationship` sets the ends: source/target, or end1/end2 with `tailEnd`/`headEnd` attributes. With `diagramId` it draws the edge through StarUML's factory and its connection rules; without, it creates the model only.
- `update_element` with `op`: `set` (references as id or `{$ref}`), `add`/`remove` on reference lists, `reorder` within a list, `relocate` to another owner. Each call is one undo step.

### Views and export

- View edits go through StarUML's engine (`layoutDiagram`, `moveViews`, `resizeNode`, `setFillColor`, ...), which needs the editor to show the views' diagram, so they make that diagram current. Each is one undo step; `/set_view_style` is one step per property given.
- `/export_diagram` renders PNG and JPEG by calling StarUML's own exporter (`engine/diagram-export.js` `getImageData`, what **File → Export Diagram As** uses) and SVG through its SVG export. `scale` (pixels per diagram unit, default 1; the menu uses the display's pixel ratio) is passed as the pixel ratio that exporter reads; `background` (default transparent, white for JPEG) is painted under a transparent rendering. It answers base64 or writes `path`. Whatever the exporter draws for the running licence appears as it does in the menu.
- `/export_pdf` and `/export_html` write what the CLI's `pdf` and `html` commands write, to an absolute path.

### `/batch`

`{ops: [{path, body, as?}], atomic?}` runs endpoint calls in order. A string `"$name"` anywhere in a later `body` becomes the id of the result saved `as: "name"`; `"$name.view"` and `"$name.model"` pick the parts of a `create_*_with_view` result, and any path into the result works (`.id` means `_id`). `"$$"` escapes a literal `$`.

- `atomic: true` (default): the batch is one undo step. If an op fails, everything it ran is undone, nothing is left to redo, and the answer is that op's error code with `details: {index, results}`. Atomic batches refuse `/undo`, `/redo`, `/new_project`, `/open_project`, `/save_project*`, `/execute_command`, `/export_pdf`, `/export_html`.
- `atomic: false`: every op runs; `results` has each op's `data` or `code`/`error`, and `succeeded`/`failed` count them.
- At most `mcp-ext.limits.maxBatchOps` ops (default 500) and `mcp-ext.limits.maxBodyKiB` of body (default 4096, for every endpoint); over either is `413 PAYLOAD_TOO_LARGE`.

### Responses

Success is `{success: true, data}`. Failure is `{success: false, code, error, details?}`; branch on `code`, `error` is prose. Stack traces are only logged to StarUML's developer console.

| `code`                             | Status | Meaning                                                                             |
| ---------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| `INVALID_ARGUMENT`                 | 400    | Body does not match the endpoint's schema; `details` lists `{path, message}`        |
| `INVALID_JSON`, `BODY_READ_FAILED` | 400    | Body is not a JSON object                                                           |
| `UNKNOWN_TYPE`                     | 400    | Type name not in the metamodel, or no factory function for it                       |
| `NOT_FOUND`, `UNKNOWN_ENDPOINT`    | 404    | No element (of the expected kind) with that id; no such path                        |
| `METHOD_NOT_ALLOWED`               | 405    | Not `POST`                                                                          |
| `PAYLOAD_TOO_LARGE`                | 413    | Body over `mcp-ext.limits.maxBodyKiB`, or a batch over `mcp-ext.limits.maxBatchOps` |
| `NO_PROJECT`                       | 409    | No project open, or it has no file yet                                              |
| `STARUML_ERROR`                    | 422    | StarUML refused, e.g. a factory precondition                                        |
| `INTERNAL`                         | 500    | Defect in the extension                                                             |

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

| Command                 | What it checks                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`     | `tsc --noEmit` over `src/` and `tests/`                                                                                                                                                                                                                                                                                                                              |
| `npm run lint`          | ESLint flat config                                                                                                                                                                                                                                                                                                                                                   |
| `npm run format:check`  | Prettier defaults                                                                                                                                                                                                                                                                                                                                                    |
| `npm run test:coverage` | Unit tests against an in-memory `app` (`tests/mock/staruml.ts`), 100% line/branch gate                                                                                                                                                                                                                                                                               |
| `npm run test:live`     | End-to-end against a running StarUML with this build installed; replaces the open project. `STARUML_LIVE_DIR` sets where `.mdj` files are written                                                                                                                                                                                                                    |
| `npm run test:load`     | 5000 read requests at concurrency 50; fails on any error, p99 over `P99_BUDGET_MS` (250) or a handler holding the renderer over `HANDLER_BUDGET_MS` (50), read from `Server-Timing`. Then `WRITE_BATCHES` (200) writing `/batch` requests, alternating atomic and not; fails when the atomic median exceeds `ATOMIC_OVERHEAD_BUDGET` (1.25) times the non-atomic one |

The mock mirrors the 7.1.1 prototypes recorded in `tests/fixtures/app-surface.7.1.1.json`; the live suite compares that fixture with `POST /debug` so the mock cannot drift from StarUML.

## License

MIT © Ezra Brilliant Konterliem
