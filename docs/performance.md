# Write-path performance (issue #26)

Measured on StarUML 7.1.1 (macOS, Apple silicon), times are the handler span the server reports in `Server-Timing` (the time StarUML's renderer thread was held), medians unless noted.

## The symptom

A create cost ~10 ms after a restart and grew over a session: ~150 ms at 600 classes, 90–130 ms after a long session even on an empty project, and builds of a few classes took 3–5 s (phase 1B/1C reports). `scripts/soak-test.mjs` reproduces it: 2000 cycles of creating a class with its view and deleting it again, so the model stays at three elements and any growth is the session's.

## The cause

StarUML handles every created model in `app-context.js` `setupRepository`: the `created` listener adds it to the model explorer and selects it (`modelExplorer.select(elem, true)`, which also scrolls with a 500 ms jQuery animation), the selection reaches the property and documentation editors and every extension's `updateMenus` (fifteen `operationExecuted` listeners in 7.1.1), and each operation repaints the current diagram when `needRepaint` finds what changed.

Each step was switched off in turn (`/performance_stats` reads the counts that could grow):

| Run (create-and-delete cycles)                                | Create p50, first 100 | Create p50, last 100 |
| ------------------------------------------------------------- | --------------------- | -------------------- |
| with the selection: 2000 classes with views, fresh restart    | 15.2 ms               | 75.1 ms              |
| with the selection: 600 model-only classes, late in a session | 76.5 ms               | 95.9 ms              |
| without the selection: 600 model-only classes, fresh restart  | 4.9 ms                | 3.1 ms               |
| without the selection: the same again, in the same session    | 3.2 ms                | 3.2 ms               |

Repository listeners stayed constant (15 on `operationExecuted`), the undo stack is capped at 100 operations (`MAX_STACK_SIZE` in `core/repository.js`), the repository is cleared with the project, and the extension registers no listener that outlives a request (`oneStep`, `record` and the quality loop remove theirs in `finally`). The growth is the selection: every selection change costs a little more than the one before for the rest of the session, which is why a new project does not reset it. Where in StarUML's UI it accumulates (the Kendo tree's selection, the property editor or the menu updates) is not visible from an extension.

## The mitigation

Every request that writes runs quietly (`src/quiet.ts`, applied to all non-read-only routes; `/batch`, `/build_diagram`, `/build_model`, `/derive_diagrams` and `/apply_pattern` run their inner endpoints inside the same quiet request):

- The model explorer's `select` is held back: nothing is selected, or with the new preference `mcp-ext.ui.selectCreated` (off by default) only the request's last created element, without the scroll animation. Animations queued before are dropped.
- Repaint is left as StarUML does it. Suspending it (`app.diagrams.suspendRepaint()` around the request, one repaint at its end) was measured and dropped: StarUML fits views to their content and routes edges while painting (`View.arrange`, `core/core.js`), the engine layout and the quality loop that follow each build read that geometry, and with repaint suspended the visual-regression baselines shifted and a derived mind map scored 77 instead of 82 or more, even with a paint before every measurement.
- `/introspect` caches its factory, metamodel and toolbox sections while the registries are the ones the extensions filled at start-up; `/search_types` already kept its index on the same key. The folder scans of `/list_extensions` and `/list_templates` are kept per set of roots.

## Before and after

`scripts/soak-test.mjs` (2000 creates, each deleted again; growth is the last 100 creates' median against the first 100's, budget 25 %):

| Build              | Session                        | Create p50, ops 1–100 | Create p50, ops 1901–2000 | Create p99, last 100 | Delete p50 | Growth           |
| ------------------ | ------------------------------ | --------------------- | ------------------------- | -------------------- | ---------- | ---------------- |
| before (`9e61546`) | after a long live-test session | 228.5 ms              | 282.4 ms                  | 433.7 ms             | 3.2 ms     | +23.6 %          |
| before (`9e61546`) | fresh restart                  | 15.2 ms               | 75.1 ms                   | 104.5 ms             | 3.2 ms     | +394.7 % (fails) |
| after              | fresh restart                  | 4.4 ms                | 4.7 ms                    | 5.7 ms               | 3.4 ms     | +5.0 %           |

`/performance_stats` after the run: 15 `operationExecuted` listeners (as before it), undo depth 100, 3 elements, 0 queued explorer animations, heap 44.6 MiB (76.1 MiB after the same run with the selection).

`/build_diagram`, median of three builds of each golden case, fresh and after a session of create-and-delete cycles (1000 for the old build, the 2000 of the soak run for the new one):

| Case                               | Before, fresh | Before, after the cycles | After, fresh | After, after the cycles |
| ---------------------------------- | ------------- | ------------------------ | ------------ | ----------------------- |
| `p-class` (9 classes, 7 relations) | 1296 ms       | 1539 ms                  | 359 ms       | 335 ms                  |
| `m-class`                          | 283 ms        | 886 ms                   | 97 ms        | 100 ms                  |
| `p-activity` (16 nodes)            | 811 ms        | 2646 ms                  | 264 ms       | 272 ms                  |
| `component`                        | 616 ms        | 1293 ms                  | 260 ms       | 234 ms                  |
| `f-bpmn`                           | 376 ms        | 922 ms                   | 128 ms       | 140 ms                  |

## What remains StarUML's own

- The selection cost itself: selecting in the UI (or with `mcp-ext.ui.selectCreated` on) still grows the cost of the next selection for the rest of the session. Restarting StarUML resets it.
- Every operation still repaints the current diagram when it shows what changed, and runs StarUML's own `operationExecuted` listeners, among them fifteen extensions' `updateMenus`, and the model explorer still inserts a tree node per created model, sorted among its siblings (`model-explorer-view.js add`), so a create in a package of n elements costs O(n log n) there.
- A merged undo step of a large build holds every operation of the build; StarUML keeps the last 100 steps.
