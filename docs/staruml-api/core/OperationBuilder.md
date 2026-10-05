# OperationBuilder

Source: https://files.staruml.io/api-docs/2.0.0/api/modules/core/OperationBuilder.html

Accessed via `app.repository.operationBuilder`. Builds transactional Operation objects that can be passed to `Repository.doOperation(op)` — gives one atomic undo step for multi-element changes.

## Events

- `insert / remove: (elem)`
- `fieldAssign: (elem, field, val)`
- `fieldInsert / fieldInsertAt / fieldRemove / fieldRemoveAt: (elem, field, val, ...)`
- `fieldReorder: (elem, field, val, newPos)`
- `fieldRelocate: (elem, field, oldParent, newParent)`

## Usage pattern

```js
const builder = app.repository.operationBuilder;
builder.begin("Delete Everything");
builder.remove(elem1);
builder.fieldRemove(parent, "ownedElements", elem1);
builder.remove(elem2);
builder.end();
const op = builder.getOperation();
app.repository.doOperation(op);
```

## Functions

### Transaction

- `begin(opName)` — start building op
- `end()` — commit building
- `discard()` — cancel
- `getOperation(): Object` — snapshot current op
- `getTimestamp()`

### Element ops

- `insert(elem)` — create new element
- `remove(elem)` — delete element

### Field ops (array-valued fields like `ownedElements`, `attributes`)

- `fieldAssign(elem, field, val)` — set scalar field
- `fieldInsert(elem, field, val)` — append to array
- `fieldInsertAt(elem, field, val, pos)` — insert at index
- `fieldRemove(elem, field, val)` — remove from array
- `fieldRemoveAt(elem, field, val, pos)`
- `fieldReorder(elem, field, val, newPos)`
- `fieldRelocate(elem, field, oldParent, newParent)` — move between parents

## Notes for MCP extension

- Our current `delete_element` uses `engine.deleteElements()` directly. For safer cascaded delete we could compose an Operation here, then `doOperation(op)`, giving single-undo semantics.
- Useful for batch CRUD tools that modify many elements atomically.
