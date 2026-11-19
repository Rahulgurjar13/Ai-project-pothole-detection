# Pothole Detection System – AI Road Inspection

An AI road-inspection system for city road departments. It finds potholes in **photos, videos and a live camera**,
grades each one, scores the road (0–100), **estimates the repair** (area, asphalt, crew time, cost in ₹)
and **tracks every inspection** from *Open* to *Scheduled* to *Repaired*.

## Start it (one command)

```bash
./start.sh
```

The browser opens **http://localhost:8000** by itself. Press **Ctrl + C** to stop.
The first time, it installs everything it needs (takes a few minutes).

## What it can do

| Page | What it does |
|---|---|
| **Overview** | City-wide numbers: inspections, open cases, critical potholes, repair backlog (₹), road-index trend, priority queue |
| **New inspection** | 1) road, ward, inspector, notes  2) photo  3) inspection report with ID (INS-0001), marked photo, severity, repair estimate, GPS location, print / PDF |
| **Video survey** | Checks a whole street from a dash-cam or phone video, live, frame by frame |
| **Live camera** | Real-time detection with a webcam or phone camera; save a view as an inspection |
| **Inspections** | Every inspection: search, filter by status, change status, export to Excel (CSV), delete |
| **Model comparison** | All 4 AI engines on the same photo, side by side |
| **Methodology** | How detection, scores and estimates work (for presentations) |

## Folders

```text
Pothole-Detection-System/
├── start.sh              ← run this
├── backend/              ← Python: the AI, the database and the server
│   ├── config.py         ← ALL settings in one place (thresholds, repair rates, CPU limit)
│   ├── detector.py       ← runs the YOLO models, merges their boxes
│   ├── report.py         ← danger score, road index, repair estimate, draws the boxes
│   ├── database.py       ← saves inspections in history.db (SQLite)
│   ├── server.py         ← the server: API + shows the website
│   └── tools.py          ← terminal tools: check a folder, clean a dataset, train
├── frontend/app/         ← Next.js: the website
│   ├── page.js           ← app frame: sidebar menu, header, page switching, Methodology
│   ├── DashboardView.js  ← Overview + Inspections pages
│   ├── PhotoView.js      ← New inspection page
│   ├── VideoView.js      ← Video survey page
│   ├── LiveView.js       ← Live camera page
│   ├── CompareView.js    ← Model comparison page
│   ├── parts.js          ← shared pieces: icons, chips, cards, score ring, settings
│   ├── api.js            ← talks to the Python server
│   ├── layout.js         ← page frame + title
│   └── globals.css       ← all the styles
├── models/               ← the 3 trained AI models (.pt)
├── samples/              ← example road photos
└── requirements.txt      ← Python libraries
```

## How it works

```text
 Website (Next.js) ── photo ──▶ server.py ──▶ detector.py ──▶ report.py ──▶ database.py
        ▲                                     (find boxes)    (scores,       (save the
        │                                                      repair plan)   inspection)
        └──────────── report: marked photo, scores, repair estimate ◀──────────────┘
```

1. **Detect** – YOLO models draw a box around every pothole.
   *Ensemble*: YOLOv8s and YOLOv9c vote together (Weighted Box Fusion), PotholeNet adds potholes they missed.
   Large photos are also checked in 640 px tiles so small, far-away potholes are found.
2. **Clean up** – boxes on the same pothole are merged, duplicates removed, and (High sensitivity)
   boxes on grass or white lane paint are ignored.
3. **Danger score (0–100)** per pothole = size (50) + near road centre (20) + close to camera (15) + AI confidence (15).
   0–19 **Low** · 20–39 **Medium** · 40–59 **High** · 60+ **Critical**
4. **Road Condition Index** – starts at 100, each pothole takes points away (Low −3, Medium −7, High −15, Critical −35).
5. **Repair estimate** – area (assuming a photo shows ~20 m² of road) × depth per level → asphalt (kg), crew hours,
   cost (₹ per m² per level) and deadline (Critical: 24 hours … Low: next routine check). All rates are in `config.py`.
6. **Tracking** – each inspection is saved with road, ward, inspector, notes and GPS (from the photo, if present).

## Keeping the computer cool

- The AI uses only half of the CPU cores (`CPU_THREADS` in `config.py`) and does one job at a time.
- Results are remembered, so moving a slider does not re-run the AI.
- Video: frames shrunk to 640 px, at most 5 checks per second. Live camera: 3 small frames per second, one at a time.
- The website is plain files served by Python – no extra Node.js server running.

## Engines

| Engine | Models | Use it for |
|---|---|---|
| Ensemble | YOLOv8s + YOLOv9c + PotholeNet | Best result on photos |
| YOLOv8s | YOLOv8s | Fastest – used for video and live camera |
| YOLOv9c | YOLOv9c | Comparing |
| PotholeNet | YOLO11n | Water-filled potholes |

Model sources: `best.pt` – Samdutse/pothole-yolov8 · `pothole_yolov9c.pt` – EngJamesO/pothole-detector (MIT) ·
`potholenet_yolo11n.pt` – Karn815833/PotholeNet-YOLO11n (MIT).

## Terminal tools

From the `backend` folder:

```bash
../.venv/bin/python tools.py check-folder ../samples        # marked photos + report.csv in results/
../.venv/bin/python tools.py dataset-check ../my_dataset     # check a training dataset
../.venv/bin/python tools.py train ../my_dataset/data.yaml   # train your own model
```

## Good to know

- Inspections are stored in `history.db` in the main folder. Delete that file to start fresh.
- After editing a file in `frontend/app`, run `./start.sh` again – it rebuilds the website automatically.
- The repair numbers are **estimates** for planning, not measurements.

## Tech

Python · YOLO (Ultralytics) · PyTorch · OpenCV · FastAPI · SQLite · Next.js · React
