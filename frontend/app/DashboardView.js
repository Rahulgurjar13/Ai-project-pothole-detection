/*
  DashboardView.js  -  the two "management" pages
  ===============================================
  Overview     : big numbers, road-score trend, repair status, severity,
                 and a PRIORITY QUEUE (worst open roads first).
  Inspections  : the full list of inspections. Staff can search, filter by
                 status, change the status (Open -> Scheduled -> Repaired),
                 export to Excel (CSV) and delete.

  The data comes from the server's database (backend/database.py).

  Words used in the notes below:
    component = a reusable piece of the page (a function that returns HTML-like JSX)
    props     = the values given to a component, like <Overview history={...}>
    state     = a value a component remembers; changing it redraws the page
    .map      = do this for every item in the list, and collect the results
    .filter   = keep only the items in the list that pass a test
    SVG       = a picture drawn with code (lines, circles, paths)
    async / await = "wait for the server to answer before going on"
*/
"use client";   // tells Next.js this file runs in the browser (needed because it uses state and clicks)
/* eslint-disable @next/next/no-img-element */
// (the line above switches off a warning that says "use Next's <Image> instead of <img>")
import { useState } from "react";   // useState = React tool to remember a value (state) inside a component
import { clearHistory, deleteScan, updateScan } from "./api";   // functions that talk to the server: delete all, delete one, change one
import { Chip, Empty, ErrorBox, Icon, inspectionId, Kpi, LevelBars, LevelChip, Loading, money, scoreColor, SectionTitle, StatusChip } from "./parts";   // small building blocks from parts.js

const STATUSES = ["Open", "Scheduled", "Repaired"];   // the three repair statuses, in order
const place = (s) => s.road_name || s.name;                     // road name, or the file name if none was typed

// ---------------------------------------------------------------
// Line chart of road scores (oldest -> newest), drawn with SVG.
// ---------------------------------------------------------------
// ScoreChart component. In: scans = list of inspections (newest first, as the server sends them).
// Out: an SVG line chart of the road score of the last 20 inspections, with guide lines at 0, 50 and 100.
function ScoreChart({ scans }) {   // takes the scans prop
  const points = [...scans].reverse().slice(-20);   // copy the list, flip it to oldest -> newest, keep only the last 20
  const W = 640, H = 190, left = 30, pad = 16;   // chart width, height, space on the left for numbers, space around the edges (pixels)
  const x = (i) => left + (i * (W - left - pad)) / Math.max(points.length - 1, 1);   // x position of point number i (spread evenly across the width)
  const y = (v) => H - pad - (v / 100) * (H - 2 * pad);   // y position of a score v (0 = bottom, 100 = top; SVG y grows downwards)
  // build the line's drawing instructions: "M" (move) to the first point, then "L" (line to) every next point, joined with spaces
  const path = points.map((s, i) => `${i ? "L" : "M"}${x(i)},${y(s.road_score)}`).join(" ");
  const color = { green: "var(--green)", amber: "var(--amber)", red: "var(--red)" };   // colour name -> real CSS colour for the dots
  return (   // give back this SVG
    <svg className="chart" viewBox={`0 0 ${W} ${H}`}>
      {/* for each of the values 0, 50 and 100, draw one guide line with its number */}
      {[0, 50, 100].map((v) => (
        <g key={v}>
          {/* dashed horizontal line across the chart at height y(v) */}
          <line x1={left} x2={W - pad} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray="4 4" />
          {/* the number (0/50/100) written at the left edge, small and faint */}
          <text x={0} y={y(v) + 4} fontSize="11" fill="var(--faint)">{v}</text>
        </g>
      ))}
      {/* the score line itself: no fill, 2.5px thick, main theme colour */}
      <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2.5" />
      {/* one dot per inspection, coloured by its score (green/amber/red), with a white edge */}
      {points.map((s, i) => (
        <circle key={s.id} cx={x(i)} cy={y(s.road_score)} r="5" fill={color[scoreColor(s.road_score)]} stroke="#fff" strokeWidth="2">
          {/* <title> = the tooltip shown when the mouse is over the dot, e.g. "INS-0003 MG Road: 64/100" */}
          <title>{`${inspectionId(s.id)} ${place(s)}: ${s.road_score}/100`}</title>
        </circle>
      ))}
    </svg>
  );   // end of return
}   // end of ScoreChart

// =================================================================
// OVERVIEW
// =================================================================
// Overview component: the main dashboard page.
// In: history = data from the server { scans, totals, currency } (empty while loading),
//     error = error text if loading failed, go = function to switch to another page (e.g. go("live")).
// Out: loading/error message, OR a "no inspections" card, OR the full dashboard
//      (4 number cards, score chart, repair status bars, severity bars, priority table).
export function Overview({ history, error, go }) {   // takes the three props
  // no data yet: show the error box if there was an error, otherwise a "Loading..." message
  if (!history) return error ? <ErrorBox text={error} /> : <Loading text="Loading inspections…" />;
  const { scans, totals, currency } = history;   // take the three parts out of history

  if (scans.length === 0) {   // no inspections saved yet
    // show an "empty" card with two buttons to start an inspection
    return (
      <Empty title="No inspections yet" text="Start with a road photo, a video or the live camera. Results appear here automatically.">
        {/* row of buttons, centred */}
        <div className="buttons" style={{ justifyContent: "center" }}>
          {/* button: go to the photo inspection page */}
          <button className="btn primary" onClick={() => go("inspect")}><Icon name="photo" size={16} />Inspect a photo</button>
          {/* button: go to the live camera page */}
          <button className="btn" onClick={() => go("live")}><Icon name="camera" size={16} />Live camera</button>
        </div>
      </Empty>
    );   // end of return
  }   // end of if

  // Priority queue: not yet repaired, with potholes, lowest road score first.
  // .filter keeps not-repaired scans that have potholes, .sort puts the lowest score first, .slice(0, 6) keeps the top 6
  const queue = scans.filter((s) => s.status !== "Repaired" && s.count > 0).sort((a, b) => a.road_score - b.road_score).slice(0, 6);
  const statusCounts = { Open: totals.open, Scheduled: totals.scheduled, Repaired: totals.repaired };   // how many inspections have each status
  const mostStatus = Math.max(...Object.values(statusCounts), 1);   // the biggest of those counts (at least 1, so we never divide by 0)
  const statusColor = { Open: "var(--red)", Scheduled: "var(--amber)", Repaired: "var(--green)" };   // bar colour per status

  return (   // give back this JSX. <> ... </> = a "fragment": groups elements without adding an extra box
    <>
      {/* row of 4 big number cards (Kpi) */}
      <div className="kpis">
        {/* total inspections, note = total potholes found */}
        <Kpi icon="list" color="blue" label="Inspections" value={totals.scans} note={`${totals.potholes} potholes found`} />
        {/* open cases, note = how many scheduled and repaired */}
        <Kpi icon="alert" color="red" label="Open cases" value={totals.open} note={`${totals.scheduled} scheduled · ${totals.repaired} repaired`} />
        {/* critical potholes that are not repaired yet */}
        <Kpi icon="road" color="amber" label="Critical, not repaired" value={totals.open_critical} note="repair within 24 hours" />
        {/* total estimated cost of the repairs not done yet, written as money */}
        <Kpi icon="money" color="green" label="Repair backlog" value={money(totals.open_cost, currency)} note="estimated, not yet repaired" />
      </div>

      {/* main grid (chart on the left, two small cards on the right), 20px gap above */}
      <div className="grid-main" style={{ marginTop: 20 }}>
        {/* card with the score chart */}
        <div className="card pad">
          {/* heading + small text: how many inspections the chart shows (max 20) and the average score */}
          <div className="card-head"><h3>Road condition index</h3><span className="sub">last {Math.min(scans.length, 20)} inspections · average {totals.average_score}/100</span></div>
          {/* the line chart (component above) */}
          <ScoreChart scans={scans} />
        </div>
        {/* the right column: cards stacked on top of each other */}
        <div className="stack">
          {/* card: repair status bars */}
          <div className="card pad">
            {/* card heading */}
            <div className="card-head"><h3>Repair status</h3></div>
            {/* box holding the rows of bars */}
            <div className="levels">
              {/* .map = one row for every status (Open, Scheduled, Repaired) */}
              {STATUSES.map((s) => (
                <div className="level-row" key={s}>
                  {/* status name */}
                  <span>{s}</span>
                  {/* bar: the coloured <i> part's width = this count compared to the biggest count, in % */}
                  <div className="bar"><i style={{ width: `${(100 * statusCounts[s]) / mostStatus}%`, background: statusColor[s] }} /></div>
                  {/* the number */}
                  <b>{statusCounts[s]}</b>
                </div>
              ))}
            </div>
          </div>
          {/* card: potholes per severity level */}
          <div className="card pad">
            {/* card heading */}
            <div className="card-head"><h3>Potholes by severity</h3></div>
            {/* coloured bars per level (from parts.js), given the count of each level */}
            <LevelBars counts={{ Low: totals.low, Medium: totals.medium, High: totals.high, Critical: totals.critical }} />
          </div>
        </div>
      </div>

      {/* heading "Priority queue" with a button on the right */}
      <SectionTitle title="Priority queue">
        {/* button: go to the Inspections page */}
        <button className="btn small" onClick={() => go("inspections")}>View all inspections</button>
      </SectionTitle>
      {/* if the queue is empty, show a "Nothing to repair" card; otherwise show the table */}
      {queue.length === 0 ? <Empty title="Nothing to repair" text="All inspected roads are repaired or have no potholes." /> : (
        <div className="card table">
          <table>
            {/* table header row: the column names (th = header cell, tr = table row) */}
            <thead><tr><th>#</th><th>Inspection</th><th>Road / ward</th><th>Worst</th><th>Road index</th><th>Est. cost</th><th>Status</th></tr></thead>
            {/* table body: the data rows */}
            <tbody>
              {/* .map = one row for every inspection in the queue; i = its position (0, 1, 2...) */}
              {queue.map((s, i) => (
                <tr key={s.id}>
                  {/* rank number: position + 1 (so it starts at 1) */}
                  <td>{i + 1}</td>
                  {/* inspection id like INS-0007 */}
                  <td><span className="id">{inspectionId(s.id)}</span></td>
                  {/* road name in bold, then ward ("–" if empty) and date in small text */}
                  <td><b>{place(s)}</b><div className="help" style={{ margin: 0 }}>{s.ward || "–"} · {s.created}</div></td>
                  {/* worst severity found, as a coloured chip */}
                  <td><LevelChip level={s.worst} /></td>
                  {/* road score as a coloured chip, e.g. "42/100" */}
                  <td><Chip color={scoreColor(s.road_score)}>{s.road_score}/100</Chip></td>
                  {/* estimated repair cost as money */}
                  <td>{money(s.repair_cost, currency)}</td>
                  {/* repair status as a coloured chip */}
                  <td><StatusChip status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );   // end of return
}   // end of Overview

// =================================================================
// INSPECTIONS
// =================================================================
// exportCsv: makes a CSV file (a table as plain text that Excel can open) and downloads it.
// In: rows = the list of inspections to save. Out: nothing is returned; the browser downloads "inspections_YYYY-MM-DD.csv".
function exportCsv(rows) {   // takes the rows
  const head = ["Inspection", "Date", "Road", "Ward", "Inspector", "Type", "Potholes", "Worst", "Road index", "Estimated cost", "Status", "Latitude", "Longitude", "Notes"];   // column names (first line of the file)
  // .map = for every inspection, make a list of its values in the same order as the column names
  const lines = rows.map((s) => [inspectionId(s.id), s.created, place(s), s.ward, s.inspector, s.kind, s.count, s.worst,
    s.road_score, s.repair_cost, s.status, s.lat ?? "", s.lon ?? "", s.notes]);   // "?? ''" = use empty text if there is no latitude/longitude
  // turn everything into text: put each value in "quotes" (a " inside becomes ""), join values with commas, join rows with new lines (\n)
  const text = [head, ...lines].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const link = document.createElement("a");   // make an invisible link element
  link.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));   // Blob = the text packed as a file; createObjectURL gives it a temporary address
  link.download = `inspections_${new Date().toISOString().slice(0, 10)}.csv`;   // file name with today's date (first 10 letters of the date = YYYY-MM-DD)
  link.click();   // "click" the link by code, which starts the download
}   // end of exportCsv

// Inspections component: the page with the full list of inspections.
// In: history = data from the server { scans, currency }, error = error text if loading failed,
//     refresh = function that loads the list again from the server.
// Out: a card with a search box, status tabs, export/delete buttons and a table of inspections
//      (each row lets the user change the status, open the map, or delete it).
export function Inspections({ history, error, refresh }) {   // takes the three props
  const [search, setSearch] = useState("");   // state: the text typed in the search box (starts empty); setSearch changes it
  const [filter, setFilter] = useState("All");   // state: the chosen status tab (starts at "All"); setFilter changes it
  // no data yet: show the error box if there was an error, otherwise a "Loading..." message
  if (!history) return error ? <ErrorBox text={error} /> : <Loading text="Loading inspections…" />;
  const { scans, currency } = history;   // take the list and the currency sign out of history

  // keep the rows that match the status tab AND the search text
  const words = search.toLowerCase();   // search text in small letters (so "MG" and "mg" both match)
  const rows = scans.filter((s) => (filter === "All" || s.status === filter) &&   // status matches the tab ("All" lets everything through) AND...
    [inspectionId(s.id), s.road_name, s.ward, s.inspector, s.name].join(" ").toLowerCase().includes(words));   // ...the id/road/ward/inspector/file name contains the search text
  const count = (st) => scans.filter((s) => st === "All" || s.status === st).length;   // how many inspections have status st (for the tab labels)

  const setStatus = async (id, status) => { await updateScan(id, { status }); refresh(); };   // save a new status on the server, then reload the list
  // ask "Delete INS-0007?"; if the user says OK, delete it on the server, then reload the list
  const remove = async (id) => { if (window.confirm(`Delete ${inspectionId(id)}?`)) { await deleteScan(id); refresh(); } };
  // ask before deleting everything; if OK, delete all inspections on the server, then reload the list
  const removeAll = async () => { if (window.confirm("Delete ALL inspections? This cannot be undone.")) { await clearHistory(); refresh(); } };

  return (   // give back this JSX
    <div className="card">
      {/* toolbar at the top: search box, status tabs, buttons */}
      <div className="toolbar">
        {/* search box: shows the "search" state; every key press (onChange) saves the new text with setSearch */}
        <input className="input" placeholder="Search inspection, road, ward, inspector…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {/* the status tabs */}
        <div className="tabs">
          {/* one button for "All" and each status. The chosen tab gets class "on" (highlighted). Click = choose that tab. Label shows the count, e.g. "Open (4)" */}
          {["All", ...STATUSES].map((st) => (
            <button key={st} className={filter === st ? "on" : ""} onClick={() => setFilter(st)}>{st} ({count(st)})</button>
          ))}
        </div>
        {/* buttons pushed to the right side (marginLeft auto), 8px apart */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {/* export button: disabled when no rows are shown; click = download the shown rows as CSV */}
          <button className="btn small" disabled={!rows.length} onClick={() => exportCsv(rows)}><Icon name="download" size={15} />Export to Excel (CSV)</button>
          {/* red "Delete all" button: disabled when there are no inspections at all */}
          <button className="btn small danger" disabled={!scans.length} onClick={removeAll}>Delete all</button>
        </div>
      </div>

      {/* if no rows match, show "No inspections found" in bold plus a hint ("try another search" if there are inspections,
          "run a new inspection" if there are none); otherwise show the table */}
      {rows.length === 0 ? (
        <div className="empty"><b>No inspections found</b>{scans.length ? "Try another search or status." : "Run a new inspection to get started."}</div>
      ) : (
        <div className="table">
          <table>
            {/* table header row: the column names (the last one is empty, for the delete button) */}
            <thead><tr><th>Inspection</th><th>Photo</th><th>Road / ward</th><th>Date</th><th>Inspector</th><th>Potholes</th><th>Worst</th><th>Road index</th><th>Est. cost</th><th>Status</th><th>Map</th><th></th></tr></thead>
            {/* table body: the data rows */}
            <tbody>
              {/* .map = one table row for every matching inspection */}
              {rows.map((s) => (
                <tr key={s.id}>
                  {/* inspection id, with its type (s.kind) in small text below */}
                  <td><span className="id">{inspectionId(s.id)}</span><div className="help" style={{ margin: 0 }}>{s.kind}</div></td>
                  {/* small preview picture (thumbnail); alt="" because it is only decoration */}
                  <td><img className="thumb" src={s.thumbnail} alt="" /></td>
                  {/* road name in bold, ward below ("–" if empty) */}
                  <td><b>{place(s)}</b><div className="help" style={{ margin: 0 }}>{s.ward || "–"}</div></td>
                  {/* date, kept on one line (nowrap) */}
                  <td style={{ whiteSpace: "nowrap" }}>{s.created}</td>
                  {/* inspector name, or "–" if empty */}
                  <td>{s.inspector || "–"}</td>
                  {/* number of potholes */}
                  <td>{s.count}</td>
                  {/* worst severity as a coloured chip */}
                  <td><LevelChip level={s.worst} /></td>
                  {/* road score as a coloured chip */}
                  <td><Chip color={scoreColor(s.road_score)}>{s.road_score}/100</Chip></td>
                  {/* estimated repair cost as money */}
                  <td>{money(s.repair_cost, currency)}</td>
                  {/* status cell */}
                  <td>
                    {/* dropdown with the current status (its class gives it the status colour); picking another calls setStatus to save it */}
                    <select className={`status-select ${s.status}`} value={s.status} onChange={(e) => setStatus(s.id, e.target.value)}>
                      {/* one <option> for each status */}
                      {STATUSES.map((st) => <option key={st}>{st}</option>)}
                    </select>
                  </td>
                  {/* map cell: if the inspection has a location (lat not empty), show an "Open" link to Google Maps in a new tab; otherwise a grey "–" */}
                  <td>{s.lat != null ? <a href={`https://www.google.com/maps?q=${s.lat},${s.lon}`} target="_blank" rel="noreferrer">Open</a> : <span className="muted">–</span>}</td>
                  {/* delete button with a dustbin icon; click = ask and delete this inspection */}
                  <td><button className="icon-btn" title="Delete" onClick={() => remove(s.id)}><Icon name="trash" size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );   // end of return
}   // end of Inspections
