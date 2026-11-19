/*
  VideoView.js  -  the "Video survey" page: check a whole street from a video
  ===========================================================================
  Choose a video -> "Start survey" -> every checked frame appears live with
  its numbers -> a summary at the end (saved as an inspection). "Stop" cancels.
*/
"use client";
/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from "react";
import { analyzeVideo } from "./api";
import { ErrorBox, Icon, RepairPlan, SectionTitle, SettingsCard, Summary } from "./parts";

export default function VideoView({ info, settings, change, onSaved }) {
  const fileInput = useRef(null);
  const stopper = useRef(null);                  // lets the Stop button cancel the request
  const [file, setFile] = useState(null);
  const [everyNth, setEveryNth] = useState(3);
  const [running, setRunning] = useState(false);
  const [frame, setFrame] = useState(null);      // latest checked frame
  const [summary, setSummary] = useState(null);  // result at the end
  const [error, setError] = useState("");

  async function start() {
    stopper.current = new AbortController();
    setRunning(true); setFrame(null); setSummary(null); setError("");
    try {
      await analyzeVideo(file, { everyNth, confidence: settings.confidence, roadCheck: settings.roadCheck },
        (line) => (line.type === "frame" ? setFrame(line) : (setSummary(line), onSaved())), stopper.current.signal);
    } catch (e) {
      if (e.name !== "AbortError") setError(e.message);
    }
    setRunning(false);
  }

  const chooseFile = (f) => { setFile(f || null); setFrame(null); setSummary(null); };
  const percent = frame ? Math.min(100, (100 * frame.frame) / frame.total) : 0;

  return (
    <>
      <div className="grid-main">
        <div className="card pad">
          <div className="step"><i>1</i><h3>Road video</h3><span>dash-cam or phone</span></div>
          <input ref={fileInput} type="file" accept="video/*,.mkv" hidden onChange={(e) => chooseFile(e.target.files[0])} />
          {file ? (
            <div className="chosen">
              <div className="drop-icon" style={{ margin: 0 }}><Icon name="video" size={20} /></div>
              <div><b>{file.name}</b><span>{(file.size / 1024 / 1024).toFixed(1)} MB</span></div>
              <button className="btn small" disabled={running} onClick={() => fileInput.current.click()}>Replace video</button>
            </div>
          ) : (
            <div className="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); chooseFile(e.dataTransfer.files[0]); }}>
              <div className="drop-icon"><Icon name="video" size={20} /></div>
              <b>Drag a road video here, or browse</b>
              <span>MP4, MOV, AVI or MKV</span>
              <button className="btn primary" onClick={() => fileInput.current.click()}>Browse files</button>
            </div>
          )}

          {frame && (
            <div style={{ marginTop: 16 }}>
              <img className="photo" src={frame.image} alt="Current frame" />
              <div className="progress" style={{ marginTop: 12 }}><i style={{ width: `${percent}%` }} /></div>
              <div className="progress-text">
                <span>{running ? "Checking" : "Finished"} · frame {frame.frame} of {frame.total} · {frame.count} pothole{frame.count === 1 ? "" : "s"} in view</span>
                <span>{Math.round(percent)}%</span>
              </div>
            </div>
          )}
        </div>

        <SettingsCard info={info} settings={settings} change={change} show={["sensitivity", "confidence"]} title="Survey settings">
          <div className="setting">
            <span className="label">Check every Nth frame</span>
            <div className="slider">
              <input type="range" min="1" max="10" value={everyNth} disabled={running} onChange={(e) => setEveryNth(Number(e.target.value))} />
              <b>{everyNth}</b>
            </div>
            <p className="help">Higher = faster and keeps the computer cooler. Engine: {info?.video_engine || "YOLOv8s"}.</p>
          </div>
          <div className="setting">
            {running
              ? <button className="btn wide" onClick={() => stopper.current.abort()}>Stop survey</button>
              : <button className="btn primary wide" disabled={!file} onClick={start}>Start survey</button>}
          </div>
        </SettingsCard>
      </div>

      {error && <ErrorBox text={error} />}

      {running && frame && (
        <>
          <SectionTitle title="Live results" note="updates while the video is checked" />
          <Summary score={frame.road_score} stats={[
            { label: "Potholes now", value: frame.count },
            { label: "Most in a frame", value: frame.peak },
            { label: "Most severe", value: frame.worst },
            { label: "AI speed", value: `${frame.fps} fps` },
          ]} />
        </>
      )}

      {summary?.checked > 0 && (
        <>
          <SectionTitle title="Survey summary" note="saved in Inspections" />
          <Summary score={summary.average_score} stats={[
            { label: "Frames checked", value: summary.checked },
            { label: "Most in a frame", value: summary.peak },
            { label: "Most severe", value: summary.worst },
            { label: "Average index", value: `${summary.average_score}/100` },
          ]} />
          {summary.peak > 0 && <div style={{ marginTop: 20, maxWidth: 560 }}><RepairPlan plan={summary.repair_plan} /></div>}
        </>
      )}
      {summary?.checked === 0 && <ErrorBox text="No frames could be read from this video. Try an MP4 file." />}
    </>
  );
}
