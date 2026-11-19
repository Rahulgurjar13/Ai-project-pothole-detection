/*
  CompareView.js  -  the "Model comparison" page
  ==============================================
  Runs EVERY AI engine on the same photo and shows them side by side,
  plus a summary table. The fastest engine and the one that found the
  most potholes get a small green badge. (Not saved as an inspection.)
*/
/* eslint-disable @next/next/no-img-element */
import { PhotoPicker } from "./PhotoView"; // reuse the photo chooser (drag & drop / browse / samples) from the New inspection page
// Bring in small ready-made screen pieces and helpers from our own file parts.js
import { CellBar, Chip, ErrorBox, LevelChip, Loading, scoreColor, SectionTitle, SettingsCard } from "./parts";

// CompareView = the whole "Model comparison" page (default export = the main thing this file gives to page.js).
// What goes in (props, all given by page.js):
//   info      = details from the backend, including the list of AI engines and a short "about" text for each
//   samples   = sample road photos;  settings = current AI settings;  change = function to change a setting
//   photo     = the chosen photo;    pickPhoto = function to choose a photo
//   data      = the comparison answer from the backend: { file_name, results: one result per engine }
//   loading   = true while the engines are working;  error = an error message, if any
// What comes out: the screen markup - photo chooser, settings, a results table and one photo card per engine.
export default function CompareView({ info, samples, settings, change, photo, pickPhoto, data, loading, error }) {
  const results = data?.results || []; // the list of engine results, or an empty list if there is no data yet (?. = read safely)
  // about = a lookup table "engine name -> short description", built from info.engines (empty list if info is missing)
  const about = Object.fromEntries((info?.engines || []).map((e) => [e.name, e.about]));
  const mostFound = Math.max(...results.map((r) => r.count), 0); // the highest pothole count of all engines (0 if no results)
  const fastest = Math.min(...results.map((r) => r.seconds)); // the shortest time taken by any engine, in seconds

  // Send back the screen markup, wrapped in an invisible fragment <> ... </>
  return (
    <>
      {/* Top area: left = photo chooser card, right = settings card */}
      <div className="grid-main">
        {/* Card for choosing the photo */}
        <div className="card pad">
          {/* Step heading: number 1, title, and a note that all 4 engines run on the photo */}
          <div className="step"><i>1</i><h3>Choose a photo</h3><span>all 4 engines run on it</span></div>
          {/* The photo chooser from PhotoView.js; the chosen photo goes back to the parent through pickPhoto */}
          <PhotoPicker samples={samples} picked={photo} onPick={pickPhoto} />
        </div>
        {/* AI settings card; only sensitivity and confidence are shown (no engine choice, because all engines run) */}
        <SettingsCard info={info} settings={settings} change={change} show={["sensitivity", "confidence"]} />
      </div>

      {/* If there is an error message, show it in a red error box */}
      {error && <ErrorBox text={error} />}
      {/* While the engines are working, show a spinning "loading" message */}
      {loading && <Loading text="Running all 4 engines…" />}

      {/* Only when there is at least one engine result, show the results below */}
      {results.length > 0 && (
        <>
          {/* Section heading "Results" with the photo's file name as a small note */}
          <SectionTitle title="Results" note={data.file_name} />
          <div className="card table">
            <table>
              {/* Table heading row (thead = heading part, tr = row, th = heading cell); the last column has no title (it holds badges) */}
              <thead><tr><th>Engine</th><th>Potholes</th><th>Most severe</th><th>Road index</th><th>Condition</th><th>Time</th><th></th></tr></thead>
              <tbody>
                {/* One table row (tr) for each engine result r; key = the engine name so React can track each row */}
                {results.map((r) => (
                  <tr key={r.engine}>
                    {/* Engine name in bold, with its short description under it (no extra margin) */}
                    <td><b>{r.engine}</b><div className="help" style={{ margin: 0 }}>{about[r.engine]}</div></td>
                    {/* Number of potholes this engine found */}
                    <td>{r.count}</td>
                    {/* Most severe level found, or "None" if it found 0 potholes */}
                    <td><LevelChip level={r.count ? r.worst : "None"} /></td>
                    {/* Road index (0-100) shown as a small bar with the number */}
                    <td><CellBar percent={r.road_score} text={r.road_score} /></td>
                    {/* Road condition word in a coloured chip; scoreColor picks green / amber / red from the score */}
                    <td><Chip color={scoreColor(r.road_score)}>{r.condition}</Chip></td>
                    {/* Time taken in seconds, with 2 decimals */}
                    <td>{r.seconds.toFixed(2)} s</td>
                    {/* Badge cell; whiteSpace "nowrap" = keep the badges on one line */}
                    <td style={{ whiteSpace: "nowrap" }}>
                      {/* "Most found" green badge if this engine found the most potholes (and more than 0); {" "} adds a space */}
                      {r.count === mostFound && mostFound > 0 && <Chip color="green">Most found</Chip>}{" "}
                      {/* "Fastest" blue badge if this engine took the shortest time */}
                      {r.seconds === fastest && <Chip color="blue">Fastest</Chip>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* A 2-column grid of photo cards, with a 20px gap above */}
          <div className="grid-2" style={{ marginTop: 20 }}>
            {/* One card for each engine result r (key = engine name). Its top row shows the engine name plus
                "N potholes · T s"; below it is that engine's AI-marked photo */}
            {results.map((r) => (
              <div className="card pad" key={r.engine}>
                <div className="card-head"><h3>{r.engine}</h3><span className="sub">{r.count} potholes · {r.seconds.toFixed(2)} s</span></div>
                <img className="photo" src={r.image} alt={r.engine} />
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
