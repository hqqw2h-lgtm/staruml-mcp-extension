# StarUML Plugin API Reference

Snapshots of the official [StarUML 2.0.0 API docs](https://files.staruml.io/api-docs/2.0.0/api/index.html), distilled into actionable notes for building `staruml-mcp-extension`.

**Total modules:** 50. **Detailed notes:** 9 (tier-1 critical). The rest are linked directly to the official docs.

## Critical findings (bugs in our extension discovered via docs)

### 1. `Engine.deleteElements(models, views)` takes TWO arrays

Our handler passes a single combined array — wrong. Must split into models + views:

```ts
const views = app.repository.getViewsOf(elem);
app.engine.deleteElements([elem], views); // two arrays, not [elem, ...views]
```

See [`engine/Engine.md`](engine/Engine.md#deleteelements).

### 2. `Factory.createModelAndView(id, parent, diagram, options)` is POSITIONAL

Our handler passes all args in a single options object. Must call positionally:

```ts
factory.createModelAndView("UMLActor", parent, diagram, {
  modelInitializer: (m) => {
    m.name = "Owner";
  },
  x1: 100,
  y1: 100,
  x2: 200,
  y2: 150,
});
```

See [`engine/Factory.md`](engine/Factory.md#createmodelandview-id-parent-diagram-options-view).

### 3. `app.commands` runtime shape differs from docs

Docs show `getAll()`, `get(id)` — runtime instance has `commandNames`, `commands` map instead. Our `collectCommandIds()` handles this. Commands use colon format (`project:save`) not dot format (`file.save`) in current build.

### 4. Diagram/element types use `UMLXxx` (model) not `UMLXxxView`

When calling `createModelAndView("UMLActor", ...)`, pass the **model** type name. Factory auto-pairs with `UMLActorView`. Full list: [`uml/UMLDiagram.md`](uml/UMLDiagram.md).

## Module index (50 modules)

### /command

- [CommandManager.md](command/CommandManager.md) ✍️ — `app.commands`, execute/register commands
- [Commands.md](command/Commands.md) ✍️ — built-in command ID constants
- [KeyBindingManager](https://files.staruml.io/api-docs/2.0.0/api/modules/command/KeyBindingManager.html) — keyboard shortcuts

### /core

- [Core](https://files.staruml.io/api-docs/2.0.0/api/modules/core/Core.html) — element base classes
- [Global](https://files.staruml.io/api-docs/2.0.0/api/modules/core/Global.html) — global app state
- [IdGenerator](https://files.staruml.io/api-docs/2.0.0/api/modules/core/IdGenerator.html) — `app.idGenerator.generateGuid()`
- [OperationBuilder.md](core/OperationBuilder.md) ✍️ — transactional multi-element ops
- [PreferenceManager](https://files.staruml.io/api-docs/2.0.0/api/modules/core/PreferenceManager.html) — `app.preferences`
- [Repository.md](core/Repository.md) ✍️ — `app.repository`, query + persistence
- [Validator](https://files.staruml.io/api-docs/2.0.0/api/modules/core/Validator.html) — model integrity

### /diagrams

- [DiagramManager.md](diagrams/DiagramManager.md) ✍️ — `app.diagrams`, tab + canvas lifecycle
- [SidebarView](https://files.staruml.io/api-docs/2.0.0/api/modules/diagrams/SidebarView.html) — right sidebar
- [ToolboxView](https://files.staruml.io/api-docs/2.0.0/api/modules/diagrams/ToolboxView.html) — left drag toolbox
- [WorkingDiagramsView](https://files.staruml.io/api-docs/2.0.0/api/modules/diagrams/WorkingDiagramsView.html) — diagram tabs

### /dialogs

- [Dialogs](https://files.staruml.io/api-docs/2.0.0/api/modules/dialogs/Dialogs.html) — `app.dialogs.showAlert/showConfirm/showOpenDialog`
- [ElementPickerDialog](https://files.staruml.io/api-docs/2.0.0/api/modules/dialogs/ElementPickerDialog.html)
- [ElementListPickerDialog](https://files.staruml.io/api-docs/2.0.0/api/modules/dialogs/ElementListPickerDialog.html)
- [ElementListEditorDialog](https://files.staruml.io/api-docs/2.0.0/api/modules/dialogs/ElementListEditorDialog.html)

### /editors (interactive UI panels)

- [EditorsHolder](https://files.staruml.io/api-docs/2.0.0/api/modules/editors/EditorsHolder.html)
- [PropertyEditorView](https://files.staruml.io/api-docs/2.0.0/api/modules/editors/PropertyEditorView.html)
- [StyleEditorView](https://files.staruml.io/api-docs/2.0.0/api/modules/editors/StyleEditorView.html)
- [DocumentationEditorView](https://files.staruml.io/api-docs/2.0.0/api/modules/editors/DocumentationEditorView.html)

### /engine

- [Engine.md](engine/Engine.md) ✍️ — `app.engine`, low-level model/view mutation
- [Factory.md](engine/Factory.md) ✍️ — `app.factory`, create model/view/diagram
- [ProjectManager.md](engine/ProjectManager.md) ✍️ — `app.project`, save/load/close
- [SelectionManager.md](engine/SelectionManager.md) ✍️ — `app.selections`

### /explorer

- [ModelExplorerView](https://files.staruml.io/api-docs/2.0.0/api/modules/explorer/ModelExplorerView.html) — left tree
- [NavigatorView](https://files.staruml.io/api-docs/2.0.0/api/modules/explorer/NavigatorView.html) — mini-map

### /file

- [FileUtils](https://files.staruml.io/api-docs/2.0.0/api/modules/file/FileUtils.html)

### /filesystem (low-level fs IO, rarely called directly)

- FileSystem, File, Directory, FileIndex, FileSystemEntry, FileSystemError, FileSystemStats, WatchedRoot

### /menu

- [ContextMenuManager](https://files.staruml.io/api-docs/2.0.0/api/modules/menu/ContextMenuManager.html)
- [MenuManager](https://files.staruml.io/api-docs/2.0.0/api/modules/menu/MenuManager.html)

### /ui

- [StatusBar](https://files.staruml.io/api-docs/2.0.0/api/modules/ui/StatusBar.html)
- [Toast](https://files.staruml.io/api-docs/2.0.0/api/modules/ui/Toast.html) — `app.toast.info("Hello")`
- [Toolbar](https://files.staruml.io/api-docs/2.0.0/api/modules/ui/Toolbar.html)

### /uml

- [UML](https://files.staruml.io/api-docs/2.0.0/api/modules/uml/UML.html) — all UML metamodel classes
- [UMLDiagram.md](uml/UMLDiagram.md) ✍️ — diagram/element type reference

### /utils

- [AppInit](https://files.staruml.io/api-docs/2.0.0/api/modules/utils/AppInit.html) — `app.ready(cb)`
- [Async](https://files.staruml.io/api-docs/2.0.0/api/modules/utils/Async.html)
- [ExtensionUtils](https://files.staruml.io/api-docs/2.0.0/api/modules/utils/ExtensionUtils.html) — `loadRequire`, resource paths
- [KeyEvent](https://files.staruml.io/api-docs/2.0.0/api/modules/utils/KeyEvent.html)
- [NodeConnection](https://files.staruml.io/api-docs/2.0.0/api/modules/utils/NodeConnection.html)
- [PanelManager](https://files.staruml.io/api-docs/2.0.0/api/modules/utils/PanelManager.html)

## Global `app` namespace (runtime)

Per runtime introspection:

```
app.commands, app.repository, app.factory, app.engine, app.diagrams,
app.project, app.selections, app.dialogs, app.preferences, app.toast,
app.statusbar, app.toolbar, app.menu, app.contextMenu,
app.sidebar, app.navigator, app.toolbox, app.workingDiagrams,
app.modelExplorer, app.panelManager, app.extensionLoader,
app.extensionManagerDialog, app.elementPickerDialog,
app.elementListPickerDialog, app.elementListEditorDialog,
app.tagEditorDialog, app.tagValueEditorDialog, app.iconPickerDialog,
app.documentationEditor, app.propertyEditor, app.styleEditor,
app.editorsHolder, app.quickFind, app.quickedits, app.commandPalette,
app.keymaps, app.config, app.clipboard, app.fontManager,
app.licenseStore, app.metadata, app.metamodels, app.platform,
app.titlebar, app.updateManager, app.validator, app.version,
app.type
```

`app.type` holds the **metamodel class registry** — this is how Factory resolves `"UMLActor"` to the actual `UMLActor` constructor.
