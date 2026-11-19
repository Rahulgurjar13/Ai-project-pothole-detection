/*
  PhotoView.js  -  the "New inspection" page
  ==========================================
  Step 1  Inspection details  (road name, ward/zone, inspector, notes - optional)
  Step 2  Road photo          (upload, drag & drop, or a sample)
  Step 3  Inspection report   (appears by itself: road index, marked photo, severity,
                               repair estimate, GPS location, pothole list, print/PDF)

  PhotoPicker is also used by the Model comparison page.
*/
"use client";
/* eslint-disable @next/next/no-img-element */
// Bring in 3 React "hooks" (special helper functions from React):
//   useEffect = run some code after the page shows / when a value changes
//   useRef    = a box that keeps a value between redraws without redrawing the page
//   useState  = a remembered value; changing it makes React redraw the page
import { useEffect, useRef, useState } from "react";
// Bring in small ready-made screen pieces and helper functions from our own file parts.js
import { CellBar, ErrorBox, Icon, inspectionId, LevelBars, LevelChip, Loading, money, RepairPlan, SectionTitle, SettingsCard, StatusChip, Summary } from "./parts";

// ---------------------------------------------------------------
// Choose a photo: drag & drop / browse, or click a sample road.
// onPick({ kind: "upload", file, name, url })  or  onPick({ kind: "sample", name, url })
// ---------------------------------------------------------------
// PhotoPicker = a component (a reusable piece of the screen) that lets the user choose a road photo.
// What goes in (props):
//   samples = list of sample photos, each { name, url }, shown as small picture buttons
//   picked  = the photo already chosen (empty if nothing chosen yet)
//   onPick  = a function we call to tell the parent page which photo was chosen
// What comes out: the screen markup (a drop box, or a preview of the chosen photo, plus sample buttons).
// "export" = other files (like CompareView.js) can import and use it.
export function PhotoPicker({ samples, picked, onPick }) {
  const fileInput = useRef(null); // a box that will hold the hidden <input type="file"> so code can "click" it
  const [dragging, setDragging] = useState(false); // true while a file is dragged over the drop box (to highlight it)
  // pickFile = if a file is given, tell the parent about it ("file &&" = do nothing when there is no file).
  // URL.createObjectURL(file) makes a temporary web address for the file so an <img> can show it.
  const pickFile = (file) => file && onPick({ kind: "upload", file, name: file.name, url: URL.createObjectURL(file) });

  // Send back the screen markup. <> ... </> is a "fragment" = an invisible wrapper around many elements.
  return (
    <>
      {/* Hidden file chooser. ref = store this element in fileInput; type="file" = a "choose file" input;
          accept = only JPG/PNG/WEBP images; hidden = not shown on screen;
          onChange = when the user chooses a file, send the first file (files[0]) to pickFile */}
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pickFile(e.target.files[0])} />
      {/* "picked ? (A) : (B)" = if a photo is already chosen show A, otherwise show B.
          A = the "chosen" box: preview picture, file name, and a "Replace photo" button.
          B = the "drop" box. Its CSS class gets "over" while dragging, so it looks highlighted.
              onDragOver  = a file is moving over the box: preventDefault() stops the browser from opening
                            the file itself, then setDragging(true) highlights the box
              onDragLeave = the file left the box: remove the highlight
              onDrop      = the file was dropped: stop the browser default, remove the highlight,
                            and send the first dropped file to pickFile */}
      {picked ? (
        <div className="chosen">
          {/* Small preview of the chosen photo; alt = text shown if the picture cannot load */}
          <img src={picked.url} alt={picked.name} />
          {/* File name in bold, then whether it is a sample photo or an uploaded photo */}
          <div><b>{picked.name}</b><span>{picked.kind === "sample" ? "Sample photo" : "Uploaded photo"}</span></div>
          {/* Opens the hidden file chooser (fileInput.current = the real input element) to pick another photo */}
          <button className="btn small" onClick={() => fileInput.current.click()}>Replace photo</button>
        </div>
      ) : (
        <div className={`drop ${dragging ? "over" : ""}`}
             onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
             onDragLeave={() => setDragging(false)}
             onDrop={(e) => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files[0]); }}>
          {/* Upload icon at the top of the drop box */}
          <div className="drop-icon"><Icon name="upload" size={20} /></div>
          {/* Main instruction text in bold */}
          <b>Drag a road photo here, or browse</b>
          {/* Small help text: allowed file types, and that GPS photos also show their location */}
          <span>JPG, PNG or WEBP · phone photos with location turned on also show where they were taken</span>
          {/* Opens the hidden file chooser */}
          <button className="btn primary" onClick={() => fileInput.current.click()}>Browse files</button>
        </div>
      )}
      {/* Only when there is at least one sample photo, show the samples section ("A && B" = show B only if A is true) */}
      {samples.length > 0 && (
        <>
          {/* Small heading above the sample photos */}
          <span className="label samples-title">Or use a sample photo</span>
          <div className="samples">
            {/* .map = make one button for each sample photo s in the list.
                key = a unique name so React can keep track of each button; title = tooltip text on hover;
                the class gets "on" when this sample is the one chosen (?. = read safely even if picked is empty);
                clicking the button tells the parent this sample was chosen. Inside is a small picture of the road. */}
            {samples.map((s) => (
              <button key={s.name} title={s.name} className={`sample ${picked?.kind === "sample" && picked.name === s.name ? "on" : ""}`}
                      onClick={() => onPick({ kind: "sample", name: s.name, url: s.url })}>
                <img src={s.url} alt={s.name} />
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// A CSV file (opens in Excel) with one row per pothole.
// csvLink = builds a download link for a CSV file (CSV = a simple table file that Excel opens; values separated by commas).
// What goes in: result = the AI's answer for one photo (it has a list of potholes).
// What comes out: a "data:" link - the whole file is written inside the link itself, so no server is needed.
function csvLink(result) {
  // rows = a list of rows; the first row is the column headings
  const rows = [["Pothole", "Severity", "Danger score", "Confidence %", "Area m2", "Asphalt kg", "Cost", "Repair within"],
    // "..." spreads in one row per pothole p: its number, level, danger, confidence turned into a whole % (0.87 -> 87), and repair numbers
    ...result.potholes.map((p) => [p.number, p.level, p.danger, Math.round(p.confidence * 100), p.repair.area_m2, p.repair.asphalt_kg, p.repair.cost, p.repair.repair_within])];
  // Join each row's values with commas, join rows with new lines, make it safe for a link (encodeURIComponent), and add the CSV header
  return "data:text/csv;charset=utf-8," + encodeURIComponent(rows.map((r) => r.join(",")).join("\n"));
}

// ---------------------------------------------------------------
// The page
// ---------------------------------------------------------------
// PhotoView = the whole "New inspection" page (default export = the main thing this file gives to page.js).
// What goes in (props, all given by page.js):
//   info        = details from the backend (e.g. the list of AI engines) used by the settings card
//   samples     = sample road photos
//   settings    = current AI settings (engine, sensitivity, confidence)
//   change      = function to change one setting
//   details     = the typed inspection details { road_name, ward, inspector, notes }
//   setDetails  = function to update those details
//   saveDetails = function to save the details to the backend (called when a box loses focus)
//   photo       = the chosen photo;  pickPhoto = function to choose a photo
//   result      = the AI's answer for the photo (empty until it arrives)
//   loading     = true while the AI is working;  error = an error message, if any
// What comes out: the screen markup for steps 1, 2, the settings card and (when ready) the step 3 report.
export default function PhotoView({ info, samples, settings, change, details, setDetails, saveDetails, photo, pickPhoto, result, loading, error }) {
  const [view, setView] = useState("Detections"); // which picture tab is open: "Detections" (marked photo) or "Original"
  // edit("road_name") gives back a function for onChange: it copies all details ("...details") and replaces just that one field
  const edit = (field) => (e) => setDetails({ ...details, [field]: e.target.value });

  // When a NEW result arrives, scroll down to the report.
  const resultName = result?.file_name; // the result's file name (?. = undefined if there is no result yet)
  useEffect(() => { // run this code after the page shows, and again whenever resultName changes
    if (resultName) document.getElementById("report")?.scrollIntoView({ behavior: "smooth" }); // find the element with id="report" and glide down to it
  }, [resultName]); // the list of values to watch: only re-run when resultName changes

  const plan = result?.repair_plan; // the repair estimate (total cost, currency, how soon to repair)
  const gps = result?.gps; // GPS location read from the photo (lat/lon), or empty if the photo had none
  // Today's date and time written the Indian way, e.g. "19 Nov 2026, 10:30 am"
  const today = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  // Send back the screen markup, wrapped in an invisible fragment <> ... </>
  return (
    <>
      {/* Top area: left = steps 1 and 2, right = settings card. "no-print" = hide this part when printing */}
      <div className="grid-main no-print">
        {/* "stack" = put the two step cards one under the other */}
        <div className="stack">
          {/* STEP 1 */}
          {/* Card with the optional inspection details form */}
          <div className="card pad">
            {/* Step heading: number 1, title, and the word "optional" */}
            <div className="step"><i>1</i><h3>Inspection details</h3><span>optional</span></div>
            {/* A grid of text boxes side by side */}
            <div className="form-grid">
              {/* Road / street box. placeholder = grey example text; value = what is stored in details;
                  onChange = update details as the user types; onBlur = when the user leaves the box, save the details */}
              <label className="field"><span className="label">Road / street</span>
                <input className="input" placeholder="e.g. MG Road, near bus stand" value={details.road_name} onChange={edit("road_name")} onBlur={saveDetails} /></label>
              {/* Ward / zone box (works the same way, stored in details.ward) */}
              <label className="field"><span className="label">Ward / zone</span>
                <input className="input" placeholder="e.g. Ward 12" value={details.ward} onChange={edit("ward")} onBlur={saveDetails} /></label>
              {/* Inspector name box (stored in details.inspector) */}
              <label className="field"><span className="label">Inspector</span>
                <input className="input" placeholder="Your name" value={details.inspector} onChange={edit("inspector")} onBlur={saveDetails} /></label>
            </div>
            {/* Notes: a bigger multi-line text box (textarea) with a 14px gap above it; stored in details.notes */}
            <label className="field" style={{ marginTop: 14 }}><span className="label">Notes</span>
              <textarea className="textarea" placeholder="e.g. Water-logged after rain, heavy traffic" value={details.notes} onChange={edit("notes")} onBlur={saveDetails} /></label>
          </div>

          {/* STEP 2 */}
          {/* Card where the user chooses the road photo */}
          <div className="card pad">
            {/* Step heading: number 2, title, and a note that the AI starts by itself */}
            <div className="step"><i>2</i><h3>Road photo</h3><span>the AI starts automatically</span></div>
            {/* The photo chooser from above; the chosen photo goes back to the parent through pickPhoto */}
            <PhotoPicker samples={samples} picked={photo} onPick={pickPhoto} />
          </div>
        </div>

        {/* AI settings card (from parts.js). show = which settings to show: engine, sensitivity and confidence */}
        <SettingsCard info={info} settings={settings} change={change} show={["engine", "sensitivity", "confidence"]}>
          {/* Help text shown inside the settings card, with a 16px gap above */}
          <p className="help" style={{ marginTop: 16 }}>The default settings work for most photos. Changes re-check the photo straight away.</p>
        </SettingsCard>
      </div>

      {/* If there is an error message, show it in a red error box */}
      {error && <ErrorBox text={error} />}
      {/* While the AI is working, show a spinning "loading" message */}
      {loading && <Loading text="The AI is checking the road…" />}

      {/* STEP 3: the report */}
      {/* Only when a result exists, show the whole report below */}
      {result && (
        <>
          {/* Title block that is shown ONLY on paper / PDF when printing ("print-only") */}
          <div className="print-only">
            {/* Report title with the inspection number, e.g. INS-0007 */}
            <h1 style={{ fontSize: "1.4rem" }}>Road Inspection Report – {inspectionId(result.inspection_id)}</h1>
            {/* Small line saying when it was printed */}
            <p className="help">Pothole Detection System · printed {today}</p>
          </div>

          {/* Report heading. id="report" is what the auto-scroll above jumps to */}
          <div id="report" className="section-title">
            {/* Heading text plus the inspection number shown with a small gap on its left */}
            <h2>Inspection report <span className="id" style={{ marginLeft: 6 }}>{inspectionId(result.inspection_id)}</span></h2>
            {/* Buttons on the right (hidden when printing) */}
            <div className="header-actions no-print">
              {/* Opens the browser's print window (the user can also "Save as PDF" there) */}
              <button className="btn small" onClick={() => window.print()}><Icon name="print" size={15} />Print / save PDF</button>
              {/* Link that downloads the AI-marked photo; download = the file name to save it as, e.g. INS-0007.jpg */}
              <a className="btn small" href={result.image} download={`${inspectionId(result.inspection_id)}.jpg`}><Icon name="download" size={15} />Marked photo</a>
              {/* Only if at least one pothole was found: link that downloads the pothole list as a CSV file (made by csvLink) */}
              {result.count > 0 && <a className="btn small" href={csvLink(result)} download={`${inspectionId(result.inspection_id)}_potholes.csv`}><Icon name="download" size={15} />Pothole list</a>}
            </div>
          </div>

          {/* Report header card with a 16px gap below: road, ward, inspector, date, location, status */}
          <div className="card report-head" style={{ marginBottom: 16 }}>
            {/* Road name, or "Not given" if the box was left empty ("||" = use the right side when the left is empty) */}
            <div><span>Road</span><b>{details.road_name || "Not given"}</b></div>
            {/* Ward / zone, or a dash if empty */}
            <div><span>Ward / zone</span><b>{details.ward || "–"}</b></div>
            {/* Inspector name, or a dash if empty */}
            <div><span>Inspector</span><b>{details.inspector || "–"}</b></div>
            {/* Today's date and time */}
            <div><span>Date</span><b>{today}</b></div>
            {/* If the photo had GPS: a link that opens Google Maps at that spot in a new tab (target="_blank";
                rel="noreferrer" is a safety setting for new tabs). Otherwise the text "No GPS in photo" */}
            <div><span>Location</span><b>{gps ? <a href={`https://www.google.com/maps?q=${gps.lat},${gps.lon}`} target="_blank" rel="noreferrer">{gps.lat}, {gps.lon}</a> : "No GPS in photo"}</b></div>
            {/* Status chip - a new inspection always starts as "Open" */}
            <div><span>Status</span><b><StatusChip status="Open" /></b></div>
          </div>

          {/* Summary row (from parts.js): the road index score ring plus 4 small number boxes:
              number of potholes; most severe level (or "None" if 0 found); estimated repair cost written as money;
              and how soon to repair (the word "Within " is removed to keep it short) */}
          <Summary score={result.road_score} stats={[
            { label: "Potholes", value: result.count },
            { label: "Most severe", value: result.count ? result.worst : "None" },
            { label: "Est. repair cost", value: money(plan.total_cost, plan.currency) },
            { label: "Repair within", value: plan.start_within.replace("Within ", "") },
          ]} />

          {/* Two columns with a 20px gap above: left = photo card, right = severity + repair plan */}
          <div className="grid-main" style={{ marginTop: 20 }}>
            {/* Photo card */}
            <div className="card pad">
              {/* Card top row: title and tab buttons */}
              <div className="card-head">
                {/* Title: on the Detections tab show e.g. "3 potholes detected" ("pothole" without "s" when it is exactly 1);
                    on the Original tab show "Original photo" */}
                <h3>{view === "Detections" ? `${result.count} pothole${result.count === 1 ? "" : "s"} detected` : "Original photo"}</h3>
                {/* Two tab buttons; the open one gets class "on"; clicking a tab changes view */}
                <div className="tabs">
                  {["Detections", "Original"].map((v) => <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{v}</button>)}
                </div>
              </div>
              {/* The big picture: the AI-marked photo on the Detections tab, or the user's original photo on the Original tab */}
              <img className="photo" src={view === "Detections" ? result.image : photo?.url} alt={view} />
              {/* Small info line: which engine ran, how many seconds it took (2 decimals), and the minimum confidence as a % */}
              <p className="help">Engine {result.engine} · {result.seconds.toFixed(2)} s · minimum confidence {Math.round(settings.confidence * 100)}%</p>
            </div>
            {/* Right column, cards stacked one under the other */}
            <div className="stack">
              {/* Card with bars showing how many potholes are Low / Medium / High / Critical */}
              <div className="card pad"><div className="card-head"><h3>Severity breakdown</h3></div><LevelBars counts={result.counts} /></div>
              {/* Only if potholes were found: the repair plan card (materials, cost, when to repair) */}
              {result.count > 0 && <RepairPlan plan={plan} />}
            </div>
          </div>

          {/* Only if potholes were found: a table listing every pothole */}
          {result.count > 0 && (
            <>
              {/* Section heading with a small note */}
              <SectionTitle title="Detected potholes" note="most confident first" />
              <div className="card table">
                <table>
                  {/* Table heading row (thead = heading part, tr = row, th = heading cell) */}
                  <thead><tr><th>#</th><th>Severity</th><th>Danger score</th><th>AI confidence</th><th>Area</th><th>Asphalt</th><th>Repair within</th><th>Est. cost</th></tr></thead>
                  <tbody>
                    {/* One table row (tr) for each pothole p; key = its number so React can track each row.
                        Cells (td) in order: pothole number; severity chip; danger score with no decimals out of 100;
                        confidence as a small bar with its % text; area in square metres; asphalt needed in kg;
                        how soon to repair; estimated cost written as money */}
                    {result.potholes.map((p) => (
                      <tr key={p.number}>
                        <td><b>#{p.number}</b></td>
                        <td><LevelChip level={p.level} /></td>
                        <td>{p.danger.toFixed(0)}/100</td>
                        <td><CellBar percent={p.confidence * 100} text={`${Math.round(p.confidence * 100)}%`} /></td>
                        <td>{p.repair.area_m2} m²</td>
                        <td>{p.repair.asphalt_kg} kg</td>
                        <td>{p.repair.repair_within}</td>
                        <td>{money(p.repair.cost, plan.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {/* Only if the user typed notes: a card that shows them at the bottom of the report */}
          {details.notes && <div className="card pad" style={{ marginTop: 16 }}><span className="label">Notes</span><p style={{ marginTop: 6 }}>{details.notes}</p></div>}
        </>
      )}
    </>
  );
}
