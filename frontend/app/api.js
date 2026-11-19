/*
  api.js  -  talks to the Python server
  =====================================
  The website never runs the AI itself. It sends the photo/video to the
  Python server (backend/server.py) and shows the answer.
*/

// Normally the website and the API are on the same address (http://localhost:8000),
// so API = "". Only while developing with "npm run dev" (port 3000) we call port 8000.
export const API = typeof window !== "undefined" && window.location.port === "3000" ? "http://localhost:8000" : "";

const NOT_RUNNING = "Cannot reach the Python server. Start the project with ./start.sh";

// Send a form to the API and return the JSON answer (or throw a readable error).
async function post(path, form, signal) {
  let response;
  try {
    response = await fetch(API + path, { method: "POST", body: form, signal });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(NOT_RUNNING);
  }
  if (path === "/api/video") return response;          // the video answer is read line by line
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "Something went wrong.");
  return data;
}

// Make the form. photo = { kind: "sample", name } or { kind: "upload", file }
function makeForm(photo, values) {
  const form = new FormData();
  if (photo?.kind === "upload") form.append("file", photo.file);
  if (photo?.kind === "sample") form.append("sample", photo.name);
  for (const [key, value] of Object.entries(values)) form.append(key, String(value));
  return form;
}

// Engines, sensitivity presets, ... + the list of sample photos.
export async function loadStart() {
  try {
    const [info, samples] = await Promise.all([
      fetch(API + "/api/info").then((r) => r.json()),
      fetch(API + "/api/samples").then((r) => r.json()),
    ]);
    return { info, samples: samples.map((s) => ({ ...s, url: API + s.url })) };
  } catch {
    throw new Error(NOT_RUNNING);
  }
}

// Check one photo with one engine. details = { road_name, ward, inspector, notes } (saved with the inspection)
export const analyzePhoto = (photo, { engine, confidence, roadCheck }, details = {}) =>
  post("/api/analyze", makeForm(photo, { engine, confidence, road_check: roadCheck, ...details }));

// Check one photo with every engine.
export const comparePhoto = (photo, { confidence, roadCheck }) =>
  post("/api/compare", makeForm(photo, { confidence, road_check: roadCheck }));

/*
  Check a video. The server answers LIVE: one line of JSON per checked frame.
  onLine() is called for each line so the page updates while the video runs.
  signal lets the Stop button cancel it.
*/
export async function analyzeVideo(file, { everyNth, confidence, roadCheck }, onLine, signal) {
  const form = makeForm({ kind: "upload", file }, { every_nth: everyNth, confidence, road_check: roadCheck });
  const response = await post("/api/video", form, signal);
  if (!response.ok) throw new Error("The video could not be checked.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
    const lines = rest.split("\n");
    rest = lines.pop();                       // last piece may be half a line: keep it
    lines.filter(Boolean).forEach((line) => onLine(JSON.parse(line)));
  }
}

// ---------------------------------------------------------------
// Live camera: send ONE camera frame (a JPEG blob). Not saved in the history.
// ---------------------------------------------------------------
export function analyzeFrame(blob, { confidence, roadCheck }, signal) {
  const form = new FormData();
  form.append("file", blob, "frame.jpg");
  form.append("live", "true");
  form.append("confidence", String(confidence));
  form.append("road_check", String(roadCheck));
  return post("/api/analyze", form, signal);
}

// Save a camera snapshot as a normal scan (it appears in the Dashboard).
export function saveSnapshot(blob, { confidence, roadCheck }) {
  const form = new FormData();
  form.append("file", blob, `camera_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.jpg`);
  form.append("engine", "YOLOv8s");
  form.append("source", "camera");
  form.append("confidence", String(confidence));
  form.append("road_check", String(roadCheck));
  return post("/api/analyze", form);
}

// ---------------------------------------------------------------
// Inspections: saved history
// ---------------------------------------------------------------
export async function getHistory() {
  const response = await fetch(API + "/api/history").catch(() => null);
  if (!response?.ok) throw new Error(NOT_RUNNING);
  return response.json();
}
// Change the status (Open / Scheduled / Repaired) or details of one inspection.
export const updateScan = (id, changes) =>
  fetch(`${API}/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
export const deleteScan = (id) => fetch(`${API}/api/history/${id}`, { method: "DELETE" });
export const clearHistory = () => fetch(`${API}/api/history`, { method: "DELETE" });
