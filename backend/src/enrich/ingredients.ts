import type { IngredientNode, Statement } from "../types";

/**
 * Markers that start a "Contains" or "May contain" statement.
 * "Contains 2% or less of..." is an ingredient clause, not an allergen statement,
 * so a number or "less" right after "contains" is excluded.
 */
const MARKER =
  /\b(contains(?!\s*(?:\d|less\b))|may contain|(?:made|manufactured|processed|produced) in a facility that (?:also )?(?:processes|handles)|manufactured on equipment that (?:also )?(?:processes|handles))\s*:?\s*/gi;

const PERCENT = /(\d+(?:\.\d+)?)\s*%/;
/** "Contains 2% or less of: salt" introduces ingredients; the clause itself is not one. */
const QUANTITY_CLAUSE = /^contains\s+(?:less than\s+)?\d+(?:\.\d+)?\s*%\s*(?:or less\s*)?(?:of\s*)?:?\s*/i;
const WRAPPED = /^([^(\[]*)[(\[](.*)[)\]]\s*(.*)$/s;

/** Split on commas and semicolons that are not inside brackets. */
export function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if ((c === "," || c === ";") && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseItem(raw: string, statement: Statement): IngredientNode | null {
  let head = raw.trim().replace(QUANTITY_CLAUSE, "").replace(/[.\s]+$/, "");
  let inner = "";
  const wrapped = WRAPPED.exec(head);
  if (wrapped) {
    head = `${wrapped[1] ?? ""} ${wrapped[3] ?? ""}`.trim();
    inner = (wrapped[2] ?? "").trim();
  }

  let percent: number | null = null;
  let children: IngredientNode[] = [];

  if (/^\d+(?:\.\d+)?\s*%$/.test(inner)) {
    percent = parseFloat(inner);            // "sugar (45%)" -> a percentage, not a child
  } else if (inner) {
    children = splitTopLevel(inner)
      .map((c) => parseItem(c, statement))
      .filter((n): n is IngredientNode => n !== null);
  }

  const headPercent = PERCENT.exec(head);
  if (headPercent) {
    percent = parseFloat(headPercent[1] ?? "");
    head = head.replace(PERCENT, "").replace(/\s+/g, " ").trim();
  }
  if (!head) return null;
  return { text: head, percent, children, statement };
}

function parseSegment(text: string, statement: Statement): IngredientNode[] {
  return splitTopLevel(text)
    .map((item) => parseItem(item, statement))
    .filter((n): n is IngredientNode => n !== null);
}

/**
 * Parse an ingredient statement into a nested list.
 * Keeps percentages and separates "Contains" and "May contain" statements.
 */
export function parseIngredientStatement(input: string): IngredientNode[] {
  const text = input.replace(/^\s*ingredients\s*:?\s*/i, "").replace(/\s+/g, " ").trim();
  if (!text) return [];

  const markers = [...text.matchAll(MARKER)];
  const nodes: IngredientNode[] = [];

  const first = markers[0]?.index ?? text.length;
  nodes.push(...parseSegment(text.slice(0, first), "ingredients"));

  markers.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = markers[i + 1]?.index ?? text.length;
    const statement: Statement = m[1]?.toLowerCase().startsWith("contains") ? "contains" : "may_contain";
    nodes.push(...parseSegment(text.slice(start, end), statement));
  });

  return nodes;
}

/** Depth-first list of every node, parents before children. */
export function flattenNodes(nodes: IngredientNode[]): IngredientNode[] {
  return nodes.flatMap((n) => [n, ...flattenNodes(n.children)]);
}
