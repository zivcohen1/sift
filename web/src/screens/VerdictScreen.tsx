import { ingredientTag, LEVEL_TEXT, type Verdict } from "../ruleEngine";
import type { ProductResponse } from "../types";
import { checkIngredientData } from "../ingredientData";
import { allergenLabel } from "../../../backend/src/enrich/quality";

interface Props {
  data: ProductResponse;
  verdict: Verdict;
  hasRestrictions: boolean;
  saved: boolean;
  onBack: () => void;
  onSave: () => void;
  onOpenProfile: () => void;
}

const SOURCE_NAMES: Record<string, string> = { open_food_facts: "Open Food Facts", usda: "USDA FoodData Central" };

export function headlineOf(verdict: Verdict): string {
  return verdict.level === "good"
    ? LEVEL_TEXT.good.fallbackHeadline
    : (verdict.findings[0]?.title ?? LEVEL_TEXT[verdict.level].fallbackHeadline);
}

export function VerdictScreen({ data, verdict, hasRestrictions, saved, onBack, onSave, onOpenProfile }: Props) {
  const { product, enriched } = data;
  const top = verdict.findings[0];
  const others = verdict.level === "good" ? verdict.findings : verdict.findings.slice(1);
  const sources = data.sources.map((s) => SOURCE_NAMES[s] ?? s).join(" and ");
  const quality = checkIngredientData(product, enriched);

  return (
    <main className="screen light">
      <header className="topbar">
        <button type="button" className="link" onClick={onBack}>
          Back
        </button>
        <span className="title">Verdict</span>
        <span className="spacer" />
      </header>

      <div className="product">
        {product.imageUrl && <img src={product.imageUrl} alt="" width={56} height={56} />}
        <div>
          <div className="product-name">{product.name ?? "Unnamed product"}</div>
          <div className="muted">{[product.brand, data.barcode].filter(Boolean).join(" · ")}</div>
        </div>
      </div>

      <section className={`card verdict ${verdict.level}`} aria-live="polite">
        <div className="eyebrow">{LEVEL_TEXT[verdict.level].eyebrow}</div>
        <h1>{headlineOf(verdict)}</h1>
        {verdict.level !== "good" && top && <p>{top.detail}</p>}
        {!hasRestrictions && (
          <p>
            You haven't set any restrictions, so nothing can conflict yet.{" "}
            <button type="button" className="inline-link" onClick={onOpenProfile}>
              Set them now
            </button>
          </p>
        )}
      </section>

      {others.length > 0 && (
        <>
          <h2>{verdict.level === "good" ? "Checked" : "Also found"}</h2>
          <ul className="list">
            {others.map((f) => (
              <li key={f.title + f.detail}>
                <div>
                  <div className="row-title">{f.title}</div>
                  <div className="muted">{f.detail}</div>
                </div>
                <span className={`tag ${f.level}`}>{LEVEL_TEXT[f.level].tag}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {quality.hasConflict && (
        <section className="card" aria-label="Ingredient data warning">
          <h2>Check the full package label</h2>
          <p>The database's ingredient list may be incomplete or inconsistent with its allergen declarations.
            {quality.unlistedAllergens.length > 0 && ` Allergens not accounted for in the list: ${quality.unlistedAllergens.join(", ")}.`}
            {" "}Sift cannot verify that this is the full recipe.</p>
        </section>
      )}

      {(product.allergenTags?.length ?? 0) > 0 && (
        <section aria-label="Declared allergens">
          <h2>Declared allergens</h2>
          <p>{product.allergenTags!.map(allergenLabel).join(", ")}</p>
          <p className="muted small">Reported separately by the database. Check the package's allergen statement.</p>
        </section>
      )}

      {enriched.facts.ingredients.length > 0 && (
        <>
          <h2>Ingredients reported by the database</h2>
          <ul className="list">
            {enriched.facts.ingredients.map((ingredient, i) => {
              const tag = ingredientTag(ingredient, verdict);
              return (
                <li key={`${ingredient}-${i}`}>
                  <span className="row-title">{ingredient}</span>
                  <span className={`tag ${tag.level}`}>{tag.text}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="footnote">
        Data from {sources || "Sift's databases"}
        {enriched.warnings.includes("crowd_sourced_check_the_package") && ", which is crowd-sourced"}. Always check the
        package. Sift is not medical or religious advice.
      </p>

      <div className="bottom-bar">
        <button type="button" className="btn dark-btn" onClick={onSave} disabled={saved}>
          {saved ? "Added to favorites" : "Add to favorites"}
        </button>
      </div>
    </main>
  );
}
