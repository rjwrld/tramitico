/** Deterministic, source-gated arithmetic for figures no corpus chunk states. */
import manifest from "../../../corpus/manifest.json";
import type { RetrievedChunk } from "../retrieval";

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
        !Number.isInteger(candidate.decimals) ||
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
          !Number.isInteger(input.decimals) ||
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

/** Resolve figures against the exact chunks that will be numbered in the prompt. */
export function resolveDerivedFigures(
  chunks: readonly RetrievedChunk[],
  figures: readonly DerivedFigure[] = DERIVED_FIGURES,
): ResolvedDerivedFigure[] {
  return figures.flatMap((figure) => {
    const positions = figure.inputs.map((input) =>
      chunks.findIndex(
        (chunk) =>
          chunk.docKey === input.docKey && chunk.articulo === input.articulo,
      ),
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
  const paragraphs = answer.split(/\n+/);
  return figures
    .filter((figure) =>
      paragraphs
        .filter((paragraph) => paragraph.includes(figure.formattedValue))
        .some((paragraph) => {
          const afterFigure = paragraph.slice(
            paragraph.indexOf(figure.formattedValue) +
              figure.formattedValue.length,
          );
          return figure.citationMarkers.some(
            (marker) => !afterFigure.includes(`[${marker}]`),
          );
        }),
    )
    .map((figure) => figure.id);
}
