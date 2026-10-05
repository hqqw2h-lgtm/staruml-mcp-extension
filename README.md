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

All `POST` + JSON body. Response: `{success, data?, error?}`. Base URL: `http://localhost:58322`

| Group        | Endpoints                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Commands     | `/get_all_commands`, `/execute_command`                                                         |
| Project      | `/get_project_info`, `/save_project`, `/save_project_as`, `/new_project`, `/open_project`       |
| Element CRUD | `/get_element_by_id`, `/find_elements`, `/create_element`, `/update_element`, `/delete_element` |
| Diagrams     | `/create_diagram`, `/switch_diagram`, `/close_diagram`                                          |

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
