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
import { useEffect, useRef, useState } from "react";
import { CellBar, ErrorBox, Icon, inspectionId, LevelBars, LevelChip, Loading, money, RepairPlan, SectionTitle, SettingsCard, StatusChip, Summary } from "./parts";

// ---------------------------------------------------------------
// Choose a photo: drag & drop / browse, or click a sample road.
// onPick({ kind: "upload", file, name, url })  or  onPick({ kind: "sample", name, url })
// ---------------------------------------------------------------
export function PhotoPicker({ samples, picked, onPick }) {
  const fileInput = useRef(null);
  const [dragging, setDragging] = useState(false);
  const pickFile = (file) => file && onPick({ kind: "upload", file, name: file.name, url: URL.createObjectURL(file) });

  return (
    <>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pickFile(e.target.files[0])} />
      {picked ? (
        <div className="chosen">
          <img src={picked.url} alt={picked.name} />
          <div><b>{picked.name}</b><span>{picked.kind === "sample" ? "Sample photo" : "Uploaded photo"}</span></div>
          <button className="btn small" onClick={() => fileInput.current.click()}>Replace photo</button>
        </div>
      ) : (
        <div className={`drop ${dragging ? "over" : ""}`}
             onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
             onDragLeave={() => setDragging(false)}
             onDrop={(e) => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files[0]); }}>
          <div className="drop-icon"><Icon name="upload" size={20} /></div>
          <b>Drag a road photo here, or browse</b>
          <span>JPG, PNG or WEBP · phone photos with location turned on also show where they were taken</span>
          <button className="btn primary" onClick={() => fileInput.current.click()}>Browse files</button>
        </div>
      )}
      {samples.length > 0 && (
        <>
          <span className="label samples-title">Or use a sample photo</span>
          <div className="samples">
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
function csvLink(result) {
  const rows = [["Pothole", "Severity", "Danger score", "Confidence %", "Area m2", "Asphalt kg", "Cost", "Repair within"],
    ...result.potholes.map((p) => [p.number, p.level, p.danger, Math.round(p.confidence * 100), p.repair.area_m2, p.repair.asphalt_kg, p.repair.cost, p.repair.repair_within])];
  return "data:text/csv;charset=utf-8," + encodeURIComponent(rows.map((r) => r.join(",")).join("\n"));
}

// ---------------------------------------------------------------
// The page
// ---------------------------------------------------------------
export default function PhotoView({ info, samples, settings, change, details, setDetails, saveDetails, photo, pickPhoto, result, loading, error }) {
  const [view, setView] = useState("Detections");
  const edit = (field) => (e) => setDetails({ ...details, [field]: e.target.value });

  // When a NEW result arrives, scroll down to the report.
  const resultName = result?.file_name;
  useEffect(() => {
    if (resultName) document.getElementById("report")?.scrollIntoView({ behavior: "smooth" });
  }, [resultName]);

  const plan = result?.repair_plan;
  const gps = result?.gps;
  const today = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <div className="grid-main no-print">
        <div className="stack">
          {/* STEP 1 */}
          <div className="card pad">
            <div className="step"><i>1</i><h3>Inspection details</h3><span>optional</span></div>
            <div className="form-grid">
              <label className="field"><span className="label">Road / street</span>
                <input className="input" placeholder="e.g. MG Road, near bus stand" value={details.road_name} onChange={edit("road_name")} onBlur={saveDetails} /></label>
              <label className="field"><span className="label">Ward / zone</span>
                <input className="input" placeholder="e.g. Ward 12" value={details.ward} onChange={edit("ward")} onBlur={saveDetails} /></label>
              <label className="field"><span className="label">Inspector</span>
                <input className="input" placeholder="Your name" value={details.inspector} onChange={edit("inspector")} onBlur={saveDetails} /></label>
            </div>
            <label className="field" style={{ marginTop: 14 }}><span className="label">Notes</span>
              <textarea className="textarea" placeholder="e.g. Water-logged after rain, heavy traffic" value={details.notes} onChange={edit("notes")} onBlur={saveDetails} /></label>
          </div>

          {/* STEP 2 */}
          <div className="card pad">
            <div className="step"><i>2</i><h3>Road photo</h3><span>the AI starts automatically</span></div>
            <PhotoPicker samples={samples} picked={photo} onPick={pickPhoto} />
          </div>
        </div>

        <SettingsCard info={info} settings={settings} change={change} show={["engine", "sensitivity", "confidence"]}>
          <p className="help" style={{ marginTop: 16 }}>The default settings work for most photos. Changes re-check the photo straight away.</p>
        </SettingsCard>
      </div>

      {error && <ErrorBox text={error} />}
      {loading && <Loading text="The AI is checking the road…" />}

      {/* STEP 3: the report */}
      {result && (
        <>
          <div className="print-only">
            <h1 style={{ fontSize: "1.4rem" }}>Road Inspection Report – {inspectionId(result.inspection_id)}</h1>
            <p className="help">Pothole Detection System · printed {today}</p>
          </div>

          <div id="report" className="section-title">
            <h2>Inspection report <span className="id" style={{ marginLeft: 6 }}>{inspectionId(result.inspection_id)}</span></h2>
            <div className="header-actions no-print">
              <button className="btn small" onClick={() => window.print()}><Icon name="print" size={15} />Print / save PDF</button>
              <a className="btn small" href={result.image} download={`${inspectionId(result.inspection_id)}.jpg`}><Icon name="download" size={15} />Marked photo</a>
              {result.count > 0 && <a className="btn small" href={csvLink(result)} download={`${inspectionId(result.inspection_id)}_potholes.csv`}><Icon name="download" size={15} />Pothole list</a>}
            </div>
          </div>

          <div className="card report-head" style={{ marginBottom: 16 }}>
            <div><span>Road</span><b>{details.road_name || "Not given"}</b></div>
            <div><span>Ward / zone</span><b>{details.ward || "–"}</b></div>
            <div><span>Inspector</span><b>{details.inspector || "–"}</b></div>
            <div><span>Date</span><b>{today}</b></div>
            <div><span>Location</span><b>{gps ? <a href={`https://www.google.com/maps?q=${gps.lat},${gps.lon}`} target="_blank" rel="noreferrer">{gps.lat}, {gps.lon}</a> : "No GPS in photo"}</b></div>
            <div><span>Status</span><b><StatusChip status="Open" /></b></div>
          </div>

          <Summary score={result.road_score} stats={[
            { label: "Potholes", value: result.count },
            { label: "Most severe", value: result.count ? result.worst : "None" },
            { label: "Est. repair cost", value: money(plan.total_cost, plan.currency) },
            { label: "Repair within", value: plan.start_within.replace("Within ", "") },
          ]} />

          <div className="grid-main" style={{ marginTop: 20 }}>
            <div className="card pad">
              <div className="card-head">
                <h3>{view === "Detections" ? `${result.count} pothole${result.count === 1 ? "" : "s"} detected` : "Original photo"}</h3>
                <div className="tabs">
                  {["Detections", "Original"].map((v) => <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{v}</button>)}
                </div>
              </div>
              <img className="photo" src={view === "Detections" ? result.image : photo?.url} alt={view} />
              <p className="help">Engine {result.engine} · {result.seconds.toFixed(2)} s · minimum confidence {Math.round(settings.confidence * 100)}%</p>
            </div>
            <div className="stack">
              <div className="card pad"><div className="card-head"><h3>Severity breakdown</h3></div><LevelBars counts={result.counts} /></div>
              {result.count > 0 && <RepairPlan plan={plan} />}
            </div>
          </div>

          {result.count > 0 && (
            <>
              <SectionTitle title="Detected potholes" note="most confident first" />
              <div className="card table">
                <table>
                  <thead><tr><th>#</th><th>Severity</th><th>Danger score</th><th>AI confidence</th><th>Area</th><th>Asphalt</th><th>Repair within</th><th>Est. cost</th></tr></thead>
                  <tbody>
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
          {details.notes && <div className="card pad" style={{ marginTop: 16 }}><span className="label">Notes</span><p style={{ marginTop: 6 }}>{details.notes}</p></div>}
        </>
      )}
    </>
  );
}
