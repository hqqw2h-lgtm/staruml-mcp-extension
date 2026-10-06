# Repository

Source: https://files.staruml.io/api-docs/2.0.0/api/modules/core/Repository.html

Accessed via `app.repository`. Maintains a set of elements + applies operations (undo/redo) + provides query.

## Events dispatched

- `created: (elems)`
- `updated: (elems)`
- `deleted: (elems)`
- `reordered: (elem)`
- `relocated: (elem, field, oldParent, newParent)`
- `beforeExecuteOperation / operationExecuted / beforeUndo / beforeRedo`

## Query functions

### `get(id): Element`

Return element by ID.

### `find(predicate): Element | undefined`

First element satisfying predicate.

### `findAll(predicate): Element[]`

All matching elements.

### `getInstancesOf(typeName): Element[]`

Instances of a type. `typeName` can be string or string[].

### `select(selector): Element[]`

Query DSL. Selector syntax:

- Children: `Package1::`
- Type: `@UMLClass`, `Package1::@UMLClass`
- Field: `Class1.attributes`, `Package1.ownedElements`
- Value: `Class1.operations[isAbstract=false]`
- Name: `Class1::Attribute1`

**Heavy operation — use sparingly.**

### `lookupAndFind(namespace, name, typeFilter): Element`

Like JS-style scope lookup + find by name/type.

### `getViewsOf(model): View[]`

All views associated with a model. **Critical for deletion: collect these before calling `Engine.deleteElements`.**

### `getEdgeViewsOf(view): EdgeView[]`

Edges connected to a given node view.

### `getRefsTo(elem, iterator?): Element[]`

All elements referencing `elem`. Also critical for deletion (must also delete references).

### `getRelationshipsOf(model, iterator?): Relationship[]`

Relationship instances connected to a given model.

### `isElement(value): boolean`

Whether value is a repository element.

### `isModified(): boolean`

Whether project has unsaved changes.

## Mutation (dangerous — bypass undo)

### `bypassFieldAssign(elem, field, val)`

Assign directly without undo entry.

### `bypassInsert(parent, field, elem)`

Insert directly without undo entry.

### `clear()`

Clear all maps and stacks.

### `doOperation(operation)`

Execute an `Operation` object. If `bypass=true`, skip undo stack.

### `undo()` / `redo()`

Stack-based undo/redo.

## Notes for MCP extension

- For safe `deleteElement`: collect `getViewsOf(elem)` + `getRefsTo(elem)` + `getEdgeViewsOf(view)` recursively. Pass models AND views to `Engine.deleteElements(models, views)` in split arrays.
- `getInstancesOf(typeName)` is more efficient than `findAll(e => e.constructor.name === typeName)` — currently our `findElements` handler uses `getInstancesOf` when type given ✓.
