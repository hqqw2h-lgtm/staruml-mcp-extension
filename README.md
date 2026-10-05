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

- Port `58322` free on localhost

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
npm run build
npm run install:local
```

## License

MIT © Ezra Brilliant Konterliem
