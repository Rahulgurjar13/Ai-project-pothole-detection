/*
  CompareView.js  -  the "Model comparison" page
  ==============================================
  Runs EVERY AI engine on the same photo and shows them side by side,
  plus a summary table. The fastest engine and the one that found the
  most potholes get a small green badge. (Not saved as an inspection.)
*/
/* eslint-disable @next/next/no-img-element */
import { PhotoPicker } from "./PhotoView";
import { CellBar, Chip, ErrorBox, LevelChip, Loading, scoreColor, SectionTitle, SettingsCard } from "./parts";

export default function CompareView({ info, samples, settings, change, photo, pickPhoto, data, loading, error }) {
  const results = data?.results || [];
  const about = Object.fromEntries((info?.engines || []).map((e) => [e.name, e.about]));
  const mostFound = Math.max(...results.map((r) => r.count), 0);
  const fastest = Math.min(...results.map((r) => r.seconds));

  return (
    <>
      <div className="grid-main">
        <div className="card pad">
          <div className="step"><i>1</i><h3>Choose a photo</h3><span>all 4 engines run on it</span></div>
          <PhotoPicker samples={samples} picked={photo} onPick={pickPhoto} />
        </div>
        <SettingsCard info={info} settings={settings} change={change} show={["sensitivity", "confidence"]} />
      </div>

      {error && <ErrorBox text={error} />}
      {loading && <Loading text="Running all 4 engines…" />}

      {results.length > 0 && (
        <>
          <SectionTitle title="Results" note={data.file_name} />
          <div className="card table">
            <table>
              <thead><tr><th>Engine</th><th>Potholes</th><th>Most severe</th><th>Road index</th><th>Condition</th><th>Time</th><th></th></tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.engine}>
                    <td><b>{r.engine}</b><div className="help" style={{ margin: 0 }}>{about[r.engine]}</div></td>
                    <td>{r.count}</td>
                    <td><LevelChip level={r.count ? r.worst : "None"} /></td>
                    <td><CellBar percent={r.road_score} text={r.road_score} /></td>
                    <td><Chip color={scoreColor(r.road_score)}>{r.condition}</Chip></td>
                    <td>{r.seconds.toFixed(2)} s</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {r.count === mostFound && mostFound > 0 && <Chip color="green">Most found</Chip>}{" "}
                      {r.seconds === fastest && <Chip color="blue">Fastest</Chip>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid-2" style={{ marginTop: 20 }}>
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
