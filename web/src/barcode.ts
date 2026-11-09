/**
 * Barcode helpers. The check-digit test is Ziv's isValidBarcode from openFoodFacts.ts,
 * the same function the API uses, so the website and the Worker agree on what is valid.
 */
import { isValidBarcode } from "../../openFoodFacts";

export { isValidBarcode };

/**
 * Small US packs (cans, gum) use 8-digit UPC-E codes, whose check digit belongs to the
 * full 12-digit UPC-A. Expand them so the API receives a code it can look up.
 */
export function normalizeScannedCode(text: string, format: "UPC_E" | "OTHER"): string {
  const digits = text.replace(/\D/g, "");
  return format === "UPC_E" && digits.length === 8 ? upceToUpca(digits) : digits;
}

/** Standard UPC-E expansion: the last data digit says where the zeros go. */
export function upceToUpca(upce: string): string {
  const [ns, d1, d2, d3, d4, d5, d6, check] = upce.split("");
  let body: string;
  if (d6 === "0" || d6 === "1" || d6 === "2") body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === "3") body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === "4") body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${ns}${body}${check}`;
}

/** Typed input: keep digits only, so "3017 6204 22003" works too. */
export function cleanTypedCode(text: string): string {
  return text.replace(/\D/g, "");
}
