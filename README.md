# staruml-mcp-extension

StarUML extension that adds HTTP endpoints for element CRUD, project lifecycle, and command execution on `localhost:58322` — so any HTTP client (or MCP server) can drive StarUML programmatically.

**Companion to [`staruml-mcp`](https://github.com/ezrabrilliant/staruml-mcp)** (npm MCP server) — install both to let AI agents (Claude Code, Cursor, VS Code, Codex) use these endpoints as tools.

```
  AI Agent  ──MCP──►  staruml-mcp (npm)  ──HTTP──►  this extension  ──►  StarUML
```

If you only want to curl StarUML from your own scripts, install just this extension.

## Installation

1. Open StarUML
2. Go to **Tools → Extension Manager**
3. Click **Install From URL**
4. Paste: `https://github.com/ezrabrilliant/staruml-mcp-extension`

## Requirements

- StarUML v7+
- StarUML API Server enabled — edit `%APPDATA%\StarUML\settings.json` (Win) / `~/Library/Application Support/StarUML/settings.json` (macOS):

  ```json
  { "apiServer": true, "apiServerPort": 58321 }
  ```

- Port `58322` free on localhost (configurable, see below)

## Preferences

**File → Preferences → MCP Extension** (`preferences/preference.json`):

| Key                                | Default | Meaning                                                                           |
| ---------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `mcp-ext.server.enabled`           | `true`  | Start the HTTP server when StarUML starts                                         |
| `mcp-ext.server.port`              | `58322` | Loopback port; `0` lets the OS pick a free one                                    |
| `mcp-ext.server.logLevel`          | `info`  | Developer console output: `error`, `info`, or `debug` (one line per request)      |
| `mcp-ext.token`                    | empty   | When set, every request needs `Authorization: Bearer <token>`                     |
| `mcp-ext.security.allowedOrigins`  | empty   | Browser origins let through, comma-separated                                      |
| `mcp-ext.limits.maxBodyKiB`        | `4096`  | Largest request body                                                              |
| `mcp-ext.limits.maxBatchOps`       | `500`   | Most ops in one `/batch`                                                          |
| `mcp-ext.limits.timeoutSeconds`    | `60`    | Answer `504` to a request still waiting after this long                           |
| `mcp-ext.limits.commandsPerMinute` | `60`    | Calls per minute to each of `/execute_command`, `/generate_code`, `/reverse_code` |

Enabled and port take effect after a restart, the others on the next request. **Tools → MCP Extension → Server Info...** shows the bound address, whether a token is required, the allowed origins and the endpoint list; **Generate Access Token...** stores a random token and shows it once.

### Access rules

The server listens on 127.0.0.1 only, but any local process, and any web page through the browser, can reach a loopback port. Every request is checked in this order:

1. An `Origin` header (sent by browsers, not by scripts or the MCP server) not in `allowedOrigins`: `403 FORBIDDEN_ORIGIN`.
2. With `mcp-ext.token` set, a missing or different `Authorization: Bearer` token: `401 UNAUTHORIZED`, also for `GET /`.
3. A `POST` without `Content-Type: application/json` (parameters such as `charset` are fine): `415 UNSUPPORTED_MEDIA_TYPE`. Browsers cannot send that type cross-origin without a preflight, which is refused.
4. A body over `maxBodyKiB`: `413 PAYLOAD_TOO_LARGE`.
5. `/execute_command`, `/generate_code` or `/reverse_code` over `commandsPerMinute`: `429 RATE_LIMITED` with `Retry-After`.
6. No answer within `timeoutSeconds`: `504 TIMEOUT`. Handlers run on StarUML's UI thread and cannot be cancelled, so the call may still complete; only waits (exports, commands) can time out.

Clients pass the token as a header, e.g. `curl -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{}' localhost:58322/get_project_info`. The live tests, load test and `snapshot:introspect` read it from `STARUML_EXT_TOKEN`.

## Endpoints

All `POST` with `Content-Type: application/json` and a JSON object body. Base URL: `http://localhost:58322`; `GET /` lists the endpoints.

| Group         | Endpoints                                                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalogue     | `/introspect`, `/search_types`, `/debug`                                                                                                                                      |
| Commands      | `/get_all_commands`, `/describe_commands`, `/execute_command`                                                                                                                 |
| Project       | `/get_project_info`, `/save_project`, `/save_project_as`, `/new_project`, `/open_project`                                                                                     |
| Elements      | `/get_element_by_id`, `/find_elements`, `/create_element`, `/update_element`, `/delete_element`, `/create_element_with_view`                                                  |
| Relationships | `/create_relationship`, `/create_edge_with_view`                                                                                                                              |
| Element parts | `/add_attribute`, `/add_operation`, `/add_parameter`, `/add_enumeration_literal`, `/add_template_parameter`, `/add_slot`, `/add_tag`, `/set_stereotype`, `/set_documentation` |
| Diagrams      | `/build_diagram`, `/describe_diagram`, `/validate_model`, `/lint_diagram`, `/uml_lint`, `/create_diagram`, `/switch_diagram`, `/close_diagram`                                |
| Views         | `/layout_diagram`, `/route_edges`, `/move_views`, `/resize_node`, `/set_view_style`, `/set_z_order`, `/create_view_of`, `/divide_fragment`                                    |
| Lookups       | `/get_views_of`, `/get_edge_views_of`, `/get_relationships_of`, `/get_refs_to`, `/get_connected_node_views`                                                                   |
| Editor        | `/get_selection`, `/set_selection`, `/get_editor_state`, `/set_editor_state`                                                                                                  |
| Export        | `/export_diagram`, `/export_diagrams`, `/export_pdf`, `/export_html`, `/export_text`                                                                                          |
| Code          | `/list_code_generators`, `/generate_code`, `/reverse_code`                                                                                                                    |
| Batches       | `/batch`                                                                                                                                                                      |
| History       | `/undo`, `/redo`, `/is_modified`                                                                                                                                              |

### References: paths and canonical field names

Every field that takes an element, view or diagram takes its id or a path (`src/refs.ts`):

| Reference                           | Names                                                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Model/Shop/Order`                  | owners from the project down, `/` between steps                                                                                    |
| `Shop/Order`, `Order`               | the trailing steps of a path, when one element ends so; a path from the project wins                                               |
| `/Model/Shop`                       | only the path from the project                                                                                                     |
| `Order.total`                       | a member: attribute, literal, column, slot, parameter                                                                              |
| `Order#pay`, `Order#pay(int, Item)` | an operation; parameter types pick an overload                                                                                     |
| `Main`, `Model/Main`                | a diagram, by name or path                                                                                                         |
| `Order@Main`                        | the view of `Order` on the diagram `Main`; a model where a view is expected is its only view, or its view on the request's diagram |
| `@current`, `@project`              | the diagram open in the editor; the project                                                                                        |

`\` escapes `/ . # @ ( ) , \` inside a name. Ids win over paths. A reference that fits several elements is `409 AMBIGUOUS_REF` with `details.candidates` (`_id`, `_type`, `path`, at most 20); one that fits none is `404 NOT_FOUND`. Summaries carry `path`, the canonical form, which resolves back to the element whenever the names along it are unique among their siblings; `/batch` results do too, so `"$name.path"` works.

The fields have one name each across endpoints: `ref` (the element acted on), `refs`, `diagram`, `diagrams`, `tail`, `head`, `parent` (owner of what is created), `container` (host or containing view), `views` and `models` (`/set_selection`). The earlier names (`id`, `ids`, `elementId`, `ownerId`, `operationId`, `enumerationId`, `instanceId`, `modelId`, `baseId`, `diagramId`, `parentId`, `containerViewId`, `tailId`/`headId`, `tailViewId`/`headViewId`, `viewIds`, `modelIds`) are accepted as aliases; the manifest lists each beside its canonical field with `x-alias-of` and `deprecated: true`, and passing both spellings is `400 INVALID_ARGUMENT`.

Creating a classifier, package, diagram, attribute, enumeration literal, ERD entity or column named like a sibling of its kind is `409 DUPLICATE_NAME` (`details.existing`), since a path could not tell them apart; `allowDuplicateNames: true` adds it anyway. `/build_diagram` passes it for new elements when `reuse` is false or several elements already have the name.

### `/introspect`

Returns the StarUML and extension versions and, unless `include` narrows it, four sections:

- `factory`: the ids `create_element`, `create_element_with_view` and `create_diagram` accept, and what each model-and-view id creates.
- `metamodel`: every type of the loaded metamodel with its kind, super types, attributes (kind and type), view type, relationship kind and which factory creates it. `types` restricts it, `inherited: true` lists inherited attributes too.
- `toolbox`: the diagram editor's palette. An item id can be passed as `type` wherever a model-and-view id is accepted and applies the item's presets (`UMLComposition`, `UMLAsyncMessage`, `UMLInitialState`, ...).
- `endpoints`: the manifest: path, description, `readOnly` and `destructive` flags, and JSON Schemas (2020-12) of the request and of `data` in the response; `errors` gives the status per code and the error body schema. Every request is validated against its schema.

`tests/fixtures/introspect.7.1.1.json` records the answer of 7.1.1; `npm run snapshot:introspect` refreshes it.

### Finding types, reading diagrams, validating

- `/search_types {query, limit?, categories?}` ranks diagram types, palette items, relationship ids, model types, enumerations and command ids against a fuzzy query: a whole id beats a prefix, a prefix a substring, then all query words in the id, title or description, then the query's letters in order ("clsdgm"). Descriptions and the minimal `example` request are generated from the metamodel, the factory, the palette and the command catalogue, so types added by extensions are found too.
- `/describe_diagram {diagram, maxChars?}` answers a few lines of text: the diagram, each node with its members (`+id: long; +total(): double`), each edge as `"tail" (end) -[Type "name"]-> (end) "head"`, where an association or ERD relationship end shows its aggregation (`shared`, `composite`), multiplicity or cardinality and role name, e.g. `"Order" (composite 1) -[UMLAssociation]-> (1..*) "Line"`, cut to `maxChars` (default 4000).
- `/validate_model {scope?, limit?}` runs StarUML's validation rules on the open model and lists `{id, _type, name, ruleId, message}`. StarUML loads `rules.js` only in its main process and validates the saved file there (**Model → Validate**); this endpoint loads the same files (`resources/default/rules.js` and the `rules.js` of every essential, default, dev and user extension) into the window's `rules` once and runs `app.validator`, so no save is needed.
- `/lint_diagram {diagram?, rules?, limit?}` reviews a diagram's picture (default the current one): `L001 stacked` views at one origin (error), `L002 overlap`, `L003 out-of-canvas`, `L004 edge-crosses-node` (an edge through a node that is not its end; lifelines a message passes and areas such as frames, fragments, lanes and boundaries do not count), `L005 label-overflow` (a name wider than its box at 7px a character, which StarUML wraps or cuts), `L006 disconnected` (no edge, on a diagram that has edges) and `L007 dense` (7 or more node centres in a 300x300 cell). Each finding has `ids` and `paths` of the views, a severity, a one-line `fix` and an `autofix`, a request to send as is (`/move_views`, `/resize_node`, `/layout_diagram`), or null.
- `/uml_lint {scope?, rules?, naming?, limit?}` checks what `app.validator` does not: `U001` association ends without multiplicity, `U002` associations with no navigable end, `U003` attributes without a type, `U004` relationships missing an end, `U005` abstract classes without a subclass, `U006` interfaces nobody realizes, `U007` call messages naming no operation of the receiving lifeline's classifier (or its superclasses), `U008` use cases without an actor (included and extending ones are reached through another), `U009`/`U010` state machines without an initial or final state, `U011` ERD entities without a primary key and `U012` names off the convention. `rules` turns a rule `off` or sets its severity by id or name; `naming` sets the convention per kind (`classifier`, `attribute`, `operation`, `literal`, `package`) as `PascalCase`, `camelCase`, `UPPER_CASE`, `snake_case`, `lowercase`, a regular expression, or `false`. Both lints answer `count`, `counts` per severity, `truncated` and the findings, most severe first, cut to `limit` (default 100).

### Creating and changing elements

- `create_element` files the element in the owner list typed for it (`attributes` for a UMLAttribute in a class, `columns` for an ERDColumn) unless `field` says otherwise; `properties` sets attributes on creation.
- `create_element_with_view` takes `container` for views placed on or inside another view (ports, parts, pins, BPMN boundary events, timing diagram parts).
- `create_relationship` sets the ends: source/target, or end1/end2 with `tailEnd`/`headEnd` attributes. With `diagram` it draws the edge through StarUML's factory and its connection rules; without, it creates the model only. `name` is the relationship's own name, drawn as a plain label (the edge view's `showVisibility` is turned off, which would otherwise prefix it with `+`); role names go in `tailName`/`headName`.
- `update_element` with `op`: `set` (references as id or `{$ref}`), `add`/`remove` on reference lists, `reorder` within a list, `relocate` to another owner. Each call is one undo step.

### Views and export

- View edits go through StarUML's engine (`layoutDiagram`, `moveViews`, `resizeNode`, `setFillColor`, ...), which needs the editor to show the views' diagram, so they make that diagram current. Each is one undo step; `/set_view_style` is one step per property given.
- `/layout_diagram` takes a `preset`: `flow-down|up|right|left` put an edge's source before its target, `hierarchy-down|up|right|left` its target first (a superclass above its subclasses). StarUML hands edges to dagre head first (`Diagram.layout` in `core/core.js`), so its raw `direction: "TB"` draws a flow bottom-up; the flow presets pass the opposite rank direction. `nodeSeparation`, `rankSeparation` and `edgeLineStyle` override the preset, and a partial spacing is completed with StarUML's defaults (30). `fit: true` first sizes node views to their content, one more undo step.
- `/route_edges {diagram, lineStyle}` gives every edge on the diagram one line style (`rectilinear`, `oblique`, `roundrect`, `curve`) in one undo step.
- `/move_views {refs, dx, dy, container}` also puts the views inside the container view and their models inside its model (`Engine.moveViewsChangingContainer`), as dropping them on it does; a composite state holds states in its region's view, which the diagram gets when drawn, so the endpoint draws it first.
- `/create_view_of {ref, diagram, x, y}` shows an existing element as dragging it from the Model Explorer does (`Factory.createViewOf`), relationships to elements already on the diagram included. A model already shown answers its view; a relationship needs both ends shown first.
- `/divide_fragment {ref, at}` sets where each operand of a combined fragment begins (diagram y of each boundary). StarUML stacks operand views by their heights and stretches the last one, so this sets the heights.
- `/export_diagram` renders PNG and JPEG by calling StarUML's own exporter (`engine/diagram-export.js` `getImageData`, what **File → Export Diagram As** uses) and SVG through its SVG export. `scale` (pixels per diagram unit, default 1; the menu uses the display's pixel ratio) is passed as the pixel ratio that exporter reads; `background` (default transparent, white for JPEG) is painted under a transparent rendering. It answers base64 or writes `path`. Whatever the exporter draws for the running licence appears as it does in the menu.
- `/export_diagrams` writes every diagram (or `diagrams`) into a directory, one PNG, JPEG or SVG file each, named after the diagram.
- `/export_text {diagram, format: mermaid|plantuml}` writes class, sequence, use case, activity, state machine, ERD, flowchart, mind map, requirement and C4 diagrams as text, from the views on the diagram. The Mermaid is the dialect `/build_diagram` reads, with the diagram's name as front matter `title`, so `/build_diagram {mermaid, kind}` with the answer's `kind` rebuilds the same nodes, members and edges; use case and activity diagrams come out as flowcharts in the shape `build_diagram` reads as those kinds. PlantUML uses aliases so any name works; activity diagrams and flowcharts use the legacy activity syntax, whose arrows join any two nodes. Composite states come out as `state X { }` blocks, notes on class, state and sequence diagrams as notes, and an operand's `else` before its first message, read from the heights of the drawn operand views. `warnings` names what the text leaves out: views of other kinds, fragments without a Mermaid block, nodes without flows in PlantUML. Requirement diagrams are Mermaid `requirementDiagram`s and, since PlantUML has none, stereotyped PlantUML classes; C4 diagrams are the macros Mermaid and C4-PlantUML share, at the deepest level used (`C4Context`, `C4Container`, `C4Component`), external elements being the grey ones. `tests/fixtures/export` holds the output for every build case.
- `/export_pdf` and `/export_html` write what the CLI's `pdf` and `html` commands write, to an absolute path.

### Commands and code generation

- [`docs/commands.md`](docs/commands.md) lists every command id with its arguments, effect and dialog behaviour; `/describe_commands` answers the same from the running app. `npm run docs:commands` regenerates the file.
- `/execute_command` answers `422 DIALOG_REQUIRED` instead of waiting on a dialog: commands that always open one, or that are missing the arguments that avoid one, are refused before they run; any other command runs with every `app.dialogs.show*` and `app.*Dialog.showDialog` replaced, and is stopped where it would open one. StarUML's message and file boxes are synchronous, so an opened one would freeze StarUML and this server with it.
- `/generate_code {language, ref, path, options?}` runs an installed generator extension (`staruml.java`, `staruml.cpp`, `staruml.csharp`, `staruml.python`) and lists the files it wrote; options default to the generator's preferences. `/reverse_code {language, path, options?}` reads a source directory into the project through the extension's analyzer. `/list_code_generators` shows what is installed. All three find the extension wherever StarUML loaded it from.

### `/batch`

`{ops: [{path, body, as?}], atomic?}` runs endpoint calls in order. A string `"$name"` anywhere in a later `body` becomes the id of the result saved `as: "name"`; `"$name.view"` and `"$name.model"` pick the parts of a `create_*_with_view` result, and any path into the result works (`.id` means `_id`). `"$$"` escapes a literal `$`.

- `atomic: true` (default): the batch is one undo step. If an op fails, everything it ran is undone, nothing is left to redo, and the answer is that op's error code with `details: {index, results}`. Atomic batches refuse `/undo`, `/redo`, `/new_project`, `/open_project`, `/save_project*`, `/execute_command`, `/export_pdf`, `/export_html`, `/export_diagrams`, `/generate_code`, `/reverse_code`, `/build_diagram`.
- `atomic: false`: every op runs; `results` has each op's `data` or `code`/`error`, and `succeeded`/`failed` count them.
- At most `mcp-ext.limits.maxBatchOps` ops (default 500) and `mcp-ext.limits.maxBodyKiB` of body (default 4096, for every endpoint); over either is `413 PAYLOAD_TOO_LARGE`.

### `/build_diagram`

One call builds a whole diagram: `{kind, spec}`, `{mermaid}` or `{text, format?}`, plus optional `name`, `parentId`, `direction` (`TB`, `BT`, `LR`, `RL`), `autoLayout` (default true), `upsert`, `prune` and `reuse` (default true). It runs as one `/batch`, so the diagram is one undo step and a failure leaves nothing behind, and answers `{diagram, created, updated, unchanged, shown?, deleted?, warnings?, layout, ids: {name: {model, view}}, edges}` rather than the model.

| `kind`         | `spec`                                                                                                                                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `class`        | `packages`, `classes: [{name, kind: class\|interface\|enum\|abstract, package, attributes: ["+id: long"], operations: ["+total(): double"], literals}]`, `relations: [{from, to, type, fromMultiplicity, toMultiplicity}]`                                            |
| `sequence`     | `participants`, `messages: [{from, to, text, kind: sync\|async\|reply\|create\|delete}]`, `fragments: [{operator, guard, operands, operandStarts, from, to}]` (message indices)                                                                                       |
| `usecase`      | `system`, `actors`, `useCases`, `relations: [{from, to, type: association\|include\|extend\|generalization}]`                                                                                                                                                         |
| `activity`     | `lanes`, `nodes: [{id, name, type: action\|initial\|final\|flowFinal\|decision\|merge\|fork\|join\|object, lane}]`, `flows: [{from, to, guard}]`                                                                                                                      |
| `statemachine` | `states: [{id, name, type: state\|initial\|final\|choice\|fork\|join, parent}]`, `transitions: [{from, to, trigger, guard, effect}]`                                                                                                                                  |
| `erd`          | `entities: [{name, columns: ["id int PK", "name varchar(40)"]}]`, `relationships: [{from, to, fromCardinality, toCardinality, name, identifying}]`                                                                                                                    |
| `flowchart`    | `nodes: [{id, name, shape: process\|decision\|terminator\|data\|document\|database\|...}]`, `flows: [{from, to, label}]`                                                                                                                                              |
| `mindmap`      | `root: {name, children: [...]}`                                                                                                                                                                                                                                       |
| `requirement`  | `requirements: [{name, type: requirement\|functional\|interface\|performance\|physical\|design, id, text, risk, verifyMethod}]`, `elements: [{name, type, docRef}]`, `relations: [{from, to, type: contains\|copies\|derives\|satisfies\|verifies\|refines\|traces}]` |
| `c4`           | `elements: [{id, name, type: person\|system\|container\|component, kind, technology, description, external}]`, `relations: [{from, to, label, technology, description}]`                                                                                              |

- Every kind also takes `notes: [{text, on}]`, UMLNotes linked to the nodes they are on (on a sequence diagram drawn beside or `over` lifelines, `at` a message index, without links), and `styles: {node: {fillColor, lineColor, fontColor}}`.
- A state with `parent` is nested in that state, which becomes a composite state (the toolbox's, one region): its view sits inside the parent's region view and its model in the region, and a diagram with nesting keeps the computed placement, each composite grown to hold its states.
- `operandStarts` gives the first message of each further operand of a fragment; the fragment is divided there (`/divide_fragment`) instead of evenly.
- Edges name their ends by node name (or `id` where nodes have one). In `aggregation` and `composition` relations `from` is the whole: it is drawn at the tail with the diamond on its end (`end1`), as StarUML's own "add aggregated part" commands do, and Mermaid/PlantUML `A *-- B` reads the same way. `<br/>` and `\n` in names become line breaks.
- Mermaid is parsed in the extension: `classDiagram` (a `class Id["Label"]` is named by its label, a `namespace` becomes a package), `sequenceDiagram`, `flowchart`/`graph`, `erDiagram`, `stateDiagram` (`state X { }` blocks nest states, `[*]` in a block is its own), `mindmap`, `requirementDiagram` (SysML requirements on a requirement diagram), `C4Context`/`C4Container`/`C4Component` (StarUML's C4 elements). Notes (`note for X "..."`, `note right of X`, `Note over A,B: ...`) become UMLNotes; the `fill`, `stroke` and `color` of `classDef` with `class`, `cssClass` or `:::`, and of `style`, become fill, line and text colours (`classDef default` colours every node without a class); `else`/`and`/`option` mark where each operand of a sequence fragment begins. With `kind: "activity"` or `"usecase"` a flowchart is read as that kind: stadium or circle nodes are start and end (activity) or use cases, `{}` decisions, `{{}}` forks, subgraphs lanes or the system boundary, link labels guards or include/extend. The diagram is named by `name`, else front matter `title:` or a `title` line.
- `text` is read as `format` (`mermaid`, `plantuml`, `sql`, `jsonschema`), detected when omitted: `@start...` is PlantUML, a JSON object JSON Schema, `CREATE TABLE` SQL, anything else Mermaid. `kind` picks the PlantUML reader where the statements do not tell, and reads JSON Schema as an ERD. The answer's `format` says what was read, and `warnings` what the source says that the diagram does not show. A well-formed source using a construct with no StarUML counterpart is refused with `422 UNSUPPORTED_SYNTAX`, which names the construct and its line; nothing is built.

  | Format                       | Read                                                                                                                                                                                                                                                                                                                                                                               | Refused (`UNSUPPORTED_SYNTAX`)                                                                                                 |
  | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
  | Mermaid `requirementDiagram` | `requirement` and the five typed requirements (stereotypes as StarUML's own importer sets them), `element`, the seven relations both ways, `classDef`/`:::`                                                                                                                                                                                                                        |                                                                                                                                |
  | Mermaid C4                   | `C4Context`, `C4Container`, `C4Component`: `Person`, `System`, `Container`, `Component` with `Db`, `Queue` and `_Ext`; `Rel`, `Rel_Back`, `Rel_U/D/L/R`, `BiRel` (one way, warned); `UpdateElementStyle` hex colours; boundaries are read through and warned (no StarUML boundary element)                                                                                         | `C4Dynamic`, `C4Deployment`, deployment nodes                                                                                  |
  | PlantUML class               | `class`, `abstract`, `interface`, `enum`, `entity`, `struct`, `exception`; `"Name" as A`, `A as "Name"`, `<<stereotype>>`, `#colour`, generics, `extends`/`implements`; members with `{static}`/`{abstract}`; `package`/`namespace` (nested ones flattened, warned); `<\|--` `<\|..` `*--` `o--` `-->` `..>` `--` `..` both ways, `"cardinality"`, `: label`; notes and note links | `annotation`, `protocol`, `metaclass`, `circle`, `diamond`, `object`, `map`, `json`; arrows such as `+--`, `#--`               |
  | PlantUML sequence            | `participant` and its kinds, `actor`; `->` `->>` `-->` `<-` `<<-` `-\\` `->x` `!!`; `create`, `destroy`; `alt`/`else`, `opt`, `loop`, `par`, `break`, `critical`, `group` (an operator word, else `seq`); notes `left`/`right`/`over`; activation, boxes, dividers and delays skipped                                                                                              | found/lost messages `[->`, `->]`; `ref over`; `return`                                                                         |
  | PlantUML use case            | `actor`, `:Actor:`, `usecase`, `(Use case)` with aliases; one `rectangle`/`package` as the system (others warned); associations, `<\|--`/`-\|>` generalizations, `<<include>>`/`<<extend>>`; notes                                                                                                                                                                                 |                                                                                                                                |
  | PlantUML activity            | `start`, `stop`, `end`, `kill`, `detach`, `:action;` over lines, `if`/`elseif`/`else`/`endif`, `while`/`endwhile`, `repeat`/`repeat while`, `fork`/`fork again`/`end fork`, `split` (as a fork), `\|lanes\|`, `-> label;`, notes; the legacy `(*) --> "A" as A1`, `===bar===` graph                                                                                                | `goto`, `label`, `backward`, `break`                                                                                           |
  | PlantUML state               | `[*]`, `state "Name" as X { }` (composite), `<<choice>>`, `<<fork>>`, `<<join>>`, `<<start>>`, `<<end>>`, `-->`/`->` with `event [guard] / effect`, notes; descriptions warned                                                                                                                                                                                                     | concurrent regions `--`/`\|\|`, history `[H]`, `<<entryPoint>>` and other pseudostates                                         |
  | PlantUML IE entity           | `entity` blocks of `*column : type <<PK>> <<FK>> <<UK>>` and crow's foot relations (what `/export_text` writes)                                                                                                                                                                                                                                                                    |                                                                                                                                |
  | PlantUML mind map, C4        | `@startmindmap` with `*` or OrgMode `+`/`-` levels and `:multi-line;` nodes; C4-PlantUML macros as for Mermaid C4                                                                                                                                                                                                                                                                  | a second root; deployment nodes                                                                                                |
  | PlantUML, other              |                                                                                                                                                                                                                                                                                                                                                                                    | every other `@start...` and component, deployment, object and timing diagrams                                                  |
  | SQL DDL                      | `CREATE TABLE` (temporary, unlogged, `IF NOT EXISTS`, schema-qualified and quoted names) with column types and lengths, `NOT NULL`, `PRIMARY KEY`, `UNIQUE`, `REFERENCES`, table `PRIMARY KEY`/`UNIQUE`/`FOREIGN KEY`; `ALTER TABLE ... ADD COLUMN/PRIMARY KEY/FOREIGN KEY`. Indexes, sequences, grants, comments, inserts and settings are skipped and counted in `warnings`      | `CREATE VIEW`, materialized views, types, functions, procedures, triggers, domains, rules, policies; `CREATE TABLE ... LIKE`   |
  | JSON Schema                  | `$defs`/`definitions` and a root with properties as classes (or entities with `kind: "erd"`), properties with types and formats, arrays, nullable types, `$ref` as associations (or foreign keys), inline objects as classes of their own, `allOf` with one `$ref` as a generalization, string enums as enumerations                                                               | `oneOf`, `not`, `anyOf` other than one schema or null, `allOf` other than one base, `$ref` outside the document, `$dynamicRef` |

  Each foreign key of SQL DDL is an ERDRelationship from the referenced table (one, or zero or one when a key column may be null) to the referencing one (many, or zero or one when the key is unique), identifying when the key is part of the primary key.

- Layout: nodes are placed deterministically (ranked rows or columns along the edges); then Format → Layout (`engine.layoutDiagram`) arranges them with the `layout` preset, by default `flow-<direction>` (`hierarchy-<direction>` for class diagrams), so a `flowchart TD` starts at the top, except for sequence diagrams, lanes and a system boundary, which keep the computed placement. `autoLayout: false` keeps it everywhere.
- `upsert: true` updates the diagram of the same kind and name under the parent: nodes already on it (same type and name; notes by text) gain missing attributes, operations, literals and columns, changed properties and colours, missing nodes and edges are added, and the layout is left alone when nothing was added. With `prune: true` the nodes, notes and edges on the diagram that the spec lacks are deleted in the same undo step: an element shown on another diagram too, owning one the spec keeps, or owning the diagram loses only its view here; edges go first, and what a deleted owner holds goes with it.
- `reuse` (default true): on class, use case, ERD, requirement and C4 diagrams a node named like an element elsewhere in the project (same type) is that element shown again (`/create_view_of`, with its relationships to elements already shown) instead of a copy; it gains missing members, and an edge between two such elements shows their existing relationship of the same type and name. `Owner::Name` picks one by its nearest owners; one of several by plain name is the one under the diagram's owner, else a new element is made and `warnings` says so. `reuse: false` always makes new elements.

### Responses

Success is `{success: true, data}`. Failure is `{success: false, code, error, details?}`; branch on `code`, `error` is prose. Stack traces are only logged to StarUML's developer console.

| `code`                             | Status | Meaning                                                                             |
| ---------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| `INVALID_ARGUMENT`                 | 400    | Body does not match the endpoint's schema; `details` lists `{path, message}`        |
| `INVALID_JSON`, `BODY_READ_FAILED` | 400    | Body is not a JSON object                                                           |
| `UNKNOWN_TYPE`                     | 400    | Type name not in the metamodel, or no factory function for it                       |
| `NOT_FOUND`, `UNKNOWN_ENDPOINT`    | 404    | No element (of the expected kind) with that id; no such path                        |
| `METHOD_NOT_ALLOWED`               | 405    | Not `POST`                                                                          |
| `PAYLOAD_TOO_LARGE`                | 413    | Body over `mcp-ext.limits.maxBodyKiB`, or a batch over `mcp-ext.limits.maxBatchOps` |
| `NO_PROJECT`                       | 409    | No project open, or it has no file yet                                              |
| `AMBIGUOUS_REF`                    | 409    | A path or name fits several elements; `details.candidates` lists them               |
| `DUPLICATE_NAME`                   | 409    | A sibling of the same kind has the name; `details.existing` is it                   |
| `STARUML_ERROR`                    | 422    | StarUML refused, e.g. a factory precondition                                        |
| `DIALOG_REQUIRED`                  | 422    | The command would open a dialog; `details` says which                               |
| `UNSUPPORTED_SYNTAX`               | 422    | `/build_diagram` text uses a construct it does not translate; the message names it  |
| `INTERNAL`                         | 500    | Defect in the extension                                                             |

### Elements

Every endpoint that returns elements returns summaries by default: `{_id, _type, name, _parent, path}`, where `_type` is the metamodel class and `_parent` the owner id. The keys carry an underscore, as in `.mdj` files, because `id` and `type` are attribute names in the metamodel. These optional request fields change that:

| Field     | Effect                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| `summary` | `false` returns every saved attribute; references are `{$ref: id}`, never inlined                               |
| `fields`  | Return only `_id`, `_type` and these attributes (`_parent` accepted)                                            |
| `depth`   | Expand owned elements (`ownedElements`, `attributes`, `ownedViews`, ...) this many levels; default 0 = `{$ref}` |

`/find_elements` pages its matches in id order: `limit` (1–1000, default 100) and `cursor` (the previous page's `nextCursor`); `count` is the total.

## Building from source

```bash
npm install
npm run build          # bundles src/ into main.js, which is committed
npm run install:local  # copies main.js, menus/, preferences/ into StarUML's extensions folder
```

Restart StarUML (or **Debug → Reload**) to load the new build.

## Development

| Command                 | What it checks                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`     | `tsc --noEmit` over `src/` and `tests/`                                                                                                                                                                                                                                                                                                                              |
| `npm run lint`          | ESLint flat config                                                                                                                                                                                                                                                                                                                                                   |
| `npm run format:check`  | Prettier defaults                                                                                                                                                                                                                                                                                                                                                    |
| `npm run test:coverage` | Unit tests against an in-memory `app` (`tests/mock/staruml.ts`), 100% line/branch gate                                                                                                                                                                                                                                                                               |
| `npm run test:live`     | End-to-end against a running StarUML with this build installed; replaces the open project. `STARUML_LIVE_DIR` sets where `.mdj` files are written                                                                                                                                                                                                                    |
| `npm run test:load`     | 5000 read requests at concurrency 50; fails on any error, p99 over `P99_BUDGET_MS` (250) or a handler holding the renderer over `HANDLER_BUDGET_MS` (50), read from `Server-Timing`. Then `WRITE_BATCHES` (200) writing `/batch` requests, alternating atomic and not; fails when the atomic median exceeds `ATOMIC_OVERHEAD_BUDGET` (1.25) times the non-atomic one |

The mock mirrors the 7.1.1 prototypes recorded in `tests/fixtures/app-surface.7.1.1.json`; the live suite compares that fixture with `POST /debug` so the mock cannot drift from StarUML.

## License

MIT © Ezra Brilliant Konterliem
