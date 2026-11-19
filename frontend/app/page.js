/*
  page.js  -  the app frame: sidebar menu, page header, and which page to show
  ===========================================================================
  Pages (menu on the left):
      Overview          -> DashboardView.js (Overview)     city-wide numbers, priority list
      New inspection    -> PhotoView.js                    check a road photo, repair estimate, PDF
      Video survey      -> VideoView.js                    check a whole street from a video
      Live camera       -> LiveView.js                     real-time detection with a camera
      Inspections       -> DashboardView.js (Inspections)  all inspections, status, export
      Model comparison  -> CompareView.js                  all AI engines on one photo
      Methodology       -> at the bottom of this file      how it works (for presentations)

  "State" = what the user chose + the latest answers from the Python server.
  When the state changes, React redraws the page by itself.

  Words used in this file (simple meaning):
    component = a function that returns a piece of the page (HTML-like code called JSX)
    JSX       = HTML-like code inside JavaScript; {...} inside it means "put a JS value here"
    props     = the inputs given to a component, like <PhotoView photo={photo} />
    useState  = a value React remembers; when it changes the page redraws
    useEffect = "run this code after the page is drawn" (again when the listed values change)
    useRef    = a box that keeps a value between redraws WITHOUT redrawing when it changes
    a && <X/> = show X only if a is true
*/
"use client"; // this page runs in the browser (it uses clicks, state and effects)
import { useEffect, useRef, useState } from "react"; // the React tools we use (explained above)
import { analyzePhoto, comparePhoto, getHistory, loadStart, updateScan } from "./api"; // functions that talk to the server
import CompareView from "./CompareView";                   // the "Model comparison" page
import { Inspections, Overview } from "./DashboardView";   // the "Inspections" and "Overview" pages
import LiveView from "./LiveView";                         // the "Live camera" page
import { Chip, Icon, LEVELS, LevelChip, SectionTitle } from "./parts"; // small shared pieces (labels, icons, titles)
import PhotoView from "./PhotoView";                       // the "New inspection" page
import VideoView from "./VideoView";                       // the "Video survey" page

// The menu: group name, page key, title, short description, icon
// Each row is a list (array): [0] group, [1] key, [2] title, [3] description, [4] icon name
const PAGES = [
  ["", "overview", "Overview", "Road condition across all inspections", "overview"], // no group: shown at the top
  ["Inspect", "inspect", "New inspection", "Check a road photo – the AI finds potholes and estimates the repair", "photo"],
  ["Inspect", "video", "Video survey", "Check a whole street from a dash-cam or phone video", "video"],
  ["Inspect", "live", "Live camera", "Real-time pothole detection with a webcam or phone camera", "camera"],
  ["Manage", "inspections", "Inspections", "Every inspection with its repair status – update, search and export", "list"],
  ["Analysis", "compare", "Model comparison", "Run all AI engines on the same photo", "compare"],
  ["Analysis", "method", "Methodology", "How the detection, scores and estimates work", "book"],
];
const EMPTY_DETAILS = { road_name: "", ward: "", inspector: "", notes: "" }; // blank road details for a new inspection

// Page = the whole app. In: no props. Out: the page (sidebar + header + the chosen page).
// It keeps all shared data (settings, photo, results, history) and hands it to the smaller pages as props.
// "export default" = this is the main thing of the file; Next.js shows it at the address "/".
export default function Page() {
  const [page, setPage] = useState("overview"); // which menu page is open; setPage changes it (starts at Overview)

  // ---------- AI settings ----------
  // engine = which AI model, sensitivity = preset name, confidence = how sure the AI must be, roadCheck = ignore non-road boxes
  const [settings, setSettings] = useState({ engine: "Ensemble", sensitivity: "High", confidence: 0.15, roadCheck: true });
  const change = (part) => setSettings((old) => ({ ...old, ...part })); // change only some settings: copy old ones, overwrite with part

  // ---------- data from the Python server ----------
  const [info, setInfo] = useState(null);             // engines, presets
  const [samples, setSamples] = useState([]);         // sample photos
  const [server, setServer] = useState("checking");   // "ok" / "off"
  const [history, setHistory] = useState(null);       // all inspections + totals
  const [historyError, setHistoryError] = useState(""); // error text if the history could not be loaded ("" = no error)

  // ---------- the current inspection ----------
  const [details, setDetails] = useState(EMPTY_DETAILS);  // road name, ward, inspector, notes
  const [photo, setPhoto] = useState(null);           // the chosen photo (sample or upload); null = none yet
  const [result, setResult] = useState(null);         // the AI answer for the photo on "New inspection"
  const [comparison, setComparison] = useState(null); // the answers of all engines on "Model comparison"
  const [loading, setLoading] = useState(false);      // true while waiting for the server (shows a spinner)
  const [error, setError] = useState("");             // error message to show ("" = none)
  const lastRequest = useRef(0);                      // number of the newest request, so old late answers are ignored
  const detailsNow = useRef(details);                 // always holds the newest details (read inside timers)
  detailsNow.current = details;                       // update it on every redraw

  // Load the saved inspections again. In: nothing. Out: a Promise; it fills history or sets historyError.
  const refreshHistory = () => getHistory()                    // ask the server for the history
    .then((h) => { setHistory(h); setHistoryError(""); })      // success: save it and clear the error
    .catch(() => setHistoryError("Could not load the inspections. Restart the server: press Ctrl + C in its terminal, then run ./start.sh")); // failure

  // 1. When the app opens: engines, sample photos and the history.
  useEffect(() => {
    loadStart()                                                 // ask the server for info + sample photos
      .then(({ info, samples }) => {                            // when the answer arrives:
        setInfo(info); setSamples(samples); change({ engine: info.default_engine }); // save them; use the server's default engine
        // an older server has no version number -> it must be restarted to get the new features
        setServer(info.version >= 3 ? "ok" : "old");           // version 3 or newer = ok, else "old"
      })
      .catch((e) => { setServer("off"); setError(e.message); }); // no answer -> server is off; show the message
    refreshHistory();                                           // also load the saved inspections
  }, []); // [] = run only once, when the page first opens

  // 2. Photo or AI setting changed -> ask the server (wait 250 ms so the slider does not send 20 requests).
  const { engine, confidence, roadCheck } = settings; // take these three values out of settings
  useEffect(() => {
    if (!photo || (page !== "inspect" && page !== "compare")) return; // no photo, or not on a photo page -> do nothing
    const id = ++lastRequest.current;                   // give this request a new number (1 higher than the last)
    const timer = setTimeout(async () => {              // setTimeout = run this later (after 250 ms)
      setLoading(true); setError("");                   // show the spinner, clear old errors
      try {
        if (page === "inspect") {                       // on "New inspection": one engine
          const data = await analyzePhoto(photo, { engine, confidence, roadCheck }, detailsNow.current); // wait for the AI answer
          if (id === lastRequest.current) { setResult(data); refreshHistory(); } // only if still the newest request: show it, reload history
        } else {                                        // on "Model comparison": all engines
          const data = await comparePhoto(photo, { confidence, roadCheck }); // wait for all engines' answers
          if (id === lastRequest.current) setComparison(data); // only if still the newest request: show it
        }
      } catch (e) {                                     // something went wrong
        if (id === lastRequest.current) setError(e.message); // show the error (only for the newest request)
      }
      if (id === lastRequest.current) setLoading(false); // hide the spinner
    }, 250);                                            // 250 milliseconds = a quarter of a second
    return () => clearTimeout(timer);                   // clean-up: if something changes before 250 ms, cancel this timer
  }, [photo, page, engine, confidence, roadCheck]);     // run again whenever one of these changes

  // A photo was chosen. In: p = the photo. Saves it and clears old results.
  const pickPhoto = (p) => { setPhoto(p); setResult(null); setComparison(null); };
  // Details changed after the result exists -> save them on the inspection.
  // In: nothing. If there is a saved inspection, send the details to the server, then reload the history.
  const saveDetails = () => result?.inspection_id && updateScan(result.inspection_id, detailsNow.current).then(refreshHistory);
  // Start a fresh inspection: clear details, photo and result, and open the "New inspection" page.
  const newInspection = () => { setDetails(EMPTY_DETAILS); setPhoto(null); setResult(null); setPage("inspect"); };

  const current = PAGES.find((p) => p[1] === page); // the menu row of the open page (for the header text)
  const openCount = history?.totals.open || 0;      // how many inspections are still Open (0 if history not loaded)

  // What the page shows (JSX). Comments inside JSX are written as {/* ... */}.
  return (
    <div className="shell">
      {/* ================= SIDEBAR MENU ================= */}
      <aside className="side">
        {/* logo and app name at the top of the sidebar */}
        <div className="side-brand">
          {/* the logo: a small drawing (SVG) of a road with lane marks, drawn in white */}
          <div className="side-logo"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M7 21 10 3M17 21 14 3M12 7v2M12 13v2M12 19v1" /></svg></div>
          {/* app name (bold) and a small subtitle */}
          <div><b>Pothole Detection</b><span>Road inspection system</span></div>
        </div>
        {/* one menu button per row of PAGES; map = do this for every row. The empty spot ", ," skips the description. i = row number */}
        {PAGES.map(([group, key, title, , icon], i) => (
          // key = a unique name React needs for lists; display "contents" = this wrapper div does not change the layout
          <div key={key} style={{ display: "contents" }}>
            {/* show the group heading only when this row starts a new group (different from the row before) */}
            {group && group !== PAGES[i - 1]?.[0] && <div className="side-group">{group}</div>}
            {/* the menu button: gets the class "on" (highlighted) if it is the open page; clicking it opens that page */}
            <button className={`side-link ${page === key ? "on" : ""}`} onClick={() => setPage(key)}>
              {/* the icon and the title of the page */}
              <Icon name={icon} />{title}
              {/* on the "Inspections" button show a small number badge with how many are still Open */}
              {key === "inspections" && openCount > 0 && <span className="side-count">{openCount}</span>}
            </button>
          </div>
        ))}
        {/* bottom of the sidebar: is the AI server online? */}
        <div className="side-foot">
          {/* a coloured dot; its class (ok / off / old / checking) picks the colour */}
          <i className={`dot ${server}`} />
          {/* pick the text that matches the server state; if none matches show "Connecting…" */}
          {{ ok: "AI server online", off: "AI server offline", old: "Server needs restart" }[server] || "Connecting…"}
        </div>
      </aside>

      {/* ================= MAIN AREA ================= */}
      <div className="main">
        {/* top bar: page title on the left, buttons on the right */}
        <header className="header">
          <div>
            {/* small path text like "Inspect / New inspection" ("Dashboard" if the page has no group) */}
            <div className="crumb">{current[0] || "Dashboard"} / {current[2]}</div>
            {/* the page title */}
            <h1>{current[2]}</h1>
            {/* the short description of the page */}
            <p>{current[3]}</p>
          </div>
          <div className="header-actions">
            {/* on every page except "New inspection": a blue button that starts a new inspection */}
            {page !== "inspect" && <button className="btn primary" onClick={newInspection}><Icon name="plus" size={16} />New inspection</button>}
            {/* on "New inspection" after a result: a "Start another" button */}
            {page === "inspect" && result && <button className="btn" onClick={newInspection}><Icon name="plus" size={16} />Start another</button>}
          </div>
        </header>

        <main className="content">
          {/* a clear warning when the Python server is stopped or still running old code */}
          {server === "off" && <div className="error" style={{ marginTop: 0, marginBottom: 20 }}><b>The AI server is not running.</b> Open a terminal in the project folder and run <code>./start.sh</code></div>}
          {/* warning when the server is an old version: it must be restarted */}
          {server === "old" && <div className="error" style={{ marginTop: 0, marginBottom: 20 }}><b>The AI server is running an old version.</b> Press Ctrl + C in its terminal, then run <code>./start.sh</code> again.</div>}
          {/* only ONE of the pages below is shown: the one whose key equals "page". Data is passed in as props */}
          {/* Overview: gets the history, its error, and go (setPage) so it can open other pages */}
          {page === "overview" && <Overview history={history} error={historyError} go={setPage} />}
          {/* New inspection: gets settings, details, the photo, the result, loading and error, plus functions to change them */}
          {page === "inspect" && (
            <PhotoView info={info} samples={samples} settings={settings} change={change}
                       details={details} setDetails={setDetails} saveDetails={saveDetails}
                       photo={photo} pickPhoto={pickPhoto} result={result} loading={loading} error={error} />
          )}
          {/* Video survey: onSaved reloads the history after a video is saved */}
          {page === "video" && <VideoView info={info} settings={settings} change={change} onSaved={refreshHistory} />}
          {/* Live camera: onSaved reloads the history after a snapshot is saved */}
          {page === "live" && <LiveView info={info} settings={settings} change={change} onSaved={refreshHistory} />}
          {/* Inspections list: refresh lets it reload the history after a change */}
          {page === "inspections" && <Inspections history={history} error={historyError} refresh={refreshHistory} />}
          {/* Model comparison: data = the answers of all engines */}
          {page === "compare" && (
            <CompareView info={info} samples={samples} settings={settings} change={change}
                         photo={photo} pickPhoto={pickPhoto} data={comparison} loading={loading} error={error} />
          )}
          {/* Methodology: the explanation page at the bottom of this file */}
          {page === "method" && <Methodology info={info} />}
        </main>

        {/* small text at the very bottom of the page */}
        <footer className="foot">Pothole Detection System · AI road inspection · YOLOv8 · YOLOv9 · YOLO11 · FastAPI · Next.js</footer>
      </div>
    </div>
  );
}

// =================================================================
// METHODOLOGY page: how it works (useful when presenting the project)
// =================================================================
// The 6 steps shown as cards: [title, text]
const STEPS = [
  ["Detect", "Three YOLO deep-learning models look for potholes. In Ensemble mode YOLOv8s and YOLOv9c vote together and PotholeNet adds potholes they missed. Large photos are also scanned in 640 px tiles."],
  ["Clean up", "Boxes on the same pothole are merged (Weighted Box Fusion), duplicates are removed, and boxes on grass or white lane paint are ignored."],
  ["Grade", "Each pothole gets a danger score from 0 to 100: size (up to 50) + position near the road centre (20) + closeness to the camera (15) + AI confidence (15)."],
  ["Score the road", "The Road Condition Index starts at 100 and loses points for every pothole – more for dangerous ones."],
  ["Estimate the repair", "Size and severity give the road area, cold-mix asphalt, crew time, cost and how soon each pothole must be fixed."],
  ["Track the repair", "Every inspection is stored in a database with its road, ward and inspector. Staff move it from Open to Scheduled to Repaired."],
];
// For each severity level: [score range, meaning] (shown in the table)
const LEVEL_TEXT = {
  Low: ["0 – 19", "Small crack or shallow dip."],
  Medium: ["20 – 39", "Noticeable pothole, some driving discomfort."],
  High: ["40 – 59", "Large pothole that affects vehicle control."],
  Critical: ["60 – 100", "Deep or dangerous pothole. Repair now."],
};

// Methodology = the "how it works" page.
// In:  props { info } = settings from the server (penalty points, repair times, prices); can be null while loading.
// Out: step cards, a severity table and two info cards (accuracy and system).
function Methodology({ info }) {
  return (
    // <> </> = a "fragment": groups several elements without adding an extra box to the page
    <>
      {/* the step cards in a 3-column grid; one card per STEPS row, i = its number (starting at 0) */}
      <div className="grid-3">
        {STEPS.map(([title, text], i) => (
          <div className="card pad method" key={title}>
            {/* step number: i + 1 so it starts at 1 */}
            <div className="step-num">{i + 1}</div>
            {/* step title */}
            <h3>{title}</h3>
            {/* step explanation */}
            <p>{text}</p>
          </div>
        ))}
      </div>

      {/* heading above the table, with a small note */}
      <SectionTitle title="Severity levels" note="based on the danger score" />
      <div className="card table">
        <table>
          {/* table header: the column names */}
          <thead><tr><th>Level</th><th>Danger score</th><th>Meaning</th><th>Road index</th><th>Repair within</th><th>Rate per m²</th></tr></thead>
          <tbody>
            {/* one table row per severity level (LEVELS comes from parts.js) */}
            {LEVELS.map((level) => (
              <tr key={level}>
                {/* coloured label with the level name */}
                <td><LevelChip level={level} /></td>
                {/* score range */}
                <td>{LEVEL_TEXT[level][0]}</td>
                {/* meaning */}
                <td>{LEVEL_TEXT[level][1]}</td>
                {/* points lost from the road index (from the server); "–" while info is not loaded */}
                <td>{info ? `−${info.penalty[level]} points` : "–"}</td>
                {/* how soon it must be repaired (from the server) */}
                <td>{info?.repair[level].repair_within || "–"}</td>
                {/* repair price per square metre, with the currency sign (from the server) */}
                <td>{info ? `${info.currency}${info.repair[level].cost_per_m2}` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* two cards side by side, with space above them */}
      <div className="grid-2" style={{ marginTop: 28 }}>
        {/* card 1: accuracy numbers from testing (fixed text) */}
        <div className="card pad">
          {/* card title with a green "Tested" label */}
          <div className="card-head"><h3>Accuracy (Ensemble engine)</h3><Chip color="green">Tested</Chip></div>
          {/* each "kv" row = a name on the left and a value on the right */}
          <div className="kv"><span>Potholes found (recall), High sensitivity</span><b>80%</b></div>
          <div className="kv"><span>Potholes found (recall), Balanced</span><b>78%</b></div>
          <div className="kv"><span>Correct detections (precision), Balanced</span><b>72%*</b></div>
          <div className="kv"><span>False alarms on a clean road</span><b>0</b></div>
          <div className="kv"><span>Time per photo (laptop CPU)</span><b>0.5 – 1 s</b></div>
          {/* small note about the test set */}
          <p className="help">Test set: 100 labelled road photos with 269 potholes. *Some real potholes were not labelled, so true precision is higher.</p>
        </div>
        {/* card 2: which AI models and tools the system uses */}
        <div className="card pad">
          {/* card title with a blue "Runs offline" label */}
          <div className="card-head"><h3>System</h3><Chip color="blue">Runs offline</Chip></div>
          {/* each row: what the part is, and its name / source */}
          <div className="kv"><span>YOLOv8s – fast and accurate</span><b>Samdutse/pothole-yolov8</b></div>
          <div className="kv"><span>YOLOv9c – larger model</span><b>EngJamesO/pothole-detector</b></div>
          <div className="kv"><span>YOLO11n – water-filled potholes</span><b>Karn815833/PotholeNet</b></div>
          <div className="kv"><span>Server and database</span><b>Python · FastAPI · SQLite</b></div>
          <div className="kv"><span>Web application</span><b>Next.js · React</b></div>
        </div>
      </div>
    </>
  );
}
