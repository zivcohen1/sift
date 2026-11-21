import { useMemo, useState } from "react";
import { lookupBarcode } from "./api";
import { checkIngredientData } from "./ingredientData";
import { cleanTypedCode, isValidBarcode } from "./barcode";
import { addToHistory, clearHistory, loadHistory, type HistoryEntry } from "./history";
import { addToFavorites, clearFavorites, loadFavorites } from "./favorites";
import { eraseProfile, hasRestrictions, loadProfile, saveProfile, type Profile } from "./profile";
import { decideVerdict } from "./ruleEngine";
import { HistoryScreen } from "./screens/HistoryScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { ScanScreen } from "./screens/ScanScreen";
import { headlineOf, VerdictScreen } from "./screens/VerdictScreen";
import type { ProductResponse } from "./types";

type Screen = "scan" | "verdict" | "profile" | "history" | "favorites";

export function App() {
  const [screen, setScreen] = useState<Screen>("scan");
  const [returnTo, setReturnTo] = useState<Screen>("scan");
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [result, setResult] = useState<ProductResponse | null>(null);
  const [favorites, setFavorites] = useState<HistoryEntry[]>(() => loadFavorites());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // The verdict is recomputed whenever the profile changes, on this device only.
  const verdict = useMemo(() => (result ? decideVerdict(
    result.enriched, profile, checkIngredientData(result.product, result.enriched).hasConflict,
  ) : null), [result, profile]);

  const go = (next: Screen) => {
    setReturnTo(screen);
    setScreen(next);
  };

  const updateProfile = (next: Profile) => {
    setProfile(next);
    saveProfile(next);
  };

  async function lookup(raw: string) {
    const code = cleanTypedCode(raw);
    setScreen("scan");
    if (!isValidBarcode(code)) {
      setMessage("That isn't a complete barcode. Check the digits and try again.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await lookupBarcode(code);
    setBusy(false);
    if (res.kind === "found") {
      setResult(res.data);
      const currentVerdict = decideVerdict(res.data.enriched, profile,
        checkIngredientData(res.data.product, res.data.enriched).hasConflict);
      setHistory(addToHistory({
        barcode: res.data.barcode,
        name: res.data.product.name,
        brand: res.data.product.brand,
        level: currentVerdict.level,
        headline: headlineOf(currentVerdict),
        savedAt: new Date().toISOString(),
      }));
      setScreen("verdict");
    } else if (res.kind === "not_found") {
      setMessage(`${code} isn't in Open Food Facts or USDA yet. Check the package yourself for now.`);
    } else if (res.kind === "invalid_barcode") {
      setMessage("That barcode didn't read correctly. Try again.");
    } else {
      setMessage(res.message);
    }
    if (res.kind !== "found") {
      setHistory(addToHistory({
        barcode: code,
        level: "not_sure",
        headline: res.kind === "not_found" ? "Product not found" :
          res.kind === "invalid_barcode" ? "Barcode not recognized" : "Lookup unavailable",
        savedAt: new Date().toISOString(),
      }));
    }
  }

  const save = () => {
    if (!result || !verdict) return;
    setFavorites(
      addToFavorites({
        barcode: result.barcode,
        name: result.product.name,
        brand: result.product.brand,
        level: verdict.level,
        headline: headlineOf(verdict),
        savedAt: new Date().toISOString(),
      }),
    );
  };

  if (screen === "profile") {
    return (
      <ProfileScreen
        profile={profile}
        onChange={updateProfile}
        onBack={() => setScreen(returnTo === "profile" ? "scan" : returnTo)}
        onErase={() => {
          if (!confirm("Erase your restrictions, history, and favorites from this device?")) return;
          eraseProfile();
          clearHistory();
          clearFavorites();
          setFavorites([]);
          setProfile(loadProfile());
          setHistory([]);
        }}
      />
    );
  }

  if (screen === "history" || screen === "favorites") {
    return (
      <HistoryScreen
        history={screen === "favorites" ? favorites : history}
        favorites={screen === "favorites"}
        onBack={() => setScreen("scan")}
        onOpen={(barcode) => void lookup(barcode)}
        onClear={() => {
          if (screen === "favorites") {
            clearFavorites();
            setFavorites([]);
          } else {
            clearHistory();
            setHistory([]);
          }
        }}
      />
    );
  }

  if (screen === "verdict" && result && verdict) {
    return (
      <VerdictScreen
        data={result}
        verdict={verdict}
        hasRestrictions={hasRestrictions(profile)}
        saved={favorites.some((entry) => entry.barcode === result.barcode)}
        onBack={() => setScreen("scan")}
        onSave={save}
        onOpenProfile={() => go("profile")}
      />
    );
  }

  return (
    <ScanScreen
      busy={busy}
      message={message}
      needsSetup={!hasRestrictions(profile)}
      onLookup={(code) => void lookup(code)}
      onOpenProfile={() => go("profile")}
      onOpenHistory={() => go("history")}
      onOpenFavorites={() => go("favorites")}
    />
  );
}
