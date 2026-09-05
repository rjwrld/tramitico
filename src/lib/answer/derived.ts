/** Deterministic, source-gated arithmetic for figures no corpus chunk states. */
import manifest from "../../../corpus/manifest.json";
import type { RetrievedChunk } from "../retrieval";
import { citationMarkers } from "./citations";

export interface DerivedFigureInput {
  /** Identifier used by `formula`; dotted names keep domain context readable. */
  name: string;
  /** Audited numeric value stated by the cited source. */
  value: number;
  /** Display precision when the formula is shown to the model. */
  decimals: number;
  currency?: boolean;
  docKey: string;
  articulo: string;
}

export interface DerivedFigure {
  id: string;
  label: string;
  /** Arithmetic only: named inputs, decimal literals, +, -, *, /, and (). */
  formula: string;
  /** Display precision for the result. */
  decimals: number;
  inputs: DerivedFigureInput[];
}

export interface ResolvedDerivedFigure extends DerivedFigure {
  value: number;
  formattedValue: string;
  formattedFormula: string;
  /** 1-based positions in the final chunk list; the normal citation contract. */
  citationMarkers: number[];
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)/;

type Token =
  | { type: "number"; text: string }
  | { type: "identifier"; text: string }
  | { type: "operator"; text: "+" | "-" | "*" | "/" | "(" | ")" }
  | { type: "end"; text: "" };

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let rest = formula;
  while (rest.length > 0) {
    const whitespace = rest.match(/^\s+/)?.[0];
    if (whitespace) {
      rest = rest.slice(whitespace.length);
      continue;
    }
    const number = rest.match(NUMBER)?.[0];
    if (number) {
      tokens.push({ type: "number", text: number });
      rest = rest.slice(number.length);
      continue;
    }
    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_.]*/)?.[0];
    if (identifier) {
      tokens.push({ type: "identifier", text: identifier });
      rest = rest.slice(identifier.length);
      continue;
    }
    const operator = rest[0];
    if ("+-*/()".includes(operator)) {
      tokens.push({
        type: "operator",
        text: operator as "+" | "-" | "*" | "/" | "(" | ")",
      });
      rest = rest.slice(1);
      continue;
    }
    throw new Error(`Invalid derived formula token: ${rest[0]}`);
  }
  tokens.push({ type: "end", text: "" });
  return tokens;
}

/** Evaluate the deliberately small manifest formula language without `eval`. */
export function evaluateFormula(
  formula: string,
  inputs: Readonly<Record<string, number>>,
): number {
  const tokens = tokenize(formula);
  let position = 0;
  const current = () => tokens[position];
  const take = () => tokens[position++];

  const primary = (): number => {
    const token = take();
    if (token.type === "number") return Number(token.text);
    if (token.type === "identifier") {
      if (!Object.hasOwn(inputs, token.text)) {
        throw new Error(`Unknown derived formula input: ${token.text}`);
      }
      return inputs[token.text];
    }
    if (token.type === "operator" && token.text === "(") {
      const value = expression();
      const close = take();
      if (close.type !== "operator" || close.text !== ")") {
        throw new Error("Invalid derived formula: missing closing parenthesis");
      }
      return value;
    }
    if (token.type === "operator" && token.text === "-") return -primary();
    throw new Error("Invalid derived formula: expected a number or input");
  };

  const term = (): number => {
    let value = primary();
    while (
      current().type === "operator" &&
      (current().text === "*" || current().text === "/")
    ) {
      const operator = take().text;
      const right = primary();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };

  const expression = (): number => {
    let value = term();
    while (
      current().type === "operator" &&
      (current().text === "+" || current().text === "-")
    ) {
      const operator = take().text;
      const right = term();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };

  const result = expression();
  if (current().type !== "end" || !Number.isFinite(result)) {
    throw new Error("Invalid derived formula result");
  }
  return result;
}

function formatCostaRicanNumber(value: number, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 10) {
    throw new Error(`Invalid derived figure precision: ${decimals}`);
  }
  const [integer, fraction] = value.toFixed(decimals).split(".");
  const sign = integer.startsWith("-") ? "-" : "";
  const digits = sign ? integer.slice(1) : integer;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped}${fraction === undefined ? "" : `,${fraction}`}`;
}

export function formatCostaRicanColones(
  value: number,
  decimals: number,
): string {
  return `¢${formatCostaRicanNumber(value, decimals)}`;
}

function displayInput(input: DerivedFigureInput): string {
  const formatted = formatCostaRicanNumber(input.value, input.decimals);
  return input.currency ? `¢${formatted}` : formatted;
}

function displayFormula(figure: DerivedFigure): string {
  const inputs = new Map(figure.inputs.map((input) => [input.name, input]));
  return tokenize(figure.formula)
    .filter((token) => token.type !== "end")
    .map((token) => {
      if (token.type === "identifier") {
        const input = inputs.get(token.text);
        if (!input)
          throw new Error(`Unknown derived formula input: ${token.text}`);
        return displayInput(input);
      }
      if (token.type === "operator") {
        if (token.text === "*") return "×";
        if (token.text === "/") return "÷";
        if (token.text === "-") return "−";
      }
      return token.text.replace(".", ",");
    })
    .join(" ")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validDecimals(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10;
}

/** Validate the manifest boundary before any declared arithmetic can run. */
export function parseDerivedFigures(value: unknown): DerivedFigure[] {
  if (!isRecord(value) || !Array.isArray(value.documents)) {
    throw new Error("Derived figure manifest must contain documents");
  }
  const figures: DerivedFigure[] = [];
  for (const document of value.documents) {
    if (!isRecord(document) || document.derivedFigures === undefined) continue;
    if (!Array.isArray(document.derivedFigures)) {
      throw new Error("Manifest derivedFigures must be an array");
    }
    for (const candidate of document.derivedFigures) {
      if (
        !isRecord(candidate) ||
        !nonEmptyString(candidate.id) ||
        !nonEmptyString(candidate.label) ||
        !nonEmptyString(candidate.formula) ||
        !validDecimals(candidate.decimals) ||
        !Array.isArray(candidate.inputs) ||
        candidate.inputs.length === 0
      ) {
        throw new Error("Invalid derived figure declaration");
      }
      for (const input of candidate.inputs) {
        if (
          !isRecord(input) ||
          !nonEmptyString(input.name) ||
          typeof input.value !== "number" ||
          !Number.isFinite(input.value) ||
          !validDecimals(input.decimals) ||
          !nonEmptyString(input.docKey) ||
          !nonEmptyString(input.articulo) ||
          (input.currency !== undefined && typeof input.currency !== "boolean")
        ) {
          throw new Error(
            "Each derived figure input requires a name, value, docKey and artículo",
          );
        }
      }
      figures.push(candidate as unknown as DerivedFigure);
    }
  }
  return figures;
}

export const DERIVED_FIGURES: readonly DerivedFigure[] =
  parseDerivedFigures(manifest);

/**
 * Whether this chunk is the audited source of that input — the declared
 * artículo of the declared document, never merely the right document.
 */
function statesInput(
  chunk: RetrievedChunk,
  input: DerivedFigureInput,
): boolean {
  return chunk.docKey === input.docKey && chunk.articulo === input.articulo;
}

/** Resolve figures against the exact chunks that will be numbered in the prompt. */
export function resolveDerivedFigures(
  chunks: readonly RetrievedChunk[],
  figures: readonly DerivedFigure[] = DERIVED_FIGURES,
): ResolvedDerivedFigure[] {
  return figures.flatMap((figure) => {
    const positions = figure.inputs.map((input) =>
      chunks.findIndex((chunk) => statesInput(chunk, input)),
    );
    if (positions.some((position) => position < 0)) return [];

    const values: Record<string, number> = {};
    for (const input of figure.inputs) {
      if (!IDENTIFIER.test(input.name) || Object.hasOwn(values, input.name)) {
        throw new Error(
          `Invalid or duplicate derived figure input: ${input.name}`,
        );
      }
      values[input.name] = input.value;
    }
    const value = evaluateFormula(figure.formula, values);
    return [
      {
        ...figure,
        value,
        formattedValue: formatCostaRicanColones(value, figure.decimals),
        formattedFormula: displayFormula(figure),
        citationMarkers: [
          ...new Set(positions.map((position) => position + 1)),
        ],
      },
    ];
  });
}

/**
 * Return quoted figures whose own paragraph does not carry every input marker.
 * A figure the model does not use creates no obligation; ordinary citation
 * validation still requires the rest of the answer to be cited.
 */
export function incompletelyCitedDerivedFigures(
  answer: string,
  figures: readonly ResolvedDerivedFigure[],
): string[] {
  const byValue = new Map<string, ResolvedDerivedFigure[]>();
  for (const figure of figures) {
    const group = byValue.get(figure.formattedValue) ?? [];
    group.push(figure);
    byValue.set(figure.formattedValue, group);
  }

  const incomplete = new Set<string>();
  for (const [formattedValue, group] of byValue) {
    let searchFrom = 0;
    for (;;) {
      const occurrence = answer.indexOf(formattedValue, searchFrom);
      if (occurrence < 0) break;
      const afterValue = occurrence + formattedValue.length;
      const remainder = answer.slice(afterValue);
      const boundary = remainder.search(/[.!?](?=\s|$)|\n/);
      const claim = boundary < 0 ? remainder : remainder.slice(0, boundary);
      const markers = new Set(citationMarkers(claim));

      const identified =
        group.length === 1
          ? group
          : group.filter((figure) =>
              figure.citationMarkers.some(
                (marker) =>
                  markers.has(marker) &&
                  group.every(
                    (other) =>
                      other === figure ||
                      !other.citationMarkers.includes(marker),
                  ),
              ),
            );
      const candidates = identified.length > 0 ? identified : group;
      for (const figure of candidates) {
        if (figure.citationMarkers.some((marker) => !markers.has(marker))) {
          incomplete.add(figure.id);
        }
      }
      searchFrom = afterValue;
    }
  }
  return figures.map((figure) => figure.id).filter((id) => incomplete.has(id));
}

/**
 * Complete a derived figure whose siblings survived the top-8 cut (#287).
 *
 * A figure is arithmetic over *every* one of its inputs, so losing one chunk
 * to the rerank loses the whole figure: `ccss-cuanto-pago-base` retrieved
 * `ccss-escala-ivm` «Artículo 4°, sesión 9570» and lost `salarios-minimos`
 * «Artículo 1» between the pool and the answer set, and the answer could not
 * print the IVM base at all. When at least one input is already in the answer
 * set and the missing ones are in the fused pool the reranker just read, they
 * are appended — the figure is resolvable, and the reader is owed it.
 *
 * Appending, never replacing: dropping the marginal chunk to make room could
 * un-hit a case the rerank got right, while an append can only add. Citation
 * markers are 1-based positions in the final list, so the existing numbering
 * is untouched.
 *
 * **Off by default.** #287 asked for options «to measure, not guess», and an
 * append is still a change to what the answer model reads: the check is
 * source identity, not question relevance, so a salary artículo that survived
 * an unrelated question drags its figure's siblings in with it. The append
 * cannot move a citation marker, but it can move an answer. So the pin waits
 * for the authorized run that measures it — `PIN_DERIVED_INPUTS=on` turns it
 * on for that run, and a measured result is what makes it the default.
 */
export function pinDerivedFigureInputs(
  answerSet: readonly RetrievedChunk[],
  pool: readonly RetrievedChunk[],
  figures: readonly DerivedFigure[] = DERIVED_FIGURES,
): RetrievedChunk[] {
  // Unset or interpolated empty both mean off: only an explicit
  // PIN_DERIVED_INPUTS=on opts in, which is the opposite reading rerank.ts
  // gives RERANK and deliberately so — RERANK=voyage was measured, this is
  // what the next authorized run measures.
  if (process.env.PIN_DERIVED_INPUTS !== "on") return [...answerSet];

  const pinned = [...answerSet];
  for (const figure of figures) {
    // Eligibility is judged against what the *rerank* returned, never against
    // what an earlier figure pinned: two figures can share an input, and
    // reading `pinned` here would let figure [A, B] pull in B and figure
    // [B, C] then ride on it — pinning C for a figure the rerank never
    // reached at all. One append may not become a chain.
    const survived = figure.inputs.some((input) =>
      answerSet.some((chunk) => statesInput(chunk, input)),
    );
    // Nothing present: not this question's figure, and pinning every half
    // would invent a claim.
    if (!survived) continue;

    // `pinned`, not `answerSet`: a shared input another figure already
    // appended is present, and appending it twice is the one thing this must
    // not do.
    const missing = figure.inputs.filter(
      (input) => !pinned.some((chunk) => statesInput(chunk, input)),
    );
    if (missing.length === 0) continue;

    const found = missing.map((input) =>
      pool.find((chunk) => statesInput(chunk, input)),
    );
    if (found.some((chunk) => chunk === undefined)) continue;
    for (const chunk of found) {
      if (chunk !== undefined && !pinned.includes(chunk)) pinned.push(chunk);
    }
  }
  return pinned;
}
