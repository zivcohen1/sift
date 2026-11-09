/**
 * Reference lists the website shows in "My restrictions".
 *
 * Categories come straight from the backend's knowledge base, so the website always offers
 * exactly the categories the API can detect. Add a category there and it appears here.
 */
import categoriesJson from "../../backend/data/categories.json";

export interface Category {
  id: string;
  label: string;
}

export const CATEGORIES: Category[] = categoriesJson.map(({ id, label }) => ({ id, label }));

export function categoryLabel(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id.replace(/_/g, " ");
}

/** Agencies the API recognises (backend/src/enrich/fromSource.ts). Keep the ids in sync. */
export const KOSHER_AGENCIES: Category[] = [
  { id: "ou", label: "OU" },
  { id: "ok", label: "OK" },
  { id: "star-k", label: "Star-K" },
  { id: "kof-k", label: "Kof-K" },
  { id: "crc", label: "cRc" },
];

export const HALAL_AGENCIES: Category[] = [{ id: "ifanca", label: "IFANCA" }];
