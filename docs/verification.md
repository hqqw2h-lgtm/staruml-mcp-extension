# Verification layers

Line and branch coverage proves that code ran, not that it is right. Each layer below catches what the ones before it cannot; the command, where it runs and what fails it are listed so a red build points at one layer.

| Layer                   | Command                                      | Runs                       | Fails when                                                                                                                                                       |
| ----------------------- | -------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types                   | `npm run typecheck`                          | every push (`ci.yml`)      | `tsc --noEmit` (strict) reports an error in `src/` or `tests/`                                                                                                   |
| Lint                    | `npm run lint`                               | every push                 | ESLint flat config reports an error                                                                                                                              |
| Format                  | `npm run format:check`                       | every push                 | a file differs from Prettier defaults                                                                                                                            |
| Unit tests and coverage | `npm run test:coverage`                      | every push, Node 20 and 22 | a test fails, or lines, branches, functions or statements of `src/` fall below 100 %                                                                             |
| Property-based tests    | part of the unit run                         | every push                 | fast-check finds a counterexample                                                                                                                                |
| Fuzzing                 | part of the unit run                         | every push                 | a reader or planner throws, answers a code other than the stable ones, or takes more than 250 ms on one input                                                    |
| Request contract        | part of the unit run                         | every push                 | a manifest request schema rejects a request a live run sent and StarUML answered with success                                                                    |
| Reproducible bundle     | `npm run build` then `git diff -- main.js`   | every push                 | the committed `main.js` is not what the sources build                                                                                                            |
| Mock against StarUML    | `npm run test:live` (`surface.live.test.ts`) | `live.yml`, self-hosted    | the `app` prototypes recorded in `tests/fixtures/app-surface.7.1.1.json`, which the mock mirrors, differ from `POST /debug`                                      |
| Live end-to-end         | `STARUML_LIVE=1 npm run test:live`           | `live.yml`                 | an endpoint misbehaves against the running StarUML 7.1.1, or a response breaks its manifest response schema (`tests/integration/support.ts` validates every one) |
| Manifest contract       | `introspect.live.test.ts`                    | `live.yml`                 | the live `/introspect` differs from `tests/fixtures/introspect.7.1.1.json`                                                                                       |
| MCP skill regression    | `skill.live.test.ts`                         | `live.yml`                 | an example in the staruml-mcp skill (`SKILL_PATH`) is refused, or names an endpoint that does not exist                                                          |
| Visual regression       | `visual.live.test.ts`                        | `live.yml`                 | a rendered diagram differs from `tests/visual/baselines` by perceptual hash or pixels; failures land in `tests/visual/failures/`                                 |
| Load                    | `npm run test:load`                          | `live.yml`                 | any error, read p99 over 250 ms, a handler holding the renderer over 50 ms, or atomic `/batch` median over 1.25 × non-atomic                                     |
| Soak                    | `npm run test:soak`                          | on demand                  | the last 100 of 2000 creates take 25 % longer (median) than the first 100 ([performance.md](performance.md))                                                     |
| Mutation                | `npm run test:mutation`                      | weekly (`mutation.yml`)    | Stryker kills fewer than 85 % of the mutants of `src/build`, `src/text`, `src/serialize.ts`, `src/handlers`, `src/model`, `src/quality`                          |

## Property-based tests

fast-check properties, each with its counterexample shrunk on failure:

- serializer projections and `/find_elements` paging (`tests/unit/fuzz/properties.test.ts`): a projection answers exactly `_id`, `_type` and the asked fields the element has, at the asked depth, and paging visits every match once, in id order, whatever the page size;
- path resolver (`tests/unit/refs.test.ts`, `tests/unit/paths.test.ts`): path and id round-trip for elements whose names are unique among siblings, a name unique in the project is never ambiguous, and any string answers an element or a stable error code;
- `/batch` `$name` references: each `$name` resolves to what the named operation made, at any nesting, and a name no earlier operation has is refused at that operation (that nothing is left behind is held live in `batch.live.test.ts`);
- spec → plan → batch: a class spec plans one creation per class, attribute and relation and builds exactly them;
- build → `export_text` → build: the Mermaid of a built class diagram builds a diagram with the same Mermaid, and the spec of a built data-flow diagram builds one with the same spec;
- the OO spec (`tests/unit/model/oo.test.ts`, `properties.test.ts`), style profile (`tests/unit/style/profile.test.ts`), naming and lint rules have their own.

## Fuzzing

`tests/unit/fuzz/parsers.test.ts` feeds the Mermaid, PlantUML, SQL DDL and JSON Schema readers grammar-shaped token soup and arbitrary strings, with and without a diagram kind, and every kind's planner arbitrary JSON. Each input must produce a spec or an `ApiError` with `INVALID_ARGUMENT` or `UNSUPPORTED_SYNTAX`, within 250 ms; the slowest real input reads in under 50 ms, so the budget only catches backtracking blow-ups. The OO spec and style profile parsers are fuzzed the same way in their own tests.

## Request contract

The MCP server is generated from the `/introspect` manifest, so a request schema that rejects a valid body breaks a tool. `RECORD_REQUESTS=requests.jsonl npm run test:live` appends every request the live suites send; `node scripts/request-fixtures.mjs requests.jsonl` keeps up to three successful bodies per endpoint in `tests/fixtures/requests.json`, and `tests/unit/contract.test.ts` validates each against its endpoint's schema. Every endpoint has examples except `/export_xmi` and `/import_xmi`, which need the staruml-xmi extension; their refusal is tested live.

## Mutation testing

`stryker.config.json` mutates about 24 000 sites with the Vitest runner and per-test coverage analysis, so a mutant runs only the tests that reach it. A full run takes several hours on 8 workers, hence weekly; the incremental result (`reports/stryker-incremental.json`) is cached between runs so unchanged code and tests are not retested. The HTML report is uploaded as the `mutation-report` artifact. `thresholds.break` is 85: below it the run fails.

First run (October 2026, 24 000 mutants): 87.81 % killed — `src/text` 94.94, `src/serialize.ts` 90.08, `src/model` 89.39, `src/handlers` 87.86, `src/build` 85.89, `src/quality` 83.73. The survivors cluster in what the tests read only through a score or a layout (`src/quality/loop.ts`, `src/handlers/oo.ts`, `search.ts`, `style.ts`) and in the PlantUML and SQL readers' tolerance of syntax they skip; those are where new tests buy the most.
