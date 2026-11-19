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
"use client";
import { useEffect, useRef, useState } from "react";
import { analyzeFrame, saveSnapshot } from "./api";
import { Chip, ErrorBox, inspectionId, LevelBars, scoreColor, SettingsCard } from "./parts";

const MAX_CHECKS_PER_SECOND = 6;   // more = faster updates but a warmer computer
const SEND_WIDTH = 512;            // size of the picture sent to the AI (small = fast)
const BOX_COLOR = { Low: "#16a34a", Medium: "#ca8a04", High: "#ea580c", Critical: "#dc2626" };

export default function LiveView({ info, settings, change, onSaved }) {
  const video = useRef(null);       // the camera video (shown to the user)
  const layer = useRef(null);       // transparent canvas on top, for the boxes
  const running = useRef(false);    // may the loop continue?
  const latest = useRef(settings);  // newest settings, read inside the loop
  latest.current = settings;

  const [on, setOn] = useState(false);
  const [result, setResult] = useState(null);   // latest answer (boxes + numbers)
  const [rate, setRate] = useState(0);          // AI updates per second
  const [ratio, setRatio] = useState(4 / 3);    // shape of the camera picture
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Copy the current camera picture into a JPEG (width = how big).
  function grab(width, quality) {
    const v = video.current;
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(width, v.videoWidth);
    canvas.height = Math.round((v.videoHeight * canvas.width) / v.videoWidth);
    canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
    // toDataURL makes the JPEG straight away (toBlob can wait up to a second for the browser).
    const text = atob(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return new Blob([bytes], { type: "image/jpeg" });
  }

  // Draw the boxes on the transparent layer (positions are 0..1, so any size works).
  function drawBoxes(boxes) {
    const canvas = layer.current;
    if (!canvas) return;
    const scale = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * scale; canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, w, h);
    ctx.font = "600 13px Inter, -apple-system, sans-serif";
    for (const p of boxes) {
      const [x1, y1, x2, y2] = [p.box[0] * w, p.box[1] * h, p.box[2] * w, p.box[3] * h];
      const color = BOX_COLOR[p.level];
      ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      // many potholes -> short labels so they do not cover each other
      const text = boxes.length > 6 ? `#${p.number}` : `#${p.number} ${p.level} ${Math.round(p.confidence * 100)}%`;
      const tw = ctx.measureText(text).width + 10;
      const ty = y1 > 22 ? y1 - 22 : y1;
      ctx.fillStyle = color; ctx.fillRect(x1, ty, tw, 22);
      ctx.fillStyle = "#fff"; ctx.fillText(text, x1 + 5, ty + 15);
    }
  }

  async function start() {
    setError(""); setMessage(""); setResult(null);
    try {
      // "environment" = the back camera on phones (the webcam on laptops)
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
      video.current.srcObject = stream;
      await video.current.play();
      setRatio(video.current.videoWidth / video.current.videoHeight || 4 / 3);
    } catch {
      setError("Could not open the camera. Allow camera access in the browser (camera icon in the address bar) and try again.");
      return;
    }
    running.current = true;
    setOn(true);

    // The loop: copy picture -> ask the AI -> draw boxes -> (short rest) -> again
    let count = 0, since = performance.now();
    while (running.current) {
      const started = performance.now();
      try {
        const answer = await analyzeFrame(await grab(SEND_WIDTH, 0.7), latest.current);
        if (!running.current) break;
        setResult(answer);
        drawBoxes(answer.boxes);
      } catch (e) {
        setError(e.message);
        break;
      }
      count += 1;
      if (performance.now() - since > 1000) {              // update the "per second" number
        setRate(Math.round((count * 1000) / (performance.now() - since)));
        count = 0; since = performance.now();
      }
      const rest = 1000 / MAX_CHECKS_PER_SECOND - (performance.now() - started);
      if (rest > 0) await new Promise((r) => setTimeout(r, rest));
    }
    stop();
  }

  function stop() {
    running.current = false;
    video.current?.srcObject?.getTracks().forEach((track) => track.stop());   // camera light off
    if (video.current) video.current.srcObject = null;
    drawBoxes([]);
    setOn(false);
  }

  // Leaving the page turns the camera off.
  useEffect(() => () => stop(), []);

  async function snapshot() {
    try {
      const data = await saveSnapshot(await grab(1280, 0.9), settings);
      setMessage(`Saved as ${inspectionId(data.inspection_id)}: ${data.count} pothole${data.count === 1 ? "" : "s"}, road index ${data.road_score}/100.`);
      onSaved();
    } catch (e) {
      setError(e.message);
    }
  }

  const live = on && result;

  return (
    <div className="grid-main">
      <div className="card pad">
        <div className="live-box" style={{ aspectRatio: ratio }}>
          <video ref={video} muted playsInline className="live-video" style={{ display: on ? "block" : "none" }} />
          <canvas ref={layer} className="live-layer" />
          {!on && <div className="live-off">Camera is off. Press <b>Start camera</b>.<br />Tip: hold a phone or printed photo of a pothole in front of the webcam.</div>}
          {on && <span className="live-badge">LIVE</span>}
          {on && !result && <span className="live-status">Starting the AI…</span>}
          {live && <span className="live-status">{result.count} pothole{result.count === 1 ? "" : "s"} · AI {rate}/s · {Math.round(result.seconds * 1000)} ms</span>}
        </div>
        <div className="buttons">
          {on ? <button className="btn" onClick={stop}>Stop camera</button>
              : <button className="btn primary" onClick={start}>Start camera</button>}
          <button className="btn" disabled={!on} onClick={snapshot}>Save as inspection</button>
        </div>
        {message && <div className="toast">{message}</div>}
        {error && <ErrorBox text={error} />}
      </div>

      <div className="stack">
        <div className="card pad">
          <div className="card-head">
            <h3>Live reading</h3>
            {live && <Chip color={scoreColor(result.road_score)}>{result.condition}</Chip>}
          </div>
          <div className="plan">
            <div><span>Potholes</span><b>{live ? result.count : "–"}</b></div>
            <div><span>Road index</span><b>{live ? `${result.road_score}/100` : "–"}</b></div>
            <div><span>Most severe</span><b>{live && result.count ? result.worst : "–"}</b></div>
            <div><span>AI updates</span><b>{live ? `${rate} / s` : "–"}</b></div>
          </div>
          {live && <div style={{ marginTop: 16 }}><LevelBars counts={result.counts} /></div>}
        </div>
        <SettingsCard info={info} settings={settings} change={change} show={["sensitivity", "confidence"]} title="Camera settings">
          <p className="help" style={{ marginTop: 16 }}>The video runs at full speed; the AI checks up to {MAX_CHECKS_PER_SECOND} pictures per second, one at a time, to keep the computer cool.</p>
        </SettingsCard>
      </div>
    </div>
  );
}
