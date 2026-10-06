# Engine

Source: https://files.staruml.io/api-docs/2.0.0/api/modules/engine/Engine.html

Accessed via `app.engine`.

## Functions (28)

### Core CRUD

#### `addItem(elem, field, val)`

Add an item to a particular array field of an element.

- `elem` — Element
- `field` — string
- `val` — Element

#### `addModel(parent, field, model): Model`

Add a model element.

- `parent` — Model
- `field` — string (e.g. 'ownedElements')
- `model` — Model to be added
- Returns the added Model.

#### `addModelAndView(diagram, model, view, parent, parentField, containerView?)`

Add a model element and a view element.

- `diagram` — Diagram where added views to be placed
- `model` — Model element to be added
- `view` — View element to be added
- `parent` — Model parent element to contain the model element
- `parentField` — nullable string (default `'ownedElements'`)
- `containerView` — nullable View to contain the view element

#### `addViews(diagram, views)`

Add view elements.

- `diagram` — Diagram where added views to be placed
- `views` — Array of Core.View

#### **`deleteElements(models, views)`**

⚠️ **Signature takes TWO arrays**, not one combined.

- `models` — Array of Model elements to delete
- `views` — Array of View elements to delete

#### `removeItem(elem, field, val)`

Remove an item from an array field.

#### `relocate(elem, newOwner, field)`

Relocate an element to a new owner (parent).

### Properties

#### `setProperty(elem, field, value)`

Set value to a property of an element.

#### `setProperties(elem, fieldValueMap)`

Set multiple properties at once. `fieldValueMap: Object<string, ?>`.

#### `setElemsProperty(views, field, value)`

Set value to a property of multiple elements.

### View layout / style

#### `resizeNode(editor, node, left, top, right, bottom)`

Resize a node view.

#### `setAutoResize(editor, views, autoResize)`

Change autoResize of node views.

#### `moveViews(editor, views, dx, dy)` / `moveViewsChangingContainer(editor, views, dx, dy, containerView)`

Move views.

#### `moveUp(parent, field, elem)` / `moveDown(parent, field, elem)`

Reorder array field items.

#### `modifyEdge(editor, edge, points)`

Modify points of an edge view.

#### `reconnectEdge(editor, edge, points, newParticipant, isTailSide)`

Reconnect an edge end to a new element.

#### `moveParasiticView(editor, view, alpha, distance)`

Move a parasitic view.

#### `layoutDiagram(editor, diagram, direction, separations)`

Layout diagram.

- `separations: {node: number, edge: number, rank: number}`

### Style setters (all take `editor, views, ...`)

- `setFillColor(editor, views, color)` — CSS color string e.g. `"#ffffff"`
- `setLineColor(editor, views, color)`
- `setLineStyle(editor, views, lineStyle)`
- `setFont(editor, views, face, size, color)` — combined font change
- `setFontFace(editor, views, fontFace)`
- `setFontSize(editor, views, fontSize)`
- `setFontColor(editor, views, color)`
- `setStereotypeDisplay(editor, views, stereotypeDisplay)`

## Notes for MCP extension

- Our current `deleteElement` handler calls `engine.deleteElements([combined_array])` — **wrong**. Must split into models + views.
- For adding elements programmatically with visual, prefer `Factory.createModelAndView` (higher-level) over `Engine.addModelAndView` (lower-level).
