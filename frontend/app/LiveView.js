/*
  LiveView.js  -  the "Live camera" page: real-time pothole detection
  ===================================================================
  Why it is smooth:
    - The camera video is shown DIRECTLY (full speed, no waiting).
    - In the background we send a small copy of the current picture (512 px) to
      the server. It answers with only the BOX POSITIONS (a few numbers, no picture).
    - We draw those boxes on a transparent layer ON TOP of the video.
    - The next picture is sent as soon as the answer arrives (max 6 per second,
      one at a time) - fast, but the computer never gets overloaded.
  "Save as inspection" sends a full-size picture and stores it in Inspections.

  Demo tip: hold a phone or a printed photo of a pothole in front of the webcam.
*/
"use client"; // tells Next.js: this file runs in the browser (it needs the camera, clicks and state)
import { useEffect, useRef, useState } from "react"; // React tools: useEffect = run code when the page appears/leaves, useRef = a box that keeps a value between renders, useState = a value that redraws the page when changed
import { analyzeFrame, saveSnapshot } from "./api"; // analyzeFrame = send one camera picture to the AI; saveSnapshot = save a picture as an inspection (see api.js)
import { Chip, ErrorBox, inspectionId, LevelBars, scoreColor, SettingsCard } from "./parts"; // shared screen pieces and helpers (see parts.js)

const MAX_CHECKS_PER_SECOND = 6;   // more = faster updates but a warmer computer
const SEND_WIDTH = 512;            // size of the picture sent to the AI (small = fast)
const BOX_COLOR = { Low: "#16a34a", Medium: "#ca8a04", High: "#ea580c", Critical: "#dc2626" }; // box colour per danger level: green, yellow, orange, red

/*
  LiveView = the whole "Live camera" page (a React component = a function that returns screen markup).
  Props (inputs from page.js):
    info     = details from the server (sensitivity presets, ...)
    settings = the current AI settings (confidence, roadCheck, ...)
    change   = function to change those settings
    onSaved  = function we call after a snapshot is saved, so the Inspections list reloads
  Output: the page markup (camera box with drawn boxes, buttons, live numbers and settings).
*/
export default function LiveView({ info, settings, change, onSaved }) {
  const video = useRef(null);       // the camera video (shown to the user)
  const layer = useRef(null);       // transparent canvas on top, for the boxes
  const running = useRef(false);    // may the loop continue?
  const latest = useRef(settings);  // newest settings, read inside the loop
  latest.current = settings;        // on every redraw, store the newest settings (the running loop reads them from here)

  const [on, setOn] = useState(false);          // is the camera on? (redraws the page when it changes)
  const [result, setResult] = useState(null);   // latest answer (boxes + numbers)
  const [rate, setRate] = useState(0);          // AI updates per second
  const [ratio, setRatio] = useState(4 / 3);    // shape of the camera picture
  const [error, setError] = useState("");       // error text to show ("" = no error)
  const [message, setMessage] = useState("");   // green "saved" message ("" = none)

  // Copy the current camera picture into a JPEG (width = how big).
  // Input: width (max width in pixels) and quality (0..1, higher = sharper but bigger). Output: a Blob (= a file kept in memory).
  function grab(width, quality) {
    const v = video.current; // the <video> element showing the camera
    // canvas = a drawing area on the page; this one is made in memory only, never shown
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(width, v.videoWidth); // use the wanted width, but never bigger than the real camera picture
    canvas.height = Math.round((v.videoHeight * canvas.width) / v.videoWidth); // height that keeps the same shape (no stretching)
    canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height); // getContext("2d") = the pen for drawing; drawImage copies the current video picture onto the canvas
    // toDataURL makes the JPEG straight away (toBlob can wait up to a second for the browser).
    // toDataURL gives text like "data:image/jpeg;base64,AAAA..."; split(",")[1] keeps the part after the comma; atob = turn that base64 text back into raw bytes (as characters)
    const text = atob(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
    const bytes = new Uint8Array(text.length); // Uint8Array = a list of numbers 0..255 (one per byte), same length as the text
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i); // copy each character's number into the byte list
    return new Blob([bytes], { type: "image/jpeg" }); // wrap the bytes as a JPEG file that can be uploaded
  }

  // Draw the boxes on the transparent layer (positions are 0..1, so any size works).
  // Input: boxes = list of potholes from the server (each has box, level, number, confidence). Output: nothing (it draws on the canvas).
  function drawBoxes(boxes) {
    const canvas = layer.current; // the transparent canvas on top of the video
    if (!canvas) return; // if the canvas is not on the page (e.g. page closed), do nothing
    // devicePixelRatio = how many real screen dots make one CSS pixel; Retina screens use 2 (|| 1 = use 1 if unknown)
    const scale = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight; // the size the canvas is shown at on the page (CSS pixels)
    canvas.width = w * scale; canvas.height = h * scale; // give the canvas enough real dots so drawings stay sharp (setting the size also wipes it)
    const ctx = canvas.getContext("2d"); // ctx = the "pen" used to draw on the canvas
    ctx.scale(scale, scale); // zoom the pen so we can keep drawing in normal CSS pixels
    ctx.clearRect(0, 0, w, h); // erase everything (old boxes)
    ctx.font = "600 13px Inter, -apple-system, sans-serif"; // text style for labels: semi-bold, 13 px
    for (const p of boxes) { // go through each pothole p
      // box numbers are 0..1 (fractions of the picture), so multiply by width/height to get pixel corners: (x1,y1) top-left, (x2,y2) bottom-right
      const [x1, y1, x2, y2] = [p.box[0] * w, p.box[1] * h, p.box[2] * w, p.box[3] * h];
      const color = BOX_COLOR[p.level]; // pick the colour for this pothole's danger level
      ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.strokeRect(x1, y1, x2 - x1, y2 - y1); // draw a 3 px coloured rectangle outline (x, y, width, height)
      // many potholes -> short labels so they do not cover each other
      const text = boxes.length > 6 ? `#${p.number}` : `#${p.number} ${p.level} ${Math.round(p.confidence * 100)}%`; // e.g. "#2" or "#2 High 87%"
      const tw = ctx.measureText(text).width + 10; // label width = text width + 10 px padding
      const ty = y1 > 22 ? y1 - 22 : y1; // label goes just above the box; if no room at the top, put it inside the box
      ctx.fillStyle = color; ctx.fillRect(x1, ty, tw, 22); // draw the filled coloured label background (22 px tall)
      ctx.fillStyle = "#fff"; ctx.fillText(text, x1 + 5, ty + 15); // write the label text in white on top
    }
  }

  // start() = runs when "Start camera" is pressed: opens the camera, then loops (send picture -> get boxes -> draw) until stopped.
  // Input: nothing. Output: nothing (it changes the page state).
  async function start() {
    setError(""); setMessage(""); setResult(null); // clear old error, message and result
    try { // try = run this; if it fails (e.g. camera blocked), jump to catch
      // "environment" = the back camera on phones (the webcam on laptops)
      // getUserMedia = the browser asks permission and opens the camera; ideal width 1280 px; no microphone (audio: false)
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
      video.current.srcObject = stream; // connect the camera stream to the <video> element
      await video.current.play(); // start playing the video (wait until it really starts)
      setRatio(video.current.videoWidth / video.current.videoHeight || 4 / 3); // remember the picture shape (width / height); 4/3 if unknown
    } catch { // the camera could not be opened
      setError("Could not open the camera. Allow camera access in the browser (camera icon in the address bar) and try again.");
      return; // stop here, do not start the loop
    }
    running.current = true; // allow the loop to run
    setOn(true); // mark the camera as on (the page redraws)

    // The loop: copy picture -> ask the AI -> draw boxes -> (short rest) -> again
    let count = 0, since = performance.now(); // count = answers in this second; since = when this second started (performance.now() = exact time in milliseconds)
    while (running.current) { // repeat until stop() sets running to false
      const started = performance.now(); // time this round started
      try {
        // grab a small picture (512 px, quality 0.7), send it with the newest settings, wait for the answer
        const answer = await analyzeFrame(await grab(SEND_WIDTH, 0.7), latest.current);
        if (!running.current) break; // if the user pressed Stop while we waited, leave the loop
        setResult(answer); // save the answer (updates the numbers on screen)
        drawBoxes(answer.boxes); // draw the boxes over the video
      } catch (e) { // the server failed or could not be reached
        setError(e.message); // show the error
        break; // and leave the loop
      }
      count += 1; // one more answer this second
      if (performance.now() - since > 1000) {              // update the "per second" number
        setRate(Math.round((count * 1000) / (performance.now() - since))); // answers per second = count / seconds passed
        count = 0; since = performance.now(); // start counting a new second
      }
      const rest = 1000 / MAX_CHECKS_PER_SECOND - (performance.now() - started); // time left in this round (6 per second = about 167 ms each)
      if (rest > 0) await new Promise((r) => setTimeout(r, rest)); // if we were faster, wait the rest (setTimeout = do something after a delay)
    }
    stop(); // loop ended: turn the camera off and clean up
  }

  // stop() = turns the camera off, clears the boxes and marks the page as "off". Input: nothing. Output: nothing.
  function stop() {
    running.current = false; // tell the loop to stop
    video.current?.srcObject?.getTracks().forEach((track) => track.stop());   // camera light off
    if (video.current) video.current.srcObject = null; // disconnect the stream from the <video> element
    drawBoxes([]); // draw an empty list = erase all boxes
    setOn(false); // mark the camera as off (the page redraws)
  }

  // Leaving the page turns the camera off.
  // useEffect with [] runs once when the page appears; the function it returns runs when the page is closed -> stop()
  useEffect(() => () => stop(), []); // [] = no dependencies, so it is set up only once

  // snapshot() = runs on "Save as inspection": sends a bigger, sharper picture to be saved in Inspections.
  // Input: nothing. Output: nothing (shows a message or an error).
  async function snapshot() {
    try {
      const data = await saveSnapshot(await grab(1280, 0.9), settings); // grab a 1280 px picture (quality 0.9) and save it with the current settings
      // show e.g. "Saved as INS-0007: 2 potholes, road index 64/100."
      setMessage(`Saved as ${inspectionId(data.inspection_id)}: ${data.count} pothole${data.count === 1 ? "" : "s"}, road index ${data.road_score}/100.`);
      onSaved(); // tell page.js so the Inspections list reloads
    } catch (e) { // saving failed
      setError(e.message); // show the error
    }
  }

  const live = on && result; // live = camera is on AND we have an answer (only then show real numbers)

  // What we show on screen: a two-column layout (left = camera, right = readings + settings)
  return (
    <div className="grid-main">
      {/* Left card: the camera */}
      <div className="card pad">
        {/* Camera box; its shape (aspectRatio) follows the camera picture */}
        <div className="live-box" style={{ aspectRatio: ratio }}>
          {/* The camera video: muted = no sound, playsInline = phones play it in the page (not full screen); shown only when the camera is on */}
          <video ref={video} muted playsInline className="live-video" style={{ display: on ? "block" : "none" }} />
          {/* Transparent canvas on top of the video, where drawBoxes() draws the pothole boxes */}
          <canvas ref={layer} className="live-layer" />
          {/* When the camera is off: a help message */}
          {!on && <div className="live-off">Camera is off. Press <b>Start camera</b>.<br />Tip: hold a phone or printed photo of a pothole in front of the webcam.</div>}
          {/* When on: a red "LIVE" badge */}
          {on && <span className="live-badge">LIVE</span>}
          {/* Camera on but no answer yet: "Starting the AI…" */}
          {on && !result && <span className="live-status">Starting the AI…</span>}
          {/* With an answer: pothole count, AI updates per second, and how long the AI took in milliseconds (seconds x 1000) */}
          {live && <span className="live-status">{result.count} pothole{result.count === 1 ? "" : "s"} · AI {rate}/s · {Math.round(result.seconds * 1000)} ms</span>}
        </div>
        {/* Button row */}
        <div className="buttons">
          {/* Camera on: "Stop camera" (runs stop). Camera off: "Start camera" (runs start) */}
          {on ? <button className="btn" onClick={stop}>Stop camera</button>
              : <button className="btn primary" onClick={start}>Start camera</button>}
          {/* "Save as inspection" runs snapshot(); disabled while the camera is off */}
          <button className="btn" disabled={!on} onClick={snapshot}>Save as inspection</button>
        </div>
        {/* Saved message (only if there is one) */}
        {message && <div className="toast">{message}</div>}
        {/* Red error box (only if there is an error) */}
        {error && <ErrorBox text={error} />}
      </div>

      {/* Right column: cards stacked on top of each other */}
      <div className="stack">
        {/* "Live reading" card */}
        <div className="card pad">
          {/* Card header */}
          <div className="card-head">
            {/* Card title */}
            <h3>Live reading</h3>
            {/* When live: a coloured chip with the road condition (green/amber/red picked from the road score) */}
            {live && <Chip color={scoreColor(result.road_score)}>{result.condition}</Chip>}
          </div>
          {/* Four numbers; "–" is shown when there is no live answer */}
          <div className="plan">
            {/* Number of potholes */}
            <div><span>Potholes</span><b>{live ? result.count : "–"}</b></div>
            {/* Road index out of 100 */}
            <div><span>Road index</span><b>{live ? `${result.road_score}/100` : "–"}</b></div>
            {/* Most severe level (only if at least one pothole) */}
            <div><span>Most severe</span><b>{live && result.count ? result.worst : "–"}</b></div>
            {/* AI answers per second */}
            <div><span>AI updates</span><b>{live ? `${rate} / s` : "–"}</b></div>
          </div>
          {/* When live: bars showing how many potholes per level (Low, Medium, High, Critical) */}
          {live && <div style={{ marginTop: 16 }}><LevelBars counts={result.counts} /></div>}
        </div>
        {/* Settings card (from parts.js) with sensitivity and confidence controls, titled "Camera settings"; the text below goes inside it */}
        <SettingsCard info={info} settings={settings} change={change} show={["sensitivity", "confidence"]} title="Camera settings">
          {/* Help text explaining the speed limit */}
          <p className="help" style={{ marginTop: 16 }}>The video runs at full speed; the AI checks up to {MAX_CHECKS_PER_SECOND} pictures per second, one at a time, to keep the computer cool.</p>
        </SettingsCard>
      </div>
    </div>
  );
}
