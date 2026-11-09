import { toggle, type Profile } from "../profile";
import { CATEGORIES, HALAL_AGENCIES, KOSHER_AGENCIES, type Category } from "../reference";

interface Props {
  profile: Profile;
  onChange: (profile: Profile) => void;
  onBack: () => void;
  onErase: () => void;
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`chip ${on ? "on" : ""}`} aria-pressed={on} onClick={onClick}>
      {label}
    </button>
  );
}

function SchemeRow({
  name,
  scheme,
  agencies,
  profile,
  onChange,
}: {
  name: string;
  scheme: "kosher" | "halal";
  agencies: Category[];
  profile: Profile;
  onChange: (p: Profile) => void;
}) {
  const pref = profile[scheme];
  const accepted = agencies.filter((a) => pref.accepted.includes(a.id)).map((a) => a.label);
  return (
    <div className="setting">
      <button
        type="button"
        className="setting-row"
        role="switch"
        aria-checked={pref.on}
        onClick={() => onChange({ ...profile, [scheme]: { ...pref, on: !pref.on } })}
      >
        <span>
          {name}
          {pref.on && accepted.length > 0 && <span className="muted"> ({accepted.join(", ")})</span>}
        </span>
        <span className={`switch ${pref.on ? "on" : ""}`}>{pref.on ? "On" : "Off"}</span>
      </button>
      {pref.on && (
        <div className="sub">
          <div className="muted small">Certifiers you accept</div>
          <div className="chips">
            {agencies.map((a) => (
              <Chip
                key={a.id}
                label={a.label}
                on={pref.accepted.includes(a.id)}
                onClick={() => onChange({ ...profile, [scheme]: { ...pref, accepted: toggle(pref.accepted, a.id) } })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProfileScreen({ profile, onChange, onBack, onErase }: Props) {
  return (
    <main className="screen light">
      <header className="topbar">
        <button type="button" className="link" onClick={onBack}>
          Back
        </button>
        <span className="spacer" />
      </header>

      <h1>My restrictions</h1>
      <p className="lead">
        Sift uses these to decide each verdict. They are saved only on this device. Change them any time.
      </p>

      <h2 className="caps">Avoid</h2>
      <div className="chips">
        {CATEGORIES.map((c) => (
          <Chip
            key={c.id}
            label={c.label}
            on={profile.avoid.includes(c.id)}
            onClick={() => onChange({ ...profile, avoid: toggle(profile.avoid, c.id) })}
          />
        ))}
      </div>

      <h2 className="caps">Diets and rules</h2>
      <div className="card settings">
        <SchemeRow name="Kosher" scheme="kosher" agencies={KOSHER_AGENCIES} profile={profile} onChange={onChange} />
        <SchemeRow name="Halal" scheme="halal" agencies={HALAL_AGENCIES} profile={profile} onChange={onChange} />
      </div>

      <h2 className="caps">When Sift isn't sure</h2>
      <p className="muted small">For "may contain" warnings and doubtful ingredients.</p>
      <div className="segmented" role="radiogroup" aria-label="When Sift isn't sure">
        {(["caution", "avoid"] as const).map((policy) => (
          <button
            key={policy}
            type="button"
            role="radio"
            aria-checked={profile.doubtfulPolicy === policy}
            className={profile.doubtfulPolicy === policy ? "on" : ""}
            onClick={() => onChange({ ...profile, doubtfulPolicy: policy })}
          >
            {policy === "caution" ? "Show caution" : "Treat as avoid"}
          </button>
        ))}
      </div>

      <button type="button" className="erase" onClick={onErase}>
        Erase my data from this device
      </button>
    </main>
  );
}
