/*
  DashboardView.js  -  the two "management" pages
  ===============================================
  Overview     : big numbers, road-score trend, repair status, severity,
                 and a PRIORITY QUEUE (worst open roads first).
  Inspections  : the full list of inspections. Staff can search, filter by
                 status, change the status (Open -> Scheduled -> Repaired),
                 export to Excel (CSV) and delete.

  The data comes from the server's database (backend/database.py).
*/
"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { clearHistory, deleteScan, updateScan } from "./api";
import { Chip, Empty, ErrorBox, Icon, inspectionId, Kpi, LevelBars, LevelChip, Loading, money, scoreColor, SectionTitle, StatusChip } from "./parts";

const STATUSES = ["Open", "Scheduled", "Repaired"];
const place = (s) => s.road_name || s.name;                     // road name, or the file name if none was typed

// ---------------------------------------------------------------
// Line chart of road scores (oldest -> newest), drawn with SVG.
// ---------------------------------------------------------------
function ScoreChart({ scans }) {
  const points = [...scans].reverse().slice(-20);
  const W = 640, H = 190, left = 30, pad = 16;
  const x = (i) => left + (i * (W - left - pad)) / Math.max(points.length - 1, 1);
  const y = (v) => H - pad - (v / 100) * (H - 2 * pad);
  const path = points.map((s, i) => `${i ? "L" : "M"}${x(i)},${y(s.road_score)}`).join(" ");
  const color = { green: "var(--green)", amber: "var(--amber)", red: "var(--red)" };
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`}>
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={left} x2={W - pad} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray="4 4" />
          <text x={0} y={y(v) + 4} fontSize="11" fill="var(--faint)">{v}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2.5" />
      {points.map((s, i) => (
        <circle key={s.id} cx={x(i)} cy={y(s.road_score)} r="5" fill={color[scoreColor(s.road_score)]} stroke="#fff" strokeWidth="2">
          <title>{`${inspectionId(s.id)} ${place(s)}: ${s.road_score}/100`}</title>
        </circle>
      ))}
    </svg>
  );
}

// =================================================================
// OVERVIEW
// =================================================================
export function Overview({ history, error, go }) {
  if (!history) return error ? <ErrorBox text={error} /> : <Loading text="Loading inspections…" />;
  const { scans, totals, currency } = history;

  if (scans.length === 0) {
    return (
      <Empty title="No inspections yet" text="Start with a road photo, a video or the live camera. Results appear here automatically.">
        <div className="buttons" style={{ justifyContent: "center" }}>
          <button className="btn primary" onClick={() => go("inspect")}><Icon name="photo" size={16} />Inspect a photo</button>
          <button className="btn" onClick={() => go("live")}><Icon name="camera" size={16} />Live camera</button>
        </div>
      </Empty>
    );
  }

  // Priority queue: not yet repaired, with potholes, lowest road score first.
  const queue = scans.filter((s) => s.status !== "Repaired" && s.count > 0).sort((a, b) => a.road_score - b.road_score).slice(0, 6);
  const statusCounts = { Open: totals.open, Scheduled: totals.scheduled, Repaired: totals.repaired };
  const mostStatus = Math.max(...Object.values(statusCounts), 1);
  const statusColor = { Open: "var(--red)", Scheduled: "var(--amber)", Repaired: "var(--green)" };

  return (
    <>
      <div className="kpis">
        <Kpi icon="list" color="blue" label="Inspections" value={totals.scans} note={`${totals.potholes} potholes found`} />
        <Kpi icon="alert" color="red" label="Open cases" value={totals.open} note={`${totals.scheduled} scheduled · ${totals.repaired} repaired`} />
        <Kpi icon="road" color="amber" label="Critical, not repaired" value={totals.open_critical} note="repair within 24 hours" />
        <Kpi icon="money" color="green" label="Repair backlog" value={money(totals.open_cost, currency)} note="estimated, not yet repaired" />
      </div>

      <div className="grid-main" style={{ marginTop: 20 }}>
        <div className="card pad">
          <div className="card-head"><h3>Road condition index</h3><span className="sub">last {Math.min(scans.length, 20)} inspections · average {totals.average_score}/100</span></div>
          <ScoreChart scans={scans} />
        </div>
        <div className="stack">
          <div className="card pad">
            <div className="card-head"><h3>Repair status</h3></div>
            <div className="levels">
              {STATUSES.map((s) => (
                <div className="level-row" key={s}>
                  <span>{s}</span>
                  <div className="bar"><i style={{ width: `${(100 * statusCounts[s]) / mostStatus}%`, background: statusColor[s] }} /></div>
                  <b>{statusCounts[s]}</b>
                </div>
              ))}
            </div>
          </div>
          <div className="card pad">
            <div className="card-head"><h3>Potholes by severity</h3></div>
            <LevelBars counts={{ Low: totals.low, Medium: totals.medium, High: totals.high, Critical: totals.critical }} />
          </div>
        </div>
      </div>

      <SectionTitle title="Priority queue">
        <button className="btn small" onClick={() => go("inspections")}>View all inspections</button>
      </SectionTitle>
      {queue.length === 0 ? <Empty title="Nothing to repair" text="All inspected roads are repaired or have no potholes." /> : (
        <div className="card table">
          <table>
            <thead><tr><th>#</th><th>Inspection</th><th>Road / ward</th><th>Worst</th><th>Road index</th><th>Est. cost</th><th>Status</th></tr></thead>
            <tbody>
              {queue.map((s, i) => (
                <tr key={s.id}>
                  <td>{i + 1}</td>
                  <td><span className="id">{inspectionId(s.id)}</span></td>
                  <td><b>{place(s)}</b><div className="help" style={{ margin: 0 }}>{s.ward || "–"} · {s.created}</div></td>
                  <td><LevelChip level={s.worst} /></td>
                  <td><Chip color={scoreColor(s.road_score)}>{s.road_score}/100</Chip></td>
                  <td>{money(s.repair_cost, currency)}</td>
                  <td><StatusChip status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// =================================================================
// INSPECTIONS
// =================================================================
function exportCsv(rows) {
  const head = ["Inspection", "Date", "Road", "Ward", "Inspector", "Type", "Potholes", "Worst", "Road index", "Estimated cost", "Status", "Latitude", "Longitude", "Notes"];
  const lines = rows.map((s) => [inspectionId(s.id), s.created, place(s), s.ward, s.inspector, s.kind, s.count, s.worst,
    s.road_score, s.repair_cost, s.status, s.lat ?? "", s.lon ?? "", s.notes]);
  const text = [head, ...lines].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  link.download = `inspections_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

export function Inspections({ history, error, refresh }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  if (!history) return error ? <ErrorBox text={error} /> : <Loading text="Loading inspections…" />;
  const { scans, currency } = history;

  // keep the rows that match the status tab AND the search text
  const words = search.toLowerCase();
  const rows = scans.filter((s) => (filter === "All" || s.status === filter) &&
    [inspectionId(s.id), s.road_name, s.ward, s.inspector, s.name].join(" ").toLowerCase().includes(words));
  const count = (st) => scans.filter((s) => st === "All" || s.status === st).length;

  const setStatus = async (id, status) => { await updateScan(id, { status }); refresh(); };
  const remove = async (id) => { if (window.confirm(`Delete ${inspectionId(id)}?`)) { await deleteScan(id); refresh(); } };
  const removeAll = async () => { if (window.confirm("Delete ALL inspections? This cannot be undone.")) { await clearHistory(); refresh(); } };

  return (
    <div className="card">
      <div className="toolbar">
        <input className="input" placeholder="Search inspection, road, ward, inspector…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="tabs">
          {["All", ...STATUSES].map((st) => (
            <button key={st} className={filter === st ? "on" : ""} onClick={() => setFilter(st)}>{st} ({count(st)})</button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn small" disabled={!rows.length} onClick={() => exportCsv(rows)}><Icon name="download" size={15} />Export to Excel (CSV)</button>
          <button className="btn small danger" disabled={!scans.length} onClick={removeAll}>Delete all</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty"><b>No inspections found</b>{scans.length ? "Try another search or status." : "Run a new inspection to get started."}</div>
      ) : (
        <div className="table">
          <table>
            <thead><tr><th>Inspection</th><th>Photo</th><th>Road / ward</th><th>Date</th><th>Inspector</th><th>Potholes</th><th>Worst</th><th>Road index</th><th>Est. cost</th><th>Status</th><th>Map</th><th></th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td><span className="id">{inspectionId(s.id)}</span><div className="help" style={{ margin: 0 }}>{s.kind}</div></td>
                  <td><img className="thumb" src={s.thumbnail} alt="" /></td>
                  <td><b>{place(s)}</b><div className="help" style={{ margin: 0 }}>{s.ward || "–"}</div></td>
                  <td style={{ whiteSpace: "nowrap" }}>{s.created}</td>
                  <td>{s.inspector || "–"}</td>
                  <td>{s.count}</td>
                  <td><LevelChip level={s.worst} /></td>
                  <td><Chip color={scoreColor(s.road_score)}>{s.road_score}/100</Chip></td>
                  <td>{money(s.repair_cost, currency)}</td>
                  <td>
                    <select className={`status-select ${s.status}`} value={s.status} onChange={(e) => setStatus(s.id, e.target.value)}>
                      {STATUSES.map((st) => <option key={st}>{st}</option>)}
                    </select>
                  </td>
                  <td>{s.lat != null ? <a href={`https://www.google.com/maps?q=${s.lat},${s.lon}`} target="_blank" rel="noreferrer">Open</a> : <span className="muted">–</span>}</td>
                  <td><button className="icon-btn" title="Delete" onClick={() => remove(s.id)}><Icon name="trash" size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
