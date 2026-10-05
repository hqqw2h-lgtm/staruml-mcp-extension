/*
 * Copyright (c) 2026 Ezra Brilliant Konterliem
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

import * as z from "zod/mini";
import { ApiError } from "../errors.js";
import abstractFactory from "./library/abstract-factory.json";
import adapter from "./library/adapter.json";
import bridge from "./library/bridge.json";
import builder from "./library/builder.json";
import chainOfResponsibility from "./library/chain-of-responsibility.json";
import command from "./library/command.json";
import composite from "./library/composite.json";
import decorator from "./library/decorator.json";
import dto from "./library/dto.json";
import entity from "./library/entity.json";
import facade from "./library/facade.json";
import factoryMethod from "./library/factory-method.json";
import flyweight from "./library/flyweight.json";
import interpreter from "./library/interpreter.json";
import iterator from "./library/iterator.json";
import mediator from "./library/mediator.json";
import memento from "./library/memento.json";
import observer from "./library/observer.json";
import prototype from "./library/prototype.json";
import proxy from "./library/proxy.json";
import repository from "./library/repository.json";
import service from "./library/service.json";
import singleton from "./library/singleton.json";
import specification from "./library/specification.json";
import state from "./library/state.json";
import strategy from "./library/strategy.json";
import templateMethod from "./library/template-method.json";
import unitOfWork from "./library/unit-of-work.json";
import valueObject from "./library/value-object.json";
import visitor from "./library/visitor.json";
import { type Pattern, patternSchema } from "./schema.js";

/** The pattern files in library order: GoF by category, then domain patterns. */
export const PATTERN_FILES: readonly unknown[] = [
  abstractFactory,
  builder,
  factoryMethod,
  prototype,
  singleton,
  adapter,
  bridge,
  composite,
  decorator,
  facade,
  flyweight,
  proxy,
  chainOfResponsibility,
  command,
  interpreter,
  iterator,
  mediator,
  memento,
  observer,
  state,
  strategy,
  templateMethod,
  visitor,
  repository,
  unitOfWork,
  specification,
  valueObject,
  entity,
  service,
  dto,
];

let library: Pattern[] | null = null;

/** Every pattern, checked against the schema on first use. */
export function patterns(): Pattern[] {
  library ??= PATTERN_FILES.map((data) => z.parse(patternSchema(), data));
  return library;
}

/** Names compare without case, spaces or hyphens: "factory-method" is Factory Method. */
const key = (text: string) => text.toLowerCase().replace(/[\s_-]+/g, "");

export function findPattern(name: string): Pattern {
  const found = patterns().find((p) => key(p.name) === key(name));
  if (!found) {
    throw new ApiError(
      "NOT_FOUND",
      `No pattern ${name}; /list_patterns lists ${patterns().length}`,
    );
  }
  return found;
}

/** The pattern with a variant's roles and relationships in place of its own. */
export function withVariant(
  pattern: Pattern,
  variant: string | undefined,
): Pattern {
  if (variant === undefined) return pattern;
  const v = pattern.variants?.[variant];
  if (!v) {
    const known = Object.keys(pattern.variants ?? {});
    throw new ApiError(
      "INVALID_ARGUMENT",
      `variant: ${pattern.name} has ${known.length > 0 ? `the variants ${known.join(", ")}` : "no variants"}, not ${variant}`,
    );
  }
  return {
    ...pattern,
    roles: pattern.roles.map((r) => ({ ...r, ...v.roles?.[r.name] })),
    relationships: v.relationships ?? pattern.relationships,
  };
}
