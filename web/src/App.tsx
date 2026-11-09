import { useMemo, useState } from "react";
import { lookupBarcode } from "./api";
import { cleanTypedCode, isValidBarcode } from "./barcode";
import { addToHistory, clearHistory, loadHistory, type HistoryEntry } from "./history";
import { eraseProfile, hasRestrictions, loadProfile, saveProfile, type Profile } from "./profile";
import { decideVerdict } from "./ruleEngine";
import { HistoryScreen } from "./screens/HistoryScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { ScanScreen } from "./screens/ScanScreen";
import { headlineOf, VerdictScreen } from "./screens/VerdictScreen";
import type { ProductResponse } from "./types";

type Screen = "scan" | "verdict" | "profile" | "history";

export function App() {
  const [screen, setScreen] = useState<Screen>("scan");
  const [returnTo, setReturnTo] = useState<Screen>("scan");
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [result, setResult] = useState<ProductResponse | null>(null);
  const [savedBarcode, setSavedBarcode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // The verdict is recomputed whenever the profile changes, on this device only.
  const verdict = useMemo(() => (result ? decideVerdict(result.enriched, profile) : null), [result, profile]);

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
      setSavedBarcode(null);
      setScreen("verdict");
    } else if (res.kind === "not_found") {
      setMessage(`${code} isn't in Open Food Facts or USDA yet. Check the package yourself for now.`);
    } else if (res.kind === "invalid_barcode") {
      setMessage("That barcode didn't read correctly. Try again.");
    } else {
      setMessage(res.message);
    }
  }

  const save = () => {
    if (!result || !verdict) return;
    setHistory(
      addToHistory({
        barcode: result.barcode,
        name: result.product.name,
        brand: result.product.brand,
        level: verdict.level,
        headline: headlineOf(verdict),
        savedAt: new Date().toISOString(),
      }),
    );
    setSavedBarcode(result.barcode);
  };

  if (screen === "profile") {
    return (
      <ProfileScreen
        profile={profile}
        onChange={updateProfile}
        onBack={() => setScreen(returnTo === "profile" ? "scan" : returnTo)}
        onErase={() => {
          if (!confirm("Erase your restrictions and history from this device?")) return;
          eraseProfile();
          clearHistory();
          setProfile(loadProfile());
          setHistory([]);
        }}
      />
    );
  }

  if (screen === "history") {
    return (
      <HistoryScreen
        history={history}
        onBack={() => setScreen("scan")}
        onOpen={(barcode) => void lookup(barcode)}
        onClear={() => {
          clearHistory();
          setHistory([]);
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
        saved={savedBarcode === result.barcode}
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
    />
  );
}
