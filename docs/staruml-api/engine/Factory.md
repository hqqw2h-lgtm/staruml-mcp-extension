# Factory

Source: https://files.staruml.io/api-docs/2.0.0/api/modules/engine/Factory.html

Accessed via `app.factory`. Creates model, view, and diagram elements. Dispatches events: `diagramCreated`, `elementCreated`.

## Key creation functions (positional args!)

### `createDiagram(id, parent, options): Diagram`

Create a diagram element.

- `id` — string (diagram type, e.g. `'UMLClassDiagram'`)
- `parent` — Model
- `options` — Object

### `createModel(id, parent, field, options): Model`

Create a model element (no view).

- `id` — string (type, e.g. `'UMLClass'`)
- `parent` — Model
- `field` — string (which array field to append into, e.g. `'ownedElements'`)
- `options` — Object `{ precondition, modelType, field, modelInitializer }`

### `createModelAndView(id, parent, diagram, options): View`

Create model + view in one call.

- `id` — string (combined type, e.g. `'UMLActor'`, `'UMLUseCase'`)
- `parent` — Model (owner)
- `diagram` — Diagram (target)
- `options` — Object `{ precondition, modelType, viewType, field, modelInitializer, viewInitializer, x1, y1, x2, y2, containerView }`

### `createViewAndRelationships(editor, x, y, model, containerView)`

Create a view of a given model **with relationship views auto-drawn**.

### `createViewOf(model, diagram, options)`

Create a view element of an existing model based on diagram type.

## Discovery helpers

### `getDiagramIds(): string[]`

Returns all registered IDs usable with `createDiagram`.

### `getModelIds(): string[]`

Returns all registered IDs usable with `createModel`.

### `getModelAndViewIds(): string[]`

Returns all registered IDs usable with `createModelAndView`. **Use this to discover valid element types for populating diagrams.**

## Registration (extension authors)

- `registerDiagramFn(id, fn)`
- `registerModelFn(id, fn)`
- `registerModelAndViewFn(id, fn, defaultOptions)`
- `registerViewOfFn(diagramType, fn)`

## Default factory helpers (building blocks for plugins)

- `defaultDiagramFn(parent, options)` — options: `{ precondition, diagramType, diagramInitializer }`
- `defaultModelFn(parent, field, options)`
- `defaultModelAndViewFn(parent, diagram, options)`
- `defaultViewOnlyFn(parent, diagram, options)`
- `defaultEdgeViewOnlyFn(parent, diagram, options)`
- `defaultDirectedRelationshipFn(parent, diagram, options)` — e.g. UMLDependency, UMLGeneralization
- `defaultUndirectedRelationshipFn(parent, diagram, options)` — e.g. UMLAssociation

## Notes for MCP extension

- Our `createElementWithView` handler passes `{id, parent, diagram, ...}` as a single options object. Per docs, signature is **positional** `createModelAndView(id, parent, diagram, options)`. The handler should call:
  ```js
  factory.createModelAndView(typeName, parent, diagram, {
    modelInitializer: (m) => {
      m.name = name;
    },
    x1,
    y1,
    x2,
    y2,
  });
  ```
- Expose `getModelAndViewIds()` / `getDiagramIds()` as new MCP tools so agents can discover valid type names instead of guessing.
