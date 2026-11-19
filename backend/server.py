"""
server.py  -  the ONE program you run
======================================
It does 2 jobs:
    1. API: the website sends a photo/video/camera frame here, the AI finds potholes,
       the answer goes back (and the scan is saved in the history database).
    2. Shows the website itself (the files built from the "frontend" folder).

Everything is on ONE address:  http://localhost:8000

API addresses ("endpoints"):
    GET    /api/info          -> engines, sensitivity presets, severity levels
    GET    /api/samples       -> list of sample road photos
    POST   /api/analyze       -> check ONE photo (or one live camera frame)
    POST   /api/compare       -> check ONE photo with EVERY engine
    POST   /api/video         -> check a video; results are sent LIVE, frame by frame
    GET    /api/history       -> all inspections + totals (for Overview and Inspections)
    PATCH  /api/history/{id}  -> change status (Open/Scheduled/Repaired) or details
    DELETE /api/history/{id}  -> delete one inspection  (/api/history = delete all)

Start it with ./start.sh (in the main folder).
"""

import base64
import hashlib
import io
import json
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

import config
import database
from detector import Detector, load_model
from report import build_report

app = FastAPI(title="Pothole Detection System")
# Allow the website to call the API even when it runs on another port (e.g. "npm run dev" on 3000).
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

PHOTO_TYPES = (".jpg", ".jpeg", ".png", ".webp")
API_VERSION = 3   # the website checks this number to spot an old server that needs a restart
ai_lock = threading.Lock()   # the AI does ONE job at a time (no CPU overload, no heat spikes)


# =================================================================
# MODELS: loaded the first time they are needed, then kept in memory
# =================================================================
models = {}


def get_model(name):
    if name not in models:
        models[name] = load_model(name)
        # one practice run on a blank image, so the first real photo shows a true speed
        models[name].predict(np.zeros((640, 640, 3), np.uint8), verbose=False, device="cpu")
    return models[name]


# Results are remembered: same photo + same engine = instant answer,
# so moving the confidence slider does NOT run the AI again.
memory = {}


def find_potholes(photo_key, image, engine):
    key = (photo_key, engine)
    if key not in memory:
        with ai_lock:
            memory[key] = Detector(engine, get_model).find(image)
        if len(memory) > 20:
            memory.pop(next(iter(memory)))       # forget the oldest one (keeps RAM low)
    return memory[key]


# =================================================================
# HELPERS
# =================================================================
def image_to_text(image, quality=85, max_width=None):
    """Image -> text (base64), so it can travel inside the JSON answer (or the database)."""
    if max_width and image.shape[1] > max_width:
        image = cv2.resize(image, (max_width, int(image.shape[0] * max_width / image.shape[1])))
    _, jpg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return "data:image/jpeg;base64," + base64.b64encode(jpg.tobytes()).decode()


def read_gps(photo_bytes):
    """
    Phone photos often contain the GPS location in hidden "EXIF" data.
    Returns {"lat": .., "lon": ..} or None when the photo has no location.
    """
    try:
        gps = Image.open(io.BytesIO(photo_bytes)).getexif().get_ifd(0x8825)   # 0x8825 = GPS section
        if 2 not in gps or 4 not in gps:
            return None

        def to_degrees(dms, ref):          # (degrees, minutes, seconds) -> 12.345678
            value = float(dms[0]) + float(dms[1]) / 60 + float(dms[2]) / 3600
            return round(-value if ref in ("S", "W") else value, 6)

        return {"lat": to_degrees(gps[2], gps.get(1)), "lon": to_degrees(gps[4], gps.get(3))}
    except Exception:
        return None


def read_photo(file, sample):
    """Get the photo from an upload OR a sample name. Returns (bytes, image, name)."""
    if file is not None:
        photo_bytes, name = file.file.read(), file.filename or "photo.jpg"
    elif sample:
        path = config.SAMPLES_FOLDER / Path(sample).name     # .name blocks "../" tricks
        if not path.exists():
            raise HTTPException(404, "Sample not found")
        photo_bytes, name = path.read_bytes(), path.name
    else:
        raise HTTPException(400, "Send a photo or choose a sample")

    image = cv2.imdecode(np.frombuffer(photo_bytes, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(400, "This file is not a picture we can read. Use JPG, PNG or WEBP.")
    return photo_bytes, image, name


def to_json(report, seconds, engine, quality=85):
    """Only what the website needs: numbers, words, repair plan and the marked photo."""
    return {
        "engine": engine, "seconds": round(seconds, 3),
        "count": report["count"], "counts": report["counts"], "worst": report["worst"],
        "road_score": report["road_score"], "condition": report["condition"], "advice": report["advice"],
        "repair_plan": report["repair_plan"],
        "potholes": [{k: p[k] for k in ("number", "level", "danger", "confidence", "size_percent", "repair")}
                     for p in report["potholes"]],
        "image": image_to_text(report["picture"], quality),
    }


# =================================================================
# API
# =================================================================
@app.get("/api/info")
def info():
    return {
        "engines": [{"name": name, "about": e["about"]} for name, e in config.ENGINES.items()],
        "default_engine": config.DEFAULT_ENGINE,
        "video_engine": config.VIDEO_ENGINE,
        "live_engine": config.LIVE_ENGINE,
        "sensitivity": config.SENSITIVITY,
        "penalty": config.ROAD_PENALTY,
        "repair": config.REPAIR,
        "currency": config.CURRENCY,
        "version": API_VERSION,
    }


@app.get("/api/samples")
def samples():
    files = sorted(p for p in config.SAMPLES_FOLDER.iterdir() if p.suffix.lower() in PHOTO_TYPES)
    return [{"name": p.name, "url": f"/samples/{p.name}"} for p in files]


@app.post("/api/analyze")
def analyze(file: Optional[UploadFile] = File(None), sample: Optional[str] = Form(None),
            engine: str = Form(config.DEFAULT_ENGINE), confidence: float = Form(0.15),
            road_check: bool = Form(True), live: bool = Form(False), save: bool = Form(True),
            source: str = Form("photo"), road_name: str = Form(""), ward: str = Form(""),
            inspector: str = Form(""), notes: str = Form("")):
    """
    live=True  -> a camera frame: fastest engine, not remembered, not saved (keeps it real-time).
    save=True  -> stored as an inspection (with road name, ward, inspector, notes).
    source     -> "photo" or "camera" (a saved snapshot from the live camera)
    """
    photo_bytes, image, name = read_photo(file, sample)

    if live:
        # FAST PATH for the live camera: no drawing, no picture sent back -
        # only the box positions (0..1 of the frame), so the answer is tiny and quick.
        with ai_lock:
            boxes, scores, seconds = Detector(config.LIVE_ENGINE, get_model).find(image)
        report = build_report(image, boxes, scores, confidence, road_check, draw_picture=False)
        height, width = image.shape[:2]
        return {
            "seconds": round(seconds, 3), "count": report["count"], "counts": report["counts"],
            "worst": report["worst"], "road_score": report["road_score"], "condition": report["condition"],
            "boxes": [{"number": p["number"], "level": p["level"], "confidence": round(p["confidence"], 2),
                       "box": [round(float(p["box"][0]) / width, 4), round(float(p["box"][1]) / height, 4),
                               round(float(p["box"][2]) / width, 4), round(float(p["box"][3]) / height, 4)]}
                      for p in report["potholes"]],
        }

    if engine not in config.ENGINES:
        raise HTTPException(400, f"Unknown engine: {engine}")
    photo_key = hashlib.sha1(photo_bytes).hexdigest()      # the photo's "fingerprint"
    boxes, scores, seconds = find_potholes(photo_key, image, engine)
    report = build_report(image, boxes, scores, confidence, road_check)
    gps = read_gps(photo_bytes)

    inspection_id = None
    if save:
        details = {"road_name": road_name.strip(), "ward": ward.strip(), "inspector": inspector.strip(), "notes": notes.strip()}
        inspection_id = database.save_scan(photo_key, source if source in ("photo", "camera") else "photo", name, engine,
                                           report, image_to_text(report["picture"], 70, max_width=360), gps, details)
    return {"file_name": name, "gps": gps, "inspection_id": inspection_id, **to_json(report, seconds, engine)}


@app.post("/api/compare")
def compare(file: Optional[UploadFile] = File(None), sample: Optional[str] = Form(None),
            confidence: float = Form(0.15), road_check: bool = Form(True)):
    photo_bytes, image, name = read_photo(file, sample)
    photo_key = hashlib.sha1(photo_bytes).hexdigest()
    results = []
    for engine in config.ENGINES:
        boxes, scores, seconds = find_potholes(photo_key, image, engine)
        results.append(to_json(build_report(image, boxes, scores, confidence, road_check), seconds, engine))
    return {"file_name": name, "results": results}


@app.post("/api/video")
def video(file: UploadFile = File(...), every_nth: int = Form(3),
          confidence: float = Form(0.15), road_check: bool = Form(True)):
    """
    Sends one line of JSON per checked frame (LIVE), and a summary at the end.
    The worst frame is saved in the history. Pressing Stop ends the loop.
    """
    video_bytes = file.file.read()
    temp = tempfile.NamedTemporaryFile(suffix=Path(file.filename or "v.mp4").suffix, delete=False)
    temp.write(video_bytes)                       # OpenCV needs a real file on disk
    temp.close()

    def frames():
        detector = Detector(config.VIDEO_ENGINE, get_model)
        reader = cv2.VideoCapture(temp.name)
        total = int(reader.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
        number, checked, worst, road_scores = 0, 0, "None", []
        worst_frame = None                        # the frame with the most potholes
        try:
            while True:
                ok, frame = reader.read()
                if not ok:
                    break                                         # end of the video
                number += 1
                if (number - 1) % max(1, every_nth):
                    continue                                      # skip this frame

                started = time.time()
                if frame.shape[1] > config.VIDEO_MAX_WIDTH:       # smaller frame = less work
                    new_h = int(frame.shape[0] * config.VIDEO_MAX_WIDTH / frame.shape[1])
                    frame = cv2.resize(frame, (config.VIDEO_MAX_WIDTH, new_h))
                with ai_lock:
                    boxes, scores, seconds = detector.find(frame)
                report = build_report(frame, boxes, scores, confidence, road_check)

                checked += 1
                road_scores.append(report["road_score"])
                if worst_frame is None or report["count"] > worst_frame["count"]:
                    worst_frame = report
                if report["worst"] != "None" and (worst == "None" or
                        config.LEVEL_ORDER.index(report["worst"]) > config.LEVEL_ORDER.index(worst)):
                    worst = report["worst"]

                yield json.dumps({
                    "type": "frame", "frame": number, "total": total, "count": report["count"],
                    "peak": worst_frame["count"], "worst": worst, "road_score": report["road_score"],
                    "condition": report["condition"], "fps": round(1 / max(seconds, 1e-3), 1),
                    "image": image_to_text(report["picture"], quality=70),
                }) + "\n"

                # Rest a little so the CPU does not run at 100% all the time (keeps the Mac cool).
                time.sleep(max(0.0, 1 / config.VIDEO_MAX_CHECKS_PER_SECOND - (time.time() - started)))

            average = round(sum(road_scores) / len(road_scores)) if road_scores else None
            if worst_frame is not None:           # save the video in the history (with its worst frame)
                summary = {**worst_frame, "worst": worst, "road_score": average}
                database.save_scan("video:" + hashlib.sha1(video_bytes).hexdigest(), "video", file.filename,
                                   config.VIDEO_ENGINE, summary, image_to_text(worst_frame["picture"], 70, max_width=360))
            yield json.dumps({"type": "summary", "checked": checked, "peak": worst_frame["count"] if worst_frame else 0,
                              "worst": worst, "average_score": average,
                              "repair_plan": worst_frame["repair_plan"] if worst_frame else None}) + "\n"
        finally:
            reader.release()
            Path(temp.name).unlink(missing_ok=True)               # delete the temporary file

    return StreamingResponse(frames(), media_type="application/x-ndjson")


@app.get("/api/history")
def get_history():
    return database.history()


@app.patch("/api/history/{scan_id}")
def change_one(scan_id: int, changes: dict = Body(...)):
    """e.g. {"status": "Scheduled"}  or  {"road_name": "MG Road"}"""
    try:
        database.update_scan(scan_id, changes)
    except ValueError as error:
        raise HTTPException(400, str(error))
    return {"updated": scan_id}


@app.delete("/api/history/{scan_id}")
def delete_one(scan_id: int):
    database.delete_scan(scan_id)
    return {"deleted": scan_id}


@app.delete("/api/history")
def delete_everything():
    database.delete_all()
    return {"deleted": "all"}


# =================================================================
# WEBSITE + SAMPLE PHOTOS (must come AFTER the API routes)
# =================================================================
app.mount("/samples", StaticFiles(directory=config.SAMPLES_FOLDER), name="samples")

if config.WEBSITE_FOLDER.exists():
    app.mount("/", StaticFiles(directory=config.WEBSITE_FOLDER, html=True), name="website")
else:
    @app.get("/", response_class=HTMLResponse)
    def website_missing():
        return "<h3>The website is not built yet.</h3><p>Run <code>./start.sh</code> in the project folder.</p>"
