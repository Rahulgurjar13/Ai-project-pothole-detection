/*
  api.js  -  talks to the Python server
  =====================================
  The website never runs the AI itself. It sends the photo/video to the
  Python server (backend/server.py) and shows the answer.

  Words used in this file (simple meaning):
    fetch       = ask the server something over the network (like opening a web address from code)
    async/await = "wait for the answer" without freezing the page
    Promise     = a value that will arrive later (the server's answer)
    FormData    = a bag of fields + files, the same thing an HTML <form> sends
    JSON        = the text format the server uses for its answers ({ "key": value })
    export      = make this thing usable from other files (they "import" it)
    signal      = a remote control that can cancel a running request (used by Stop buttons)
*/

// Normally the website and the API are on the same address (http://localhost:8000),
// so API = "". Only while developing with "npm run dev" (port 3000) we call port 8000.
// typeof window !== "undefined" = "are we running inside a browser?" (on the server there is no window)
// a ? b : c = if a is true use b, otherwise use c
export const API = typeof window !== "undefined" && window.location.port === "3000" ? "http://localhost:8000" : "";

// The error text shown when the Python server cannot be reached at all.
const NOT_RUNNING = "Cannot reach the Python server. Start the project with ./start.sh";

// Send a form to the API and return the JSON answer (or throw a readable error).
// In:  path = server address part like "/api/analyze", form = FormData to send, signal = optional cancel remote.
// Out: the server's answer as a JS object (for "/api/video" the raw response, so it can be read line by line).
async function post(path, form, signal) {
  let response;                                        // will hold the server's reply
  try {                                                // try = run this; if it fails jump to catch
    response = await fetch(API + path, { method: "POST", body: form, signal }); // POST = send data to the server and wait
  } catch (error) {                                    // fetch failed (no network / server off / cancelled)
    if (error.name === "AbortError") throw error;      // the user pressed Stop: pass that on unchanged
    throw new Error(NOT_RUNNING);                      // otherwise the server is not running: give a clear message
  }
  if (path === "/api/video") return response;          // the video answer is read line by line
  const data = await response.json().catch(() => ({})); // turn the JSON text into an object; if it is not JSON use {}
  if (!response.ok) throw new Error(data.detail || "Something went wrong."); // ok = status 200-299; else show server's error
  return data;                                         // give the answer back to whoever called post()
}

// Make the form. photo = { kind: "sample", name } or { kind: "upload", file }
// In:  photo (sample name or uploaded file) and values = extra settings like { engine, confidence }.
// Out: a FormData ready to send to the server.
function makeForm(photo, values) {
  const form = new FormData();                                        // empty form
  if (photo?.kind === "upload") form.append("file", photo.file);      // ?. = "only if photo exists"; add the user's own file
  if (photo?.kind === "sample") form.append("sample", photo.name);    // or just the name of a built-in sample photo
  for (const [key, value] of Object.entries(values)) form.append(key, String(value)); // add every setting as text
  return form;                                                        // give the filled form back
}

// Engines, sensitivity presets, ... + the list of sample photos.
// In:  nothing. Out: { info, samples } - asked from the server when the app opens.
export async function loadStart() {
  try {
    // Promise.all = ask both questions at the same time and wait until both answers arrive
    const [info, samples] = await Promise.all([
      fetch(API + "/api/info").then((r) => r.json()),     // settings info (engines, presets, prices...)
      fetch(API + "/api/samples").then((r) => r.json()),  // list of sample photos
    ]);
    // ...s = copy all fields of s; then make each photo's url a full address
    return { info, samples: samples.map((s) => ({ ...s, url: API + s.url })) };
  } catch {                                               // any failure here means the server is not reachable
    throw new Error(NOT_RUNNING);                         // throw = stop and report this error to the caller
  }
}

// Check one photo with one engine. details = { road_name, ward, inspector, notes } (saved with the inspection)
// In:  photo, the AI settings, and optional road details. Out: the server's result (potholes, scores, repair estimate).
// "=>" = arrow function, a short way to write a function; { engine, confidence, roadCheck } picks these fields out of settings
export const analyzePhoto = (photo, { engine, confidence, roadCheck }, details = {}) =>
  post("/api/analyze", makeForm(photo, { engine, confidence, road_check: roadCheck, ...details })); // send photo + settings + details

// Check one photo with every engine.
// In:  photo and settings. Out: the results of all AI engines, for the Model comparison page.
export const comparePhoto = (photo, { confidence, roadCheck }) =>
  post("/api/compare", makeForm(photo, { confidence, road_check: roadCheck })); // no engine: the server runs all of them

/*
  Check a video. The server answers LIVE: one line of JSON per checked frame.
  onLine() is called for each line so the page updates while the video runs.
  signal lets the Stop button cancel it.
  In:  file = the video, everyNth = check every Nth frame, confidence, roadCheck, onLine, signal.
  Out: nothing returned; results are handed to onLine() one by one.
*/
export async function analyzeVideo(file, { everyNth, confidence, roadCheck }, onLine, signal) {
  const form = makeForm({ kind: "upload", file }, { every_nth: everyNth, confidence, road_check: roadCheck }); // build the form
  const response = await post("/api/video", form, signal);              // send it; get the raw (streaming) reply
  if (!response.ok) throw new Error("The video could not be checked."); // server said no -> show an error

  const reader = response.body.getReader();  // a reader lets us take the answer piece by piece as it arrives
  const decoder = new TextDecoder();         // turns raw bytes into normal text
  let rest = "";                             // text received but not yet split into full lines
  while (true) {                             // keep reading until the server is finished
    const { done, value } = await reader.read();    // wait for the next piece; done = true when nothing is left
    if (done) break;                                // finished -> leave the loop
    rest += decoder.decode(value, { stream: true }); // add the new text to what we already have
    const lines = rest.split("\n");                 // cut the text into lines (one line = one frame's result)
    rest = lines.pop();                       // last piece may be half a line: keep it
    lines.filter(Boolean).forEach((line) => onLine(JSON.parse(line))); // skip empty lines; turn each into an object; give it to the page
  }
}

// ---------------------------------------------------------------
// Live camera: send ONE camera frame (a JPEG blob). Not saved in the history.
// In:  blob = one picture from the camera (blob = raw file data in memory), settings, signal.
// Out: the server's result for that picture.
// ---------------------------------------------------------------
export function analyzeFrame(blob, { confidence, roadCheck }, signal) {
  const form = new FormData();                       // empty form
  form.append("file", blob, "frame.jpg");            // the picture, with a file name
  form.append("live", "true");                       // tells the server: live frame, do not save it
  form.append("confidence", String(confidence));     // how sure the AI must be to count a pothole
  form.append("road_check", String(roadCheck));      // whether to ignore boxes that are not on the road
  return post("/api/analyze", form, signal);         // send it and return the answer (a Promise)
}

// Save a camera snapshot as a normal scan (it appears in the Dashboard).
// In:  blob = the camera picture, settings. Out: the saved inspection result.
export function saveSnapshot(blob, { confidence, roadCheck }) {
  const form = new FormData();                       // empty form
  // file name like camera_2026-01-31-10-15-00.jpg: current time, ":" and "T" replaced by "-"
  form.append("file", blob, `camera_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.jpg`);
  form.append("engine", "YOLOv8s");                  // always use the YOLOv8s AI engine for snapshots
  form.append("source", "camera");                   // mark where the photo came from
  form.append("confidence", String(confidence));     // AI confidence setting
  form.append("road_check", String(roadCheck));      // road check on/off
  return post("/api/analyze", form);                 // no "live" field -> the server saves it in the history
}

// ---------------------------------------------------------------
// Inspections: saved history
// ---------------------------------------------------------------
// Get every saved inspection. In: nothing. Out: the history object from the server (list + totals).
export async function getHistory() {
  const response = await fetch(API + "/api/history").catch(() => null); // ask the server; if it fails use null
  if (!response?.ok) throw new Error(NOT_RUNNING);                     // no answer or a bad answer -> error
  return response.json();                                              // turn the JSON text into an object
}
// Change the status (Open / Scheduled / Repaired) or details of one inspection.
// In: id = which inspection, changes = the fields to change. Out: the server's reply (a Promise).
// PATCH = "change part of a saved thing"; JSON.stringify = turn the object into JSON text to send
export const updateScan = (id, changes) =>
  fetch(`${API}/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
// Delete one inspection. In: id. Out: the server's reply. (DELETE = remove it on the server)
export const deleteScan = (id) => fetch(`${API}/api/history/${id}`, { method: "DELETE" });
// Delete ALL inspections. In: nothing. Out: the server's reply.
export const clearHistory = () => fetch(`${API}/api/history`, { method: "DELETE" });
