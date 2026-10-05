# SelectionManager

Source: https://files.staruml.io/api-docs/2.0.0/api/modules/engine/SelectionManager.html

Accessed via `app.selections`.

## Events

- `selectionChanged: (selectedModels, selectedViews)`

## Functions

### `select(models, views)`

Select model + view arrays simultaneously.

### `selectModel(model)`

Select a single model element (e.g. in tree navigator).

### `selectViews(views)`

Select view elements on the diagram canvas.

### `getSelected(): Model`

First selected model element.

### `getSelectedModels(): Model[]`

All selected models.

### `getSelectedViews(): View[]`

All selected views.

### `deselectAll()`

Clear selection.

## Notes for MCP extension

- Could add `select_element` tool wrapping `selectModel`/`selectViews`.
- Useful combo: `selectViews([view])` + `execute_command("edit:delete")` for GUI-style delete.
