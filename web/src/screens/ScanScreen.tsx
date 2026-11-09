import { lazy, Suspense, useState, type FormEvent } from "react";

// The barcode library is large, so it only downloads when the user taps Scan.
const BarcodeScanner = lazy(() => import("../components/BarcodeScanner").then((m) => ({ default: m.BarcodeScanner })));

interface Props {
  busy: boolean;
  message: string | null;
  needsSetup: boolean;
  onLookup: (code: string) => void;
  onOpenProfile: () => void;
  onOpenHistory: () => void;
}

export function ScanScreen({ busy, message, needsSetup, onLookup, onOpenProfile, onOpenHistory }: Props) {
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const startScan = () => {
    setCameraError(null);
    setScanning(true);
  };

  const submitTyped = (e: FormEvent) => {
    e.preventDefault();
    if (typed.trim()) onLookup(typed);
  };

  const status = busy ? "Looking it up…" : (cameraError ?? message);

  return (
    <main className="screen dark">
      <header className="topbar">
        <span className="brand">Sift</span>
        <span className="spacer" />
        <button type="button" className="link" onClick={onOpenProfile}>
          Profile
        </button>
      </header>

      <h1>Point at a barcode</h1>
      <p className="lead">Sift checks the ingredients against your allergies, diets and restrictions.</p>

      {needsSetup && (
        <button type="button" className="setup-banner" onClick={onOpenProfile}>
          Set your restrictions first, so Sift knows what to look for →
        </button>
      )}

      <div className="viewfinder">
        <div className="frame">
          {scanning && !busy && (
            <Suspense fallback={null}>
              <BarcodeScanner
                onDetected={(code) => {
                  setScanning(false);
                  onLookup(code);
                }}
                onError={(msg) => {
                  setScanning(false);
                  setCameraError(msg);
                }}
              />
            </Suspense>
          )}
          <div className="frame-line" />
        </div>
        <p className="hint">{scanning ? "Hold the barcode inside the frame" : "Tap Scan and allow the camera"}</p>
      </div>

      <p className="status" role="status" aria-live="polite">
        {status}
      </p>

      <div className="actions">
        <button type="button" className="btn secondary" onClick={onOpenHistory}>
          History
        </button>
        {scanning ? (
          <button type="button" className="btn primary" onClick={() => setScanning(false)}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={startScan} disabled={busy}>
            Scan
          </button>
        )}
      </div>

      <form className="type-form" onSubmit={submitTyped}>
        <label htmlFor="barcode">Or type the barcode number</label>
        <div className="type-row">
          <input
            id="barcode"
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 3017620422003"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <button type="submit" className="btn small" disabled={busy || !typed.trim()}>
            Check
          </button>
        </div>
      </form>
    </main>
  );
}
