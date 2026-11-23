/**
 * Reference lists the website shows in "My restrictions".
 *
 * Categories come straight from the backend's knowledge base, so the website always offers
 * exactly the categories the API can detect. Add a category there and it appears here.
 */
import categoriesJson from "../../backend/data/categories.json";

export type CategoryGroup = "allergen" | "medical" | "diet" | "religious";

export interface Category {
  id: string;
  label: string;
  group?: CategoryGroup;
}

export const CATEGORIES: Category[] = (categoriesJson as Array<{ id: string; label: string; group?: CategoryGroup }>).map(
  ({ id, label, group }) => ({ id, label, group }),
);

/** Section headings for the "Avoid" chips, in display order. */
export const CATEGORY_GROUPS: Array<{ id: CategoryGroup; label: string }> = [
  { id: "allergen", label: "Allergens" },
  { id: "medical", label: "Medical" },
  { id: "diet", label: "Diet" },
  { id: "religious", label: "Religious" },
];

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
