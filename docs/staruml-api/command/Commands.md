# Commands (built-in command IDs)

Source: https://files.staruml.io/api-docs/2.0.0/api/modules/command/Commands.html

List of documented command ID constants.

## ⚠️ Runtime vs docs mismatch

Docs use dot-separated IDs (`file.save`, `edit.delete`). **Runtime commands in the current StarUML version use colon-separated IDs** (`project:save`, `edit:delete`, `view:fit-to-window`). Use runtime-discovered IDs via `get_all_commands` — those are canonical.

## Documented IDs (may or may not match runtime)

### File

- `file` — file menu
- `file.new`, `file.newFromTemplate`, `file.open`, `file.openRecent`
- `file.save`, `file.saveAs`, `file.close`
- `file.import`, `file.import.fragment`, `file.export`, `file.export.fragment`
- `file.preferences`, `file.printToPDF`
- `file.close_window`, `file.quit`

### Edit

- `edit` — edit menu
- `edit.undo`, `edit.redo`
- `edit.cut`, `edit.copy`, `edit.paste`, `edit.selectAll`
- `edit.delete`, `edit.deleteFromModel`
- `edit.moveUp`, `edit.moveDown`
- `edit.selectInExplorer`, `edit.selectInDiagram`

### Format

- `format`, `format.font`
- `format.fillColor`, `format.lineColor`
- `format.linestyle`, `format.linestyle.rectilinear`, `format.linestyle.oblique`
- `format.autoResize`, `format.showShadow`

### Model

- `model`

### Tools

- `tools`, `tools.extensionManager`

### View

- `view`
- `view.closeDiagram`, `view.closeOtherDiagrams`, `view.closeAllDiagrams`
- `view.nextDiagram`, `view.previousDiagram`
- `view.zoomIn`, `view.zoomOut`, `view.actualSize`, `view.fitToWindow`
- `view.showGrid`
- `view.hideSidebar`, `view.hideNavigator`, `view.hideToolbar`, `view.hideStatusBar`
- `view.hideToolbox`, `view.hideEditors`

### Help

- `help`, `help.about`, `help.checkForUpdates`, `help.enterLicense`
- `help.documentation`, `help.forum`, `help.releaseNote`, `help.requestFeature`

### App

- `app.reload`

## Runtime-verified sample (from our get_all_commands on StarUML 7)

```
alignment:align-bottom, alignment:align-center, alignment:align-left,
alignment:align-middle, alignment:align-right, alignment:align-top,
alignment:bring-to-front, alignment:send-to-back,
project:save, project:save-as, project:new, project:open, project:close,
project:export-diagram-to-png, project:export-diagram-to-svg,
project:export-diagram-to-jpeg, project:print-to-pdf,
edit:delete, edit:undo, edit:redo, edit:cut, edit:copy, edit:paste,
view:fit-to-window, view:zoom-in, view:zoom-out, view:actual-size,
...
```

138 total commands available in our runtime. Use `get_all_commands` via MCP to get the authoritative list.
