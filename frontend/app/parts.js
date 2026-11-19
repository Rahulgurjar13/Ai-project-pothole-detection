/*
  parts.js  -  small building blocks used on every page
  =====================================================
  Icons, coloured chips, number cards, the road-score ring, bars,
  the repair plan card, the AI settings card and messages.

  Words used in the notes below:
    component = a reusable piece of the page (a function that returns HTML-like JSX)
    JSX       = HTML-like code written inside JavaScript (React turns it into real page elements)
    props     = the values given to a component, like <Chip color="red"> gives color = "red"
    export    = lets other files import (use) this thing
    =>        = an "arrow function": a short way to write a function
    SVG       = a picture drawn with code (lines, circles, paths) instead of an image file
    .map      = do this for every item in the list, and collect the results
    className = the CSS class of an element (decides its style in globals.css)
*/

export const LEVELS = ["Low", "Medium", "High", "Critical"];   // least -> most dangerous (exported so other files can use the list)
const LEVEL_COLOR = { Low: "green", Medium: "amber", High: "orange", Critical: "red" };   // which colour each severity level gets
const STATUS_COLOR = { Open: "red", Scheduled: "amber", Repaired: "green" };   // which colour each repair status gets
const CSS = { green: "var(--green)", amber: "var(--amber)", orange: "var(--orange)", red: "var(--red)" };   // colour name -> real CSS colour from globals.css

// Road score -> name and advice (same rules as backend/config.py).
// Each row is [lowest score for this row, condition name, advice text]. Rows go from best to worst.
const CONDITIONS = [
  [85, "Excellent", "Smooth road. No repair needed."],   // score 85 or more
  [70, "Good", "Small wear. Check again later."],         // score 70 to 84
  [50, "Fair", "Visible damage. Plan a repair."],         // score 50 to 69
  [30, "Poor", "A lot of damage. Repair soon."],          // score 30 to 49
  [0, "Dangerous", "Unsafe road. Repair right away."],    // score below 30
];   // end of the list
// conditionFor: takes a score, returns the first row whose minimum the score reaches, e.g. 72 -> [70, "Good", "..."]
export const conditionFor = (score) => CONDITIONS.find(([min]) => score >= min);   // .find = give the first item that matches
// scoreColor: takes a score, returns "green" (70+), "amber" (50-69) or "red" (below 50). "? :" means "if ... then ... else".
export const scoreColor = (score) => (score >= 70 ? "green" : score >= 50 ? "amber" : "red");

// Small helpers for text
// money: takes a number and a currency sign (₹ if none given), returns text like "₹1,25,000" (Indian comma style). "|| 0" uses 0 if amount is empty.
export const money = (amount, currency = "₹") => currency + Math.round(amount || 0).toLocaleString("en-IN");
// inspectionId: takes a number id, returns text like "INS-0007" (padStart adds zeros in front to make 4 digits). No id -> "–".
export const inspectionId = (id) => (id ? `INS-${String(id).padStart(4, "0")}` : "–");

// ---------------------------------------------------------------
// Icons (simple line drawings). Use: <Icon name="camera" />
// Each text below is an SVG "path": drawing instructions for the pen
// (M = move to a point, L/H/V = draw a line, a/A = draw a curve, z = close the shape).
// ---------------------------------------------------------------
const ICONS = {   // icon name -> its drawing instructions
  overview: "M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z",   // overview: four boxes (a dashboard)
  photo: "M4 7h3l2-3h6l2 3h3v13H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",   // photo: a photo camera body with a round lens
  video: "M3 6h12v12H3zM15 10l6-4v12l-6-4",   // video: a video camera (box + triangle)
  camera: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z",   // camera: an eye shape (used for the live camera)
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",   // list: three lines with dots (a list)
  compare: "M3 3h7v18H3zM14 3h7v18h-7z",   // compare: two tall boxes side by side
  book: "M4 4h11a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4zM4 16a4 4 0 0 1 4-4h11",   // book: an open book
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",   // upload: an arrow pointing up over a line
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",   // alert: a warning triangle with "!"
  money: "M3 7h18v13H3zM16 13.5h2M3 7l3-4h12l3 4",   // money: a wallet
  check: "M20 6 9 17l-5-5",   // check: a tick mark
  road: "M7 21 10 3M17 21 14 3M12 7v2M12 13v2M12 19v1",   // road: two road edges with a dashed centre line
  trash: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14",   // trash: a dustbin (for delete)
  download: "M12 4v12M7 11l5 5 5-5M4 20h16",   // download: an arrow pointing down over a line
  print: "M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z",   // print: a printer
  plus: "M12 5v14M5 12h14",   // plus: a "+" sign
};   // end of ICONS
// Icon component: draws one small icon.
// In (props): name = which icon from ICONS, size = width/height in pixels (18 if not given).
// Out: an <svg> picture. stroke="currentColor" means it uses the same colour as the text around it.
export function Icon({ name, size = 18 }) {   // { name, size } takes these two values out of the props
  // return the SVG: a 24x24 drawing area (viewBox), no fill, 2px round-ended lines; <path d=...> draws the chosen icon
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {/* path = the shape to draw; d = the drawing instructions looked up from ICONS by name */}
      <path d={ICONS[name]} />
    </svg>
  );   // end of return
}   // end of Icon

// ---------------------------------------------------------------
// Coloured labels
// ---------------------------------------------------------------
// Chip component: a small rounded coloured label (a "pill").
// In: color = class name like "green"/"red", children = whatever is written between <Chip> and </Chip>.
// Out: a <span> with class "chip green" (etc.) so globals.css colours it.
export const Chip = ({ color, children }) => <span className={`chip ${color}`}>{children}</span>;
// LevelChip: shows a severity level (Low/Medium/High/Critical) in its colour.
// In: level. If there is a level and it is not "None" -> coloured chip; otherwise a gray "None" chip.
export const LevelChip = ({ level }) => (level && level !== "None" ? <Chip color={LEVEL_COLOR[level]}>{level}</Chip> : <Chip color="gray">None</Chip>);
// StatusChip: shows a repair status (Open/Scheduled/Repaired) in its colour; unknown status -> gray.
export const StatusChip = ({ status }) => <Chip color={STATUS_COLOR[status] || "gray"}>{status}</Chip>;

// SectionTitle component: a heading for a part of the page.
// In: title = heading text, note = small grey text (optional), children = extra things like a button (optional).
// Out: a <div> with an <h2> title, then the children if given, otherwise the note (only if there is a note).
export function SectionTitle({ title, note, children }) {   // takes the three props
  // "a || b" = use a if it exists, else b. "note && <span>" = show the span only if note exists.
  return <div className="section-title"><h2>{title}</h2>{children || (note && <span>{note}</span>)}</div>;
}   // end of SectionTitle

// Big number card with an icon. color: blue / red / amber / green
// Kpi component (KPI = "key performance indicator", an important number).
// In: icon = icon name, color = colour of the icon box, label = small title, value = the big number, note = small text under it.
// Out: a card showing the icon on the left and the label, number and note on the right.
export function Kpi({ icon, color, label, value, note }) {   // takes the five props
  return (   // give back this JSX
    <div className="card kpi">
      {/* coloured square with the icon inside */}
      <div className={`kpi-icon ${color}`}><Icon name={icon} /></div>
      {/* the text part: label, big bold number (<b>), small note (<small>) */}
      <div><span className="label">{label}</span><b>{value}</b><small>{note}</small></div>
    </div>
  );   // end of return
}   // end of Kpi

// ---------------------------------------------------------------
// Road score ring + summary card
// ---------------------------------------------------------------
// ScoreRing component: a circle that is filled part-way, like a progress ring (e.g. 70/100 fills 70% of the circle).
// In: score (0 to 100). Out: an SVG ring with the score written in the middle.
export function ScoreRing({ score }) {   // takes the score prop
  const radius = 50;   // size of the circle (distance from centre to edge) in pixels
  const length = 2 * Math.PI * radius;                      // full circle (the length of the circle's edge = 2 x pi x radius)
  return (   // give back this JSX
    <div className="ring">
      {/* the drawing area, 116 x 116 pixels */}
      <svg width="116" height="116">
        {/* grey background circle: centre (58,58), no fill, 10px thick grey line */}
        <circle cx="58" cy="58" r={radius} fill="none" stroke="var(--gray-bg)" strokeWidth="10" />
        {/* coloured circle on top: colour comes from the score (green/amber/red).
            strokeDasharray + strokeDashoffset hide part of the line, so only "score %" of the circle is drawn.
            transition = animate the change smoothly over 0.5 seconds */}
        <circle cx="58" cy="58" r={radius} fill="none" stroke={CSS[scoreColor(score)]} strokeWidth="10" strokeLinecap="round"
                strokeDasharray={length} strokeDashoffset={length * (1 - score / 100)} style={{ transition: "stroke-dashoffset 0.5s" }} />
      </svg>
      {/* the text in the middle of the ring: the score in bold and "of 100" */}
      <div className="ring-text"><b>{score}</b><span>of 100</span></div>
    </div>
  );   // end of return
}   // end of ScoreRing

// stats = [{ label, value }]
// Summary component: the big result card after an inspection.
// In: score = road score (0-100), stats = a list of small numbers to show, each like { label: "Potholes", value: 3 }.
// Out: a card with the score ring, the condition name (e.g. "Good"), a coloured score chip, advice text and the small stats.
export function Summary({ score, stats }) {   // takes the two props
  const [, condition, advice] = conditionFor(score);   // get the row for this score; skip the 1st item (min), keep name and advice
  return (   // give back this JSX
    <div className="card summary">
      {/* the ring on the left */}
      <ScoreRing score={score} />
      {/* the text part on the right */}
      <div>
        {/* small title */}
        <span className="label">Road condition index</span>
        {/* condition name as a heading + a coloured chip like "72/100" */}
        <div className="verdict"><h2>{condition}</h2><Chip color={scoreColor(score)}>{score}/100</Chip></div>
        {/* the advice sentence */}
        <p className="advice">{advice}</p>
        {/* box that holds the small numbers */}
        <div className="stats">
          {/* .map = for every stat in the list, make one small box with its label and value. key = a unique name React needs for list items */}
          {stats.map((s) => <div className="stat" key={s.label}><span className="label">{s.label}</span><b>{s.value}</b></div>)}
        </div>
      </div>
    </div>
  );   // end of return
}   // end of Summary

// Potholes per severity level, as coloured bars.
// LevelBars component. In: counts = how many potholes per level, like { Low: 2, Medium: 1, High: 0, Critical: 1 }.
// Out: one row per level (Critical first) with the name, a coloured bar and the number.
export function LevelBars({ counts }) {   // takes the counts prop
  const most = Math.max(...Object.values(counts), 1);   // the biggest count (at least 1, so we never divide by 0). "..." spreads the list into separate numbers
  return (   // give back this JSX
    <div className="levels">
      {/* [...LEVELS] makes a copy of the list, .reverse() flips it (Critical first), .map makes one row per level */}
      {[...LEVELS].reverse().map((level) => (
        <div className="level-row" key={level}>
          {/* level name */}
          <span>{level}</span>
          {/* grey bar; the <i> inside is the coloured part. Its width = this count compared to the biggest count, in %; colour from the level */}
          <div className="bar"><i style={{ width: `${(100 * counts[level]) / most}%`, background: CSS[LEVEL_COLOR[level]] }} /></div>
          {/* the number in bold */}
          <b>{counts[level]}</b>
        </div>
      ))}
    </div>
  );   // end of return
}   // end of LevelBars

// Thin bar with a number, used in tables.
// CellBar component. In: percent = how full the bar is (0-100), text = text shown next to it.
// Out: a small bar filled to "percent" % and the text.
export const CellBar = ({ percent, text }) => (
  <div className="cell-bar"><div className="bar"><i style={{ width: `${percent}%` }} /></div><span>{text}</span></div>
);   // end of CellBar

// ---------------------------------------------------------------
// Repair plan card (estimates from backend/config.py, section 6)
// ---------------------------------------------------------------
// RepairPlan component: shows the repair estimate sent by the server.
// In: plan = an object with start_within, total_cost, currency, total_area_m2, asphalt_kg, crew_hours.
// Out: a card with an urgency chip and four numbers. If there is no plan, shows nothing (null).
export function RepairPlan({ plan }) {   // takes the plan prop
  if (!plan) return null;   // no plan -> show nothing
  // urgency colour: text has "24" (24 hours) -> red, has "7" (7 days) -> orange, otherwise green
  const urgent = plan.start_within.includes("24") ? "red" : plan.start_within.includes("7") ? "orange" : "green";
  return (   // give back this JSX
    <div className="card pad">
      {/* card heading + a coloured chip saying when to start the repair */}
      <div className="card-head"><h3>Repair estimate</h3><Chip color={urgent}>{plan.start_within}</Chip></div>
      {/* box holding the four estimate numbers */}
      <div className="plan">
        {/* total cost, written as money (e.g. ₹12,500) */}
        <div><span>Estimated cost</span><b>{money(plan.total_cost, plan.currency)}</b></div>
        {/* damaged road area in square metres */}
        <div><span>Road surface</span><b>{plan.total_area_m2} m²</b></div>
        {/* how many kg of cold-mix asphalt (road filling material) */}
        <div><span>Asphalt (cold mix)</span><b>{plan.asphalt_kg} kg</b></div>
        {/* how many hours the repair team needs */}
        <div><span>Crew time</span><b>{plan.crew_hours} h</b></div>
      </div>
      {/* small help text explaining it is only an estimate */}
      <p className="help">Estimate. Assumes one photo shows about 20 m² of road; rates are set in config.py.</p>
    </div>
  );   // end of return
}   // end of RepairPlan

// ---------------------------------------------------------------
// AI settings card. show = ["engine", "sensitivity", "confidence"]
// ---------------------------------------------------------------
// SettingsCard component: lets the user change the AI settings.
// In: info = options from the server (engines list, sensitivity presets),
//     settings = current values { engine, sensitivity, confidence },
//     change = a function to call with the new values,
//     show = which settings to display (any of "engine", "sensitivity", "confidence"),
//     title = card heading ("AI settings" if not given), children = extra things to put at the bottom.
// Out: a card with a dropdown, preset buttons and/or a slider.
export function SettingsCard({ info, settings, change, show, title = "AI settings", children }) {   // takes the props
  const { engine, sensitivity, confidence } = settings;   // take the three current values out of settings
  const pickSensitivity = (name) =>   // a preset sets the confidence AND the grass/paint check together
    change({ sensitivity: name, confidence: info.sensitivity[name].confidence, roadCheck: info.sensitivity[name].road_check });   // send preset name, its confidence and its road check

  return (   // give back this JSX
    <div className="card pad">
      {/* card heading */}
      <div className="card-head"><h3>{title}</h3></div>
      {/* "a && b" = show b only if a is true: only if "engine" is in show AND info has arrived */}
      {show.includes("engine") && info && (
        <div className="setting">
          {/* label text */}
          <span className="label">Detection engine</span>
          {/* dropdown: shows the current engine; when the user picks another, onChange sends the new engine name. e.target.value = the picked option */}
          <select className="select" value={engine} onChange={(e) => change({ engine: e.target.value })}>
            {/* .map = one <option> for every engine in the list */}
            {info.engines.map((e) => <option key={e.name}>{e.name}</option>)}
          </select>
          {/* help text: find the chosen engine and show its "about" text. "?." = do not crash if not found */}
          <p className="help">{info.engines.find((e) => e.name === engine)?.about}</p>
        </div>
      )}
      {/* sensitivity part: only if "sensitivity" is in show AND info has arrived */}
      {show.includes("sensitivity") && info && (
        <div className="setting">
          {/* label text */}
          <span className="label">Sensitivity</span>
          {/* a row of joined buttons */}
          <div className="segmented">
            {/* Object.keys gives the preset names; .map makes one button per name.
                The chosen one gets class "on" (highlighted). Clicking calls pickSensitivity with that name. */}
            {Object.keys(info.sensitivity).map((name) => (
              <button key={name} className={sensitivity === name ? "on" : ""} onClick={() => pickSensitivity(name)}>{name}</button>
            ))}
          </div>
          {/* help text: one sentence for "High", another for any other preset */}
          <p className="help">{sensitivity === "High" ? "Finds faint, far-away potholes. Ignores grass and lane paint." : "Only the potholes the AI is most sure about."}</p>
        </div>
      )}
      {/* confidence slider: only if "confidence" is in show */}
      {show.includes("confidence") && (
        <div className="setting">
          {/* label text */}
          <span className="label">Minimum confidence</span>
          {/* slider + number */}
          <div className="slider">
            {/* range input = a slider from 0.10 to 0.90 in steps of 0.05. On move, Number(...) turns the text value into a number and sends it */}
            <input type="range" min="0.10" max="0.90" step="0.05" value={confidence} onChange={(e) => change({ confidence: Number(e.target.value) })} />
            {/* the value as a percent, e.g. 0.25 -> 25% */}
            <b>{Math.round(confidence * 100)}%</b>
          </div>
        </div>
      )}
      {/* any extra things the parent page put inside <SettingsCard> ... </SettingsCard> */}
      {children}
    </div>
  );   // end of return
}   // end of SettingsCard

// ---------------------------------------------------------------
// Messages
// ---------------------------------------------------------------
// Loading: a spinning circle plus a text, shown while waiting. In: text.
export const Loading = ({ text }) => <div className="loading"><div className="spinner" />{text}</div>;
// ErrorBox: a red box showing an error message. In: text.
export const ErrorBox = ({ text }) => <div className="error">{text}</div>;
// Empty: a card shown when there is nothing to show yet. In: title (bold), text, children (e.g. buttons).
export const Empty = ({ title, text, children }) => <div className="card empty"><b>{title}</b>{text}{children}</div>;
