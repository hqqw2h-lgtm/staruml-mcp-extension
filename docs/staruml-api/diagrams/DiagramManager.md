# DiagramManager

Source: https://files.staruml.io/api-docs/2.0.0/api/modules/diagrams/DiagramManager.html

Accessed via `app.diagrams`. Manages open diagram tabs + canvas state.

## Events

- `currentDiagramChanged: (diagram)`
- `viewDoubleClicked: (view, x, y)`
- `selectionChanged: (views)`
- `viewMoved: (views, dx, dy)`

## Diagram lifecycle

- `getCurrentDiagram(): Editor` — active editor/diagram
- `setCurrentDiagram(diagram, skipEvent?)`
- `openDiagram(diagram)` — add to working set
- `closeDiagram(diagram)`
- `closeAll()`
- `closeOthers()`
- `nextDiagram()` / `previousDiagram()`
- `getWorkingDiagrams(): Diagram[]`
- `saveWorkingDiagrams()` / `restoreWorkingDiagrams()`
- `updateDiagram(diagram)`

## Selection + interaction

- `selectAll()` — select all view elements on current diagram
- `selectInDiagram(view)` — open diagram + scroll to view + select
- `deselectAll()`
- `setActiveHandler(handler)` — tool handler

## Canvas / viewport

- `getEditor(): Editor`
- `getHiddenEditor()`
- `getDiagramArea(): Rect`
- `getViewportSize(): Point` (width × height)
- `getScrollPosition(): Point` / `scrollTo(x, y, animation)`
- `getZoomLevel(): number` (0..1) / `setZoomLevel(value)`
- `repaint()`

## Grid

- `showGrid()` / `hideGrid()` / `toggleGrid()` / `isGridVisible(): boolean`

## Notes for MCP extension

- Our tools `switch_diagram` ↔ `setCurrentDiagram`, `close_diagram` ↔ `closeDiagram`.
- `openDiagram` (add to working set) is subtly different from `setCurrentDiagram` (open + focus). Consider exposing both.
- Could expose zoom/scroll/grid via a new `diagram_view_control` tool set.
