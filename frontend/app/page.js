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
*/
"use client";
import { useEffect, useRef, useState } from "react";
import { analyzePhoto, comparePhoto, getHistory, loadStart, updateScan } from "./api";
import CompareView from "./CompareView";
import { Inspections, Overview } from "./DashboardView";
import LiveView from "./LiveView";
import { Chip, Icon, LEVELS, LevelChip, SectionTitle } from "./parts";
import PhotoView from "./PhotoView";
import VideoView from "./VideoView";

// The menu: group name, page key, title, short description, icon
const PAGES = [
  ["", "overview", "Overview", "Road condition across all inspections", "overview"],
  ["Inspect", "inspect", "New inspection", "Check a road photo – the AI finds potholes and estimates the repair", "photo"],
  ["Inspect", "video", "Video survey", "Check a whole street from a dash-cam or phone video", "video"],
  ["Inspect", "live", "Live camera", "Real-time pothole detection with a webcam or phone camera", "camera"],
  ["Manage", "inspections", "Inspections", "Every inspection with its repair status – update, search and export", "list"],
  ["Analysis", "compare", "Model comparison", "Run all AI engines on the same photo", "compare"],
  ["Analysis", "method", "Methodology", "How the detection, scores and estimates work", "book"],
];
const EMPTY_DETAILS = { road_name: "", ward: "", inspector: "", notes: "" };

export default function Page() {
  const [page, setPage] = useState("overview");

  // ---------- AI settings ----------
  const [settings, setSettings] = useState({ engine: "Ensemble", sensitivity: "High", confidence: 0.15, roadCheck: true });
  const change = (part) => setSettings((old) => ({ ...old, ...part }));

  // ---------- data from the Python server ----------
  const [info, setInfo] = useState(null);             // engines, presets
  const [samples, setSamples] = useState([]);         // sample photos
  const [server, setServer] = useState("checking");   // "ok" / "off"
  const [history, setHistory] = useState(null);       // all inspections + totals
  const [historyError, setHistoryError] = useState("");

  // ---------- the current inspection ----------
  const [details, setDetails] = useState(EMPTY_DETAILS);  // road name, ward, inspector, notes
  const [photo, setPhoto] = useState(null);
  const [result, setResult] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const lastRequest = useRef(0);
  const detailsNow = useRef(details);
  detailsNow.current = details;

  const refreshHistory = () => getHistory()
    .then((h) => { setHistory(h); setHistoryError(""); })
    .catch(() => setHistoryError("Could not load the inspections. Restart the server: press Ctrl + C in its terminal, then run ./start.sh"));

  // 1. When the app opens: engines, sample photos and the history.
  useEffect(() => {
    loadStart()
      .then(({ info, samples }) => {
        setInfo(info); setSamples(samples); change({ engine: info.default_engine });
        // an older server has no version number -> it must be restarted to get the new features
        setServer(info.version >= 3 ? "ok" : "old");
      })
      .catch((e) => { setServer("off"); setError(e.message); });
    refreshHistory();
  }, []);

  // 2. Photo or AI setting changed -> ask the server (wait 250 ms so the slider does not send 20 requests).
  const { engine, confidence, roadCheck } = settings;
  useEffect(() => {
    if (!photo || (page !== "inspect" && page !== "compare")) return;
    const id = ++lastRequest.current;
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try {
        if (page === "inspect") {
          const data = await analyzePhoto(photo, { engine, confidence, roadCheck }, detailsNow.current);
          if (id === lastRequest.current) { setResult(data); refreshHistory(); }
        } else {
          const data = await comparePhoto(photo, { confidence, roadCheck });
          if (id === lastRequest.current) setComparison(data);
        }
      } catch (e) {
        if (id === lastRequest.current) setError(e.message);
      }
      if (id === lastRequest.current) setLoading(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [photo, page, engine, confidence, roadCheck]);

  const pickPhoto = (p) => { setPhoto(p); setResult(null); setComparison(null); };
  // Details changed after the result exists -> save them on the inspection.
  const saveDetails = () => result?.inspection_id && updateScan(result.inspection_id, detailsNow.current).then(refreshHistory);
  const newInspection = () => { setDetails(EMPTY_DETAILS); setPhoto(null); setResult(null); setPage("inspect"); };

  const current = PAGES.find((p) => p[1] === page);
  const openCount = history?.totals.open || 0;

  return (
    <div className="shell">
      {/* ================= SIDEBAR MENU ================= */}
      <aside className="side">
        <div className="side-brand">
          <div className="side-logo"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M7 21 10 3M17 21 14 3M12 7v2M12 13v2M12 19v1" /></svg></div>
          <div><b>Pothole Detection</b><span>Road inspection system</span></div>
        </div>
        {PAGES.map(([group, key, title, , icon], i) => (
          <div key={key} style={{ display: "contents" }}>
            {group && group !== PAGES[i - 1]?.[0] && <div className="side-group">{group}</div>}
            <button className={`side-link ${page === key ? "on" : ""}`} onClick={() => setPage(key)}>
              <Icon name={icon} />{title}
              {key === "inspections" && openCount > 0 && <span className="side-count">{openCount}</span>}
            </button>
          </div>
        ))}
        <div className="side-foot">
          <i className={`dot ${server}`} />
          {{ ok: "AI server online", off: "AI server offline", old: "Server needs restart" }[server] || "Connecting…"}
        </div>
      </aside>

      {/* ================= MAIN AREA ================= */}
      <div className="main">
        <header className="header">
          <div>
            <div className="crumb">{current[0] || "Dashboard"} / {current[2]}</div>
            <h1>{current[2]}</h1>
            <p>{current[3]}</p>
          </div>
          <div className="header-actions">
            {page !== "inspect" && <button className="btn primary" onClick={newInspection}><Icon name="plus" size={16} />New inspection</button>}
            {page === "inspect" && result && <button className="btn" onClick={newInspection}><Icon name="plus" size={16} />Start another</button>}
          </div>
        </header>

        <main className="content">
          {/* a clear warning when the Python server is stopped or still running old code */}
          {server === "off" && <div className="error" style={{ marginTop: 0, marginBottom: 20 }}><b>The AI server is not running.</b> Open a terminal in the project folder and run <code>./start.sh</code></div>}
          {server === "old" && <div className="error" style={{ marginTop: 0, marginBottom: 20 }}><b>The AI server is running an old version.</b> Press Ctrl + C in its terminal, then run <code>./start.sh</code> again.</div>}
          {page === "overview" && <Overview history={history} error={historyError} go={setPage} />}
          {page === "inspect" && (
            <PhotoView info={info} samples={samples} settings={settings} change={change}
                       details={details} setDetails={setDetails} saveDetails={saveDetails}
                       photo={photo} pickPhoto={pickPhoto} result={result} loading={loading} error={error} />
          )}
          {page === "video" && <VideoView info={info} settings={settings} change={change} onSaved={refreshHistory} />}
          {page === "live" && <LiveView info={info} settings={settings} change={change} onSaved={refreshHistory} />}
          {page === "inspections" && <Inspections history={history} error={historyError} refresh={refreshHistory} />}
          {page === "compare" && (
            <CompareView info={info} samples={samples} settings={settings} change={change}
                         photo={photo} pickPhoto={pickPhoto} data={comparison} loading={loading} error={error} />
          )}
          {page === "method" && <Methodology info={info} />}
        </main>

        <footer className="foot">Pothole Detection System · AI road inspection · YOLOv8 · YOLOv9 · YOLO11 · FastAPI · Next.js</footer>
      </div>
    </div>
  );
}

// =================================================================
// METHODOLOGY page: how it works (useful when presenting the project)
// =================================================================
const STEPS = [
  ["Detect", "Three YOLO deep-learning models look for potholes. In Ensemble mode YOLOv8s and YOLOv9c vote together and PotholeNet adds potholes they missed. Large photos are also scanned in 640 px tiles."],
  ["Clean up", "Boxes on the same pothole are merged (Weighted Box Fusion), duplicates are removed, and boxes on grass or white lane paint are ignored."],
  ["Grade", "Each pothole gets a danger score from 0 to 100: size (up to 50) + position near the road centre (20) + closeness to the camera (15) + AI confidence (15)."],
  ["Score the road", "The Road Condition Index starts at 100 and loses points for every pothole – more for dangerous ones."],
  ["Estimate the repair", "Size and severity give the road area, cold-mix asphalt, crew time, cost and how soon each pothole must be fixed."],
  ["Track the repair", "Every inspection is stored in a database with its road, ward and inspector. Staff move it from Open to Scheduled to Repaired."],
];
const LEVEL_TEXT = {
  Low: ["0 – 19", "Small crack or shallow dip."],
  Medium: ["20 – 39", "Noticeable pothole, some driving discomfort."],
  High: ["40 – 59", "Large pothole that affects vehicle control."],
  Critical: ["60 – 100", "Deep or dangerous pothole. Repair now."],
};

function Methodology({ info }) {
  return (
    <>
      <div className="grid-3">
        {STEPS.map(([title, text], i) => (
          <div className="card pad method" key={title}>
            <div className="step-num">{i + 1}</div>
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
        ))}
      </div>

      <SectionTitle title="Severity levels" note="based on the danger score" />
      <div className="card table">
        <table>
          <thead><tr><th>Level</th><th>Danger score</th><th>Meaning</th><th>Road index</th><th>Repair within</th><th>Rate per m²</th></tr></thead>
          <tbody>
            {LEVELS.map((level) => (
              <tr key={level}>
                <td><LevelChip level={level} /></td>
                <td>{LEVEL_TEXT[level][0]}</td>
                <td>{LEVEL_TEXT[level][1]}</td>
                <td>{info ? `−${info.penalty[level]} points` : "–"}</td>
                <td>{info?.repair[level].repair_within || "–"}</td>
                <td>{info ? `${info.currency}${info.repair[level].cost_per_m2}` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid-2" style={{ marginTop: 28 }}>
        <div className="card pad">
          <div className="card-head"><h3>Accuracy (Ensemble engine)</h3><Chip color="green">Tested</Chip></div>
          <div className="kv"><span>Potholes found (recall), High sensitivity</span><b>80%</b></div>
          <div className="kv"><span>Potholes found (recall), Balanced</span><b>78%</b></div>
          <div className="kv"><span>Correct detections (precision), Balanced</span><b>72%*</b></div>
          <div className="kv"><span>False alarms on a clean road</span><b>0</b></div>
          <div className="kv"><span>Time per photo (laptop CPU)</span><b>0.5 – 1 s</b></div>
          <p className="help">Test set: 100 labelled road photos with 269 potholes. *Some real potholes were not labelled, so true precision is higher.</p>
        </div>
        <div className="card pad">
          <div className="card-head"><h3>System</h3><Chip color="blue">Runs offline</Chip></div>
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
