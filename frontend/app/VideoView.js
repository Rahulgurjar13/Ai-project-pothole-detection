/*
  VideoView.js  -  the "Video survey" page: check a whole street from a video
  ===========================================================================
  Choose a video -> "Start survey" -> every checked frame appears live with
  its numbers -> a summary at the end (saved as an inspection). "Stop" cancels.
*/
"use client"; // tells Next.js: this file runs in the browser (it uses clicks, state and files)
/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from "react"; // React tools: useRef = a box that keeps a value between renders, useState = a value that redraws the page when changed
import { analyzeVideo } from "./api"; // the function that sends the video to the Python server (see api.js)
import { ErrorBox, Icon, RepairPlan, SectionTitle, SettingsCard, Summary } from "./parts"; // small ready-made screen pieces shared by all pages (see parts.js)

/*
  VideoView = the whole "Video survey" page (a React component = a function that returns screen markup).
  Props (inputs from page.js):
    info     = details from the server (engine names, sensitivity presets, video engine name)
    settings = the current AI settings (confidence, roadCheck, ...)
    change   = function to change those settings
    onSaved  = function we call when the survey is saved, so the Inspections list reloads
  Output: the page markup (video picker, live frame, settings, live numbers and final summary).
*/
export default function VideoView({ info, settings, change, onSaved }) {
  const fileInput = useRef(null);                // points to the hidden <input type="file"> so a button can open it
  const stopper = useRef(null);                  // lets the Stop button cancel the request
  const [file, setFile] = useState(null);        // the video file the user picked (null = none yet)
  const [everyNth, setEveryNth] = useState(3);   // check only every Nth frame (3 = frames 1, 4, 7, ...) to save time
  const [running, setRunning] = useState(false); // true while the survey is in progress
  const [frame, setFrame] = useState(null);      // latest checked frame
  const [summary, setSummary] = useState(null);  // result at the end
  const [error, setError] = useState("");        // error text to show ("" = no error)

  /*
    start() = runs when "Start survey" is pressed.
    It sends the video to the server and updates the page for every answer line.
    Input: nothing (it uses the chosen file and settings). Output: nothing (it changes the page state).
  */
  async function start() {
    // AbortController = lets us cancel a request that is still running (the Stop button uses it)
    stopper.current = new AbortController();
    setRunning(true); setFrame(null); setSummary(null); setError(""); // mark "busy" and clear old results and errors
    try { // try = run this; if something fails, jump to catch below
      // send the file + settings; the server answers one line per checked frame, and the last line is the summary
      await analyzeVideo(file, { everyNth, confidence: settings.confidence, roadCheck: settings.roadCheck },
        // for each answer line: a "frame" line updates the live picture, any other line is the summary -> show it and tell page.js it was saved
        (line) => (line.type === "frame" ? setFrame(line) : (setSummary(line), onSaved())), stopper.current.signal); // signal = the "cancel" wire
    } catch (e) { // e = the error that happened
      if (e.name !== "AbortError") setError(e.message); // AbortError means the user pressed Stop, which is not a real error, so we hide it
    }
    setRunning(false); // finished (or stopped or failed): not busy any more
  }

  // chooseFile = remember the newly chosen video (or null) and clear the old frame and summary
  const chooseFile = (f) => { setFile(f || null); setFrame(null); setSummary(null); };
  // percent = how far through the video we are (frame number / total frames x 100, never above 100); 0 before the first frame
  const percent = frame ? Math.min(100, (100 * frame.frame) / frame.total) : 0;

  // What we show on screen. <> ... </> is a "fragment" = an invisible wrapper around several elements.
  return (
    <>
      {/* Top area: left = video card, right = settings card (grid-main = a two-column layout from globals.css) */}
      <div className="grid-main">
        {/* The video card (card pad = white box with padding) */}
        <div className="card pad">
          {/* Step heading: number 1, title "Road video" and a small hint */}
          <div className="step"><i>1</i><h3>Road video</h3><span>dash-cam or phone</span></div>
          {/* Hidden file picker: ref lets our buttons open it, accept = only videos (and .mkv), hidden = not shown, onChange = when a file is picked, use the first one */}
          <input ref={fileInput} type="file" accept="video/*,.mkv" hidden onChange={(e) => chooseFile(e.target.files[0])} />
          {/* If a file is chosen, show its name and size; otherwise show the drag-and-drop area */}
          {file ? (
            <div className="chosen">
              {/* Video icon (margin 0 = no outer space) */}
              <div className="drop-icon" style={{ margin: 0 }}><Icon name="video" size={20} /></div>
              {/* File name, and size in MB (bytes / 1024 / 1024, 1 decimal place) */}
              <div><b>{file.name}</b><span>{(file.size / 1024 / 1024).toFixed(1)} MB</span></div>
              {/* "Replace video" opens the hidden file picker; disabled while the survey is running */}
              <button className="btn small" disabled={running} onClick={() => fileInput.current.click()}>Replace video</button>
            </div>
          ) : (
            <div className="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); chooseFile(e.dataTransfer.files[0]); }}>
              {/* The div above is the drop area: onDragOver + preventDefault allow dropping here (the browser would otherwise open the file);
                  onDrop takes the first dropped file */}
              {/* Video icon */}
              <div className="drop-icon"><Icon name="video" size={20} /></div>
              {/* Main instruction text */}
              <b>Drag a road video here, or browse</b>
              {/* Supported formats */}
              <span>MP4, MOV, AVI or MKV</span>
              {/* "Browse files" opens the hidden file picker */}
              <button className="btn primary" onClick={() => fileInput.current.click()}>Browse files</button>
            </div>
          )}

          {/* Only when at least one frame has been checked: show that frame and a progress bar */}
          {frame && (
            <div style={{ marginTop: 16 }}>
              {/* The checked frame picture with boxes drawn by the server (frame.image is the picture as text data) */}
              <img className="photo" src={frame.image} alt="Current frame" />
              {/* Progress bar: the inner <i> is filled to "percent" of the width */}
              <div className="progress" style={{ marginTop: 12 }}><i style={{ width: `${percent}%` }} /></div>
              {/* Text under the bar */}
              <div className="progress-text">
                {/* "Checking"/"Finished", frame X of Y, and how many potholes are in this frame ("pothole" or "potholes") */}
                <span>{running ? "Checking" : "Finished"} · frame {frame.frame} of {frame.total} · {frame.count} pothole{frame.count === 1 ? "" : "s"} in view</span>
                {/* The percent, rounded to a whole number */}
                <span>{Math.round(percent)}%</span>
              </div>
            </div>
          )}
        </div>

        {/* Settings card (from parts.js): shows the sensitivity and confidence controls with the title "Survey settings";
            the extra controls below are passed inside it as "children" */}
        <SettingsCard info={info} settings={settings} change={change} show={["sensitivity", "confidence"]} title="Survey settings">
          {/* One setting row: how often to check a frame */}
          <div className="setting">
            {/* Label text */}
            <span className="label">Check every Nth frame</span>
            {/* Slider row */}
            <div className="slider">
              {/* Range slider from 1 to 10; locked while running; on change, save the new number (Number() turns the text "5" into 5) */}
              <input type="range" min="1" max="10" value={everyNth} disabled={running} onChange={(e) => setEveryNth(Number(e.target.value))} />
              {/* Shows the current slider number */}
              <b>{everyNth}</b>
            </div>
            {/* Help text; info?.video_engine = the engine name from the server ("?." = do not crash if info is not loaded yet), else "YOLOv8s" */}
            <p className="help">Higher = faster and keeps the computer cooler. Engine: {info?.video_engine || "YOLOv8s"}.</p>
          </div>
          {/* Start / Stop button row */}
          <div className="setting">
            {/* While running: "Stop survey" cancels the request (abort). Otherwise: "Start survey", disabled until a file is chosen */}
            {running
              ? <button className="btn wide" onClick={() => stopper.current.abort()}>Stop survey</button>
              : <button className="btn primary wide" disabled={!file} onClick={start}>Start survey</button>}
          </div>
        </SettingsCard>
      </div>

      {/* Show a red error box only if there is an error message */}
      {error && <ErrorBox text={error} />}

      {/* While running and a frame exists: live numbers that update with every frame */}
      {running && frame && (
        <>
          {/* Section heading with a small note */}
          <SectionTitle title="Live results" note="updates while the video is checked" />
          {/* Summary (from parts.js) = a score ring plus small number tiles. score = road index of this frame;
              stats = the tiles: potholes in this frame, most potholes in any frame so far, most severe level, and AI speed in frames per second */}
          <Summary score={frame.road_score} stats={[
            { label: "Potholes now", value: frame.count },
            { label: "Most in a frame", value: frame.peak },
            { label: "Most severe", value: frame.worst },
            { label: "AI speed", value: `${frame.fps} fps` },
          ]} />
        </>
      )}

      {/* When the survey ended and at least one frame was checked ("?." = only if summary exists): the final summary */}
      {summary?.checked > 0 && (
        <>
          {/* Section heading: the result is saved in Inspections */}
          <SectionTitle title="Survey summary" note="saved in Inspections" />
          {/* Final score ring (average road index) and tiles: frames checked, most potholes in one frame, most severe level, average index out of 100 */}
          <Summary score={summary.average_score} stats={[
            { label: "Frames checked", value: summary.checked },
            { label: "Most in a frame", value: summary.peak },
            { label: "Most severe", value: summary.worst },
            { label: "Average index", value: `${summary.average_score}/100` },
          ]} />
          {/* Only if any pothole was found (peak > 0): show the repair plan (cost/work list from the server), max 560 px wide */}
          {summary.peak > 0 && <div style={{ marginTop: 20, maxWidth: 560 }}><RepairPlan plan={summary.repair_plan} /></div>}
        </>
      )}
      {/* If the server could not read any frame (checked = 0), show a helpful error */}
      {summary?.checked === 0 && <ErrorBox text="No frames could be read from this video. Try an MP4 file." />}
    </>
  );
}
