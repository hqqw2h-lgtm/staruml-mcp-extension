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
- `/export_diagram` renders PNG or JPEG the way **File → Export Diagram As** does (`engine/diagram-export.js`), with `scale` (pixels per diagram unit, default 1; the menu uses the display's pixel ratio) and `background` (default transparent, white for JPEG), and SVG through StarUML's own SVG export. It answers base64 or writes `path`. StarUML's licence watermarks apply as in the menu.
- `/export_pdf` and `/export_html` write what the CLI's `pdf` and `html` commands write, to an absolute path.

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
