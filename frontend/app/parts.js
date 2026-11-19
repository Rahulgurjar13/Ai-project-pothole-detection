/*
  parts.js  -  small building blocks used on every page
  =====================================================
  Icons, coloured chips, number cards, the road-score ring, bars,
  the repair plan card, the AI settings card and messages.
*/

export const LEVELS = ["Low", "Medium", "High", "Critical"];   // least -> most dangerous
const LEVEL_COLOR = { Low: "green", Medium: "amber", High: "orange", Critical: "red" };
const STATUS_COLOR = { Open: "red", Scheduled: "amber", Repaired: "green" };
const CSS = { green: "var(--green)", amber: "var(--amber)", orange: "var(--orange)", red: "var(--red)" };

// Road score -> name and advice (same rules as backend/config.py).
const CONDITIONS = [
  [85, "Excellent", "Smooth road. No repair needed."],
  [70, "Good", "Small wear. Check again later."],
  [50, "Fair", "Visible damage. Plan a repair."],
  [30, "Poor", "A lot of damage. Repair soon."],
  [0, "Dangerous", "Unsafe road. Repair right away."],
];
export const conditionFor = (score) => CONDITIONS.find(([min]) => score >= min);
export const scoreColor = (score) => (score >= 70 ? "green" : score >= 50 ? "amber" : "red");

// Small helpers for text
export const money = (amount, currency = "₹") => currency + Math.round(amount || 0).toLocaleString("en-IN");
export const inspectionId = (id) => (id ? `INS-${String(id).padStart(4, "0")}` : "–");

// ---------------------------------------------------------------
// Icons (simple line drawings). Use: <Icon name="camera" />
// ---------------------------------------------------------------
const ICONS = {
  overview: "M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z",
  photo: "M4 7h3l2-3h6l2 3h3v13H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  video: "M3 6h12v12H3zM15 10l6-4v12l-6-4",
  camera: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  compare: "M3 3h7v18H3zM14 3h7v18h-7z",
  book: "M4 4h11a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4zM4 16a4 4 0 0 1 4-4h11",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  money: "M3 7h18v13H3zM16 13.5h2M3 7l3-4h12l3 4",
  check: "M20 6 9 17l-5-5",
  road: "M7 21 10 3M17 21 14 3M12 7v2M12 13v2M12 19v1",
  trash: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14",
  download: "M12 4v12M7 11l5 5 5-5M4 20h16",
  print: "M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z",
  plus: "M12 5v14M5 12h14",
};
export function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  );
}

// ---------------------------------------------------------------
// Coloured labels
// ---------------------------------------------------------------
export const Chip = ({ color, children }) => <span className={`chip ${color}`}>{children}</span>;
export const LevelChip = ({ level }) => (level && level !== "None" ? <Chip color={LEVEL_COLOR[level]}>{level}</Chip> : <Chip color="gray">None</Chip>);
export const StatusChip = ({ status }) => <Chip color={STATUS_COLOR[status] || "gray"}>{status}</Chip>;

export function SectionTitle({ title, note, children }) {
  return <div className="section-title"><h2>{title}</h2>{children || (note && <span>{note}</span>)}</div>;
}

// Big number card with an icon. color: blue / red / amber / green
export function Kpi({ icon, color, label, value, note }) {
  return (
    <div className="card kpi">
      <div className={`kpi-icon ${color}`}><Icon name={icon} /></div>
      <div><span className="label">{label}</span><b>{value}</b><small>{note}</small></div>
    </div>
  );
}

// ---------------------------------------------------------------
// Road score ring + summary card
// ---------------------------------------------------------------
export function ScoreRing({ score }) {
  const radius = 50;
  const length = 2 * Math.PI * radius;                      // full circle
  return (
    <div className="ring">
      <svg width="116" height="116">
        <circle cx="58" cy="58" r={radius} fill="none" stroke="var(--gray-bg)" strokeWidth="10" />
        <circle cx="58" cy="58" r={radius} fill="none" stroke={CSS[scoreColor(score)]} strokeWidth="10" strokeLinecap="round"
                strokeDasharray={length} strokeDashoffset={length * (1 - score / 100)} style={{ transition: "stroke-dashoffset 0.5s" }} />
      </svg>
      <div className="ring-text"><b>{score}</b><span>of 100</span></div>
    </div>
  );
}

// stats = [{ label, value }]
export function Summary({ score, stats }) {
  const [, condition, advice] = conditionFor(score);
  return (
    <div className="card summary">
      <ScoreRing score={score} />
      <div>
        <span className="label">Road condition index</span>
        <div className="verdict"><h2>{condition}</h2><Chip color={scoreColor(score)}>{score}/100</Chip></div>
        <p className="advice">{advice}</p>
        <div className="stats">
          {stats.map((s) => <div className="stat" key={s.label}><span className="label">{s.label}</span><b>{s.value}</b></div>)}
        </div>
      </div>
    </div>
  );
}

// Potholes per severity level, as coloured bars.
export function LevelBars({ counts }) {
  const most = Math.max(...Object.values(counts), 1);
  return (
    <div className="levels">
      {[...LEVELS].reverse().map((level) => (
        <div className="level-row" key={level}>
          <span>{level}</span>
          <div className="bar"><i style={{ width: `${(100 * counts[level]) / most}%`, background: CSS[LEVEL_COLOR[level]] }} /></div>
          <b>{counts[level]}</b>
        </div>
      ))}
    </div>
  );
}

// Thin bar with a number, used in tables.
export const CellBar = ({ percent, text }) => (
  <div className="cell-bar"><div className="bar"><i style={{ width: `${percent}%` }} /></div><span>{text}</span></div>
);

// ---------------------------------------------------------------
// Repair plan card (estimates from backend/config.py, section 6)
// ---------------------------------------------------------------
export function RepairPlan({ plan }) {
  if (!plan) return null;
  const urgent = plan.start_within.includes("24") ? "red" : plan.start_within.includes("7") ? "orange" : "green";
  return (
    <div className="card pad">
      <div className="card-head"><h3>Repair estimate</h3><Chip color={urgent}>{plan.start_within}</Chip></div>
      <div className="plan">
        <div><span>Estimated cost</span><b>{money(plan.total_cost, plan.currency)}</b></div>
        <div><span>Road surface</span><b>{plan.total_area_m2} m²</b></div>
        <div><span>Asphalt (cold mix)</span><b>{plan.asphalt_kg} kg</b></div>
        <div><span>Crew time</span><b>{plan.crew_hours} h</b></div>
      </div>
      <p className="help">Estimate. Assumes one photo shows about 20 m² of road; rates are set in config.py.</p>
    </div>
  );
}

// ---------------------------------------------------------------
// AI settings card. show = ["engine", "sensitivity", "confidence"]
// ---------------------------------------------------------------
export function SettingsCard({ info, settings, change, show, title = "AI settings", children }) {
  const { engine, sensitivity, confidence } = settings;
  const pickSensitivity = (name) =>   // a preset sets the confidence AND the grass/paint check together
    change({ sensitivity: name, confidence: info.sensitivity[name].confidence, roadCheck: info.sensitivity[name].road_check });

  return (
    <div className="card pad">
      <div className="card-head"><h3>{title}</h3></div>
      {show.includes("engine") && info && (
        <div className="setting">
          <span className="label">Detection engine</span>
          <select className="select" value={engine} onChange={(e) => change({ engine: e.target.value })}>
            {info.engines.map((e) => <option key={e.name}>{e.name}</option>)}
          </select>
          <p className="help">{info.engines.find((e) => e.name === engine)?.about}</p>
        </div>
      )}
      {show.includes("sensitivity") && info && (
        <div className="setting">
          <span className="label">Sensitivity</span>
          <div className="segmented">
            {Object.keys(info.sensitivity).map((name) => (
              <button key={name} className={sensitivity === name ? "on" : ""} onClick={() => pickSensitivity(name)}>{name}</button>
            ))}
          </div>
          <p className="help">{sensitivity === "High" ? "Finds faint, far-away potholes. Ignores grass and lane paint." : "Only the potholes the AI is most sure about."}</p>
        </div>
      )}
      {show.includes("confidence") && (
        <div className="setting">
          <span className="label">Minimum confidence</span>
          <div className="slider">
            <input type="range" min="0.10" max="0.90" step="0.05" value={confidence} onChange={(e) => change({ confidence: Number(e.target.value) })} />
            <b>{Math.round(confidence * 100)}%</b>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------
// Messages
// ---------------------------------------------------------------
export const Loading = ({ text }) => <div className="loading"><div className="spinner" />{text}</div>;
export const ErrorBox = ({ text }) => <div className="error">{text}</div>;
export const Empty = ({ title, text, children }) => <div className="card empty"><b>{title}</b>{text}{children}</div>;
