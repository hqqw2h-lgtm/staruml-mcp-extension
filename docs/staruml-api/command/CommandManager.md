# CommandManager

Source: https://files.staruml.io/api-docs/2.0.0/api/modules/command/CommandManager.html

Manages global application commands (menu items, key bindings).

## Events

- `commandRegistered` — new command registered
- `beforeExecuteCommand` — before dispatch

## Module functions (per docs)

### `execute(id, ...args): $.Promise`

Look up + run a global command. Extra args forwarded to command function.

### `get(id): Command`

Retrieve Command by id.

### `getAll(): string[]`

All registered command IDs.

### `register(name, id, commandFn): Command`

Register global command.

- `name` — UI display text
- `id` — e.g. `'open.file'` or `'author.ext.cmd'`
- `commandFn` — handler. If async, return `$.Promise`.

### `registerInternal(id, commandFn): Command`

Internal-only command (no UI).

## Command class methods

- `execute(...)` — `$.Promise`
- `getID()`, `getName()`
- `getChecked()`, `setChecked(boolean)` — emits `checkedStateChange`
- `getEnabled()`, `setEnabled(boolean)` — emits `enabledStateChange`
- `getVisible()`, `setVisible(boolean)` — emits `visibleStateChange`
- `setName(name)` — emits `nameChange`

## ⚠️ Runtime difference

**The `app.commands` global doesn't match the documented module exactly.** Runtime introspection shows `app.commands` is a CommandManager INSTANCE with:

- Properties: `commandNames`, `commands` (as map)
- Proto methods: `execute(id, ...args)`, `register(id, name, fn)` (note: id first, not name)

`getAll()` and `get(id)` per the docs **do not exist** on the instance. Our extension's `collectCommandIds()` handles this by using `commandNames` / `Object.keys(commands)`.

## Notes for MCP extension

- `execute(id, ...args)` works — verified 138 commands executable via `/execute_command`.
- Consider renaming runtime-only discovery helpers (e.g. `discoverCommandIds()`) to reflect that we're using the non-documented runtime shape, not the docs.
