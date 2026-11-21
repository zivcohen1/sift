import type { HistoryEntry } from "../history";
import { LEVEL_TEXT } from "../ruleEngine";

interface Props {
  history: HistoryEntry[];
  favorites?: boolean;
  onBack: () => void;
  onOpen: (barcode: string) => void;
  onClear: () => void;
}

export function HistoryScreen({ history, favorites = false, onBack, onOpen, onClear }: Props) {
  return (
    <main className="screen light">
      <header className="topbar">
        <button type="button" className="link" onClick={onBack}>
          Back
        </button>
        <span className="title">{favorites ? "Favorites" : "History"}</span>
        <span className="spacer" />
      </header>

      {history.length === 0 ? (
        <p className="lead">{favorites ? "Products you favorite appear here." : "Recent scans appear here automatically, including products that could not be found."} They stay in this browser.</p>
      ) : (
        <>
          <p className="muted small">Tap a product to check it again with your current restrictions.</p>
          <ul className="list">
            {history.map((h) => (
              <li key={h.barcode}>
                <button type="button" className="history-row" onClick={() => onOpen(h.barcode)}>
                  <span>
                    <span className="row-title">{h.name ?? h.barcode}</span>
                    <span className="muted small block">
                      {h.headline} · {new Date(h.savedAt).toLocaleDateString()}
                    </span>
                  </span>
                  <span className={`tag ${h.level}`}>{LEVEL_TEXT[h.level].tag}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="erase" onClick={onClear}>
            Clear {favorites ? "favorites" : "history"}
          </button>
        </>
      )}
    </main>
  );
}
