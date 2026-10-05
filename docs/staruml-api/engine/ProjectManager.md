# ProjectManager

Source: https://files.staruml.io/api-docs/2.0.0/api/modules/engine/ProjectManager.html

Accessed via `app.project`.

## Events

- `projectCreated: (project)`
- `projectSaved: (filename, project)`
- `projectLoaded: (filename, project)`
- `beforeProjectClose: (filename, project)`
- `projectClosed`
- `imported: (filename, element)`
- `exported: (filename, element)`

## Functions

### `getFilename(): string`

Current project filename.

### `getProject(): Core.Project`

Current project object.

### `newProject(): Core.Project`

Create a new empty project (discards unsaved changes).

### `closeProject()`

Close current project.

### `save(fullPath): $.Promise`

Save to file (promise-based).

### `load(fullPath): $.Promise`

Load from a .mdj file.

### `loadAsTemplate(fullPath): $.Promise`

Load as template (stays Untitled).

### `loadFromJson(data): Project`

Load from already-parsed JSON.

### `importFromFile(parent, fullPath): $.Promise`

Import model fragment from a file into `parent`.

### `importFromJson(parent, data): Element`

Import JSON fragment into `parent`.

### `exportToFile(elem, fullPath): $.Promise`

Export model fragment to a file.

## Notes for MCP extension

- Our current handlers match 1:1: `save_project` → `save`, `save_project_as` → `save(newFilename)` (overload), `new_project` → `newProject`, `open_project` → `load`.
- Save/load return jQuery Promises — await them (our handlers already do).
- `Project` returned from `getProject()` is the root element tree, descends through `ownedElements`.
