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

# ---- WORDS USED IN THIS FILE (simple meanings) ----
# API       = the "menu" of things the website can ask the server to do.
# endpoint  = one web address on that menu that the website calls to ask the server for something.
# GET       = a request that only READS data.  POST = a request that SENDS data (e.g. a photo).
# PATCH     = a request that CHANGES part of a saved item.  DELETE = a request that removes an item.
# JSON      = a text format for data, like {"count": 3}. Both Python and JavaScript understand it.
# NDJSON    = one JSON message per line, sent while the work is still going (used for live video).
# decorator = the "@app.get(...)" line above a function; it connects a web address to that function.

# ---- IMPORTS: tools from Python itself ----
import base64        # turns raw bytes (like a JPG) into normal text, so an image can travel inside JSON
import hashlib       # makes a "fingerprint" (hash) of data; same photo -> same fingerprint
import io            # lets us treat bytes in memory like a file (needed to open a photo with PIL)
import json          # converts Python dictionaries into JSON text
import tempfile      # makes temporary files (the uploaded video is stored in one for a short time)
import threading     # gives us a "lock" so only one AI job runs at a time
import time          # measures time and lets the program pause (sleep)
from pathlib import Path        # an easy way to work with file and folder paths
from typing import Optional     # "Optional[X]" means: this value can be X or can be missing (None)

# ---- IMPORTS: installed libraries ----
import cv2           # OpenCV: reads, resizes and encodes images and videos
import numpy as np   # NumPy: fast number arrays; an image is an array of pixel numbers
# FastAPI pieces: Body/File/Form = read data sent by the website, HTTPException = send an error back,
# UploadFile = an uploaded file, FastAPI = the web server app itself
from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware   # CORS = rule that allows a website on another address to call us
from fastapi.responses import HTMLResponse, StreamingResponse   # HTML page answer / answer sent bit by bit (streamed)
from fastapi.staticfiles import StaticFiles    # serves ready-made files (website pages, sample photos) as they are
from PIL import Image                          # Pillow: opens photos; used here only to read GPS data (EXIF)

# ---- IMPORTS: our own project files ----
import config                               # all settings (folders, engines, prices...) in config.py
import database                             # saves and reads the inspection history (database.py)
from detector import Detector, load_model   # the AI part: Detector finds potholes, load_model loads an AI model file
from report import build_report             # turns AI boxes into a full report (severity, score, repair plan, picture)

app = FastAPI(title="Pothole Detection System")   # create the web server app; all endpoints are attached to "app"
# Allow the website to call the API even when it runs on another port (e.g. "npm run dev" on 3000).
# "*" means: allow every address, every method (GET/POST...) and every header.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

PHOTO_TYPES = (".jpg", ".jpeg", ".png", ".webp")   # file endings we accept as photos (used for the sample list)
API_VERSION = 3   # the website checks this number to spot an old server that needs a restart
ai_lock = threading.Lock()   # the AI does ONE job at a time (no CPU overload, no heat spikes)


# =================================================================
# MODELS: loaded the first time they are needed, then kept in memory
# =================================================================
models = {}   # dictionary: model name -> loaded AI model (starts empty)


# get_model(name): gives back the AI model with this name.
# In: the model name (e.g. "YOLOv8s").  Out: the loaded model.
# Loading from disk is slow, so it is done only the first time; after that the saved copy is reused.
def get_model(name):
    if name not in models:                    # not loaded yet?
        models[name] = load_model(name)       # load the model file from disk and keep it in the dictionary
        # one practice run on a blank image, so the first real photo shows a true speed
        # (np.zeros = a 640x640 all-black picture with 3 colour channels; device="cpu" = run on the processor)
        models[name].predict(np.zeros((640, 640, 3), np.uint8), verbose=False, device="cpu")
    return models[name]                       # give back the (now loaded) model


# Results are remembered: same photo + same engine = instant answer,
# so moving the confidence slider does NOT run the AI again.
memory = {}   # dictionary: (photo fingerprint, engine) -> AI result (this is a "cache")


# find_potholes(photo_key, image, engine): runs the AI on a photo, or reuses an earlier answer.
# In: the photo's fingerprint, the image, the engine name.  Out: (boxes, scores, seconds).
def find_potholes(photo_key, image, engine):
    key = (photo_key, engine)                 # the "label" we store the result under
    if key not in memory:                     # never seen this photo with this engine?
        with ai_lock:                         # wait for our turn: only one AI job at a time
            memory[key] = Detector(engine, get_model).find(image)   # run the AI and remember the result
        if len(memory) > 20:                  # remembering too many results?
            memory.pop(next(iter(memory)))       # forget the oldest one (keeps RAM low)
    return memory[key]                        # give back the remembered result


# =================================================================
# HELPERS
# =================================================================
# image_to_text: In: an image (+ JPG quality, + optional max width).  Out: text like "data:image/jpeg;base64,...."
# The browser can show this text directly as a picture.
def image_to_text(image, quality=85, max_width=None):
    """Image -> text (base64), so it can travel inside the JSON answer (or the database)."""
    if max_width and image.shape[1] > max_width:   # a max width was given and the image is wider? (shape[1] = width)
        # shrink it, keeping the same shape: new height = old height * (new width / old width)
        image = cv2.resize(image, (max_width, int(image.shape[0] * max_width / image.shape[1])))
    _, jpg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])   # compress to JPG bytes ("_" = ignored ok-flag)
    return "data:image/jpeg;base64," + base64.b64encode(jpg.tobytes()).decode()   # bytes -> base64 text with a label in front


# read_gps: In: the raw bytes of a photo.  Out: {"lat": .., "lon": ..} or None.
def read_gps(photo_bytes):
    """
    Phone photos often contain the GPS location in hidden "EXIF" data.
    Returns {"lat": .., "lon": ..} or None when the photo has no location.
    """
    try:   # if anything goes wrong (no EXIF, broken data), we jump to "except" below
        gps = Image.open(io.BytesIO(photo_bytes)).getexif().get_ifd(0x8825)   # 0x8825 = GPS section
        if 2 not in gps or 4 not in gps:   # tag 2 = latitude, tag 4 = longitude; if either is missing...
            return None                    # ...the photo has no usable location

        # helper inside a helper: GPS is stored as (degrees, minutes, seconds); "ref" is N/S or E/W
        def to_degrees(dms, ref):          # (degrees, minutes, seconds) -> 12.345678
            value = float(dms[0]) + float(dms[1]) / 60 + float(dms[2]) / 3600   # 1 degree = 60 minutes = 3600 seconds
            return round(-value if ref in ("S", "W") else value, 6)   # South/West are negative numbers; keep 6 decimals

        # tag 1 = N/S letter for latitude, tag 3 = E/W letter for longitude
        return {"lat": to_degrees(gps[2], gps.get(1)), "lon": to_degrees(gps[4], gps.get(3))}
    except Exception:   # any error while reading GPS
        return None     # -> just say "no location" instead of crashing


# read_photo: In: an uploaded file OR the name of a sample photo.  Out: (bytes, image, name).
# Sends an error back to the website if nothing usable was sent.
def read_photo(file, sample):
    """Get the photo from an upload OR a sample name. Returns (bytes, image, name)."""
    if file is not None:   # the user uploaded a photo
        photo_bytes, name = file.file.read(), file.filename or "photo.jpg"   # read all bytes; use "photo.jpg" if it has no name
    elif sample:           # the user picked one of the sample photos
        path = config.SAMPLES_FOLDER / Path(sample).name     # .name blocks "../" tricks
        if not path.exists():                                # no such sample file?
            raise HTTPException(404, "Sample not found")     # stop and send error 404 (= "not found") to the website
        photo_bytes, name = path.read_bytes(), path.name     # read the sample file's bytes and its name
    else:                  # neither an upload nor a sample
        raise HTTPException(400, "Send a photo or choose a sample")   # error 400 = "bad request" (the request is missing something)

    # turn the bytes into an image (a grid of pixel numbers) that OpenCV and the AI can use
    image = cv2.imdecode(np.frombuffer(photo_bytes, np.uint8), cv2.IMREAD_COLOR)
    if image is None:   # OpenCV could not understand the file (not a real picture)
        raise HTTPException(400, "This file is not a picture we can read. Use JPG, PNG or WEBP.")
    return photo_bytes, image, name   # give back all three


# to_json: In: a report (from build_report), the AI time in seconds, the engine name, JPG quality.
# Out: a small dictionary with only what the website shows (FastAPI turns it into JSON automatically).
def to_json(report, seconds, engine, quality=85):
    """Only what the website needs: numbers, words, repair plan and the marked photo."""
    return {
        "engine": engine, "seconds": round(seconds, 3),   # which AI engine was used, and how long it took (3 decimals)
        "count": report["count"], "counts": report["counts"], "worst": report["worst"],   # total potholes, count per level, worst level
        "road_score": report["road_score"], "condition": report["condition"], "advice": report["advice"],   # road health score + words
        "repair_plan": report["repair_plan"],   # cost / material / time to fix
        # for each pothole keep only these 6 fields (smaller answer, no big data like box arrays)
        "potholes": [{k: p[k] for k in ("number", "level", "danger", "confidence", "size_percent", "repair")}
                     for p in report["potholes"]],   # ...repeated for every pothole in the report
        "image": image_to_text(report["picture"], quality),   # the photo with boxes drawn on it, as text
    }


# =================================================================
# API
# =================================================================
# GET /api/info  -> the website calls this when it starts.
# In: nothing.  Out: the settings the website needs (engine list, sensitivity presets, prices, version).
@app.get("/api/info")   # decorator: a GET request to /api/info runs the function below
def info():
    return {
        "engines": [{"name": name, "about": e["about"]} for name, e in config.ENGINES.items()],   # every engine + a short description
        "default_engine": config.DEFAULT_ENGINE,   # the engine chosen when the page opens
        "video_engine": config.VIDEO_ENGINE,       # the engine used for videos
        "live_engine": config.LIVE_ENGINE,         # the engine used for the live camera
        "sensitivity": config.SENSITIVITY,         # sensitivity presets (confidence levels)
        "penalty": config.ROAD_PENALTY,            # how many points each severity level takes off the road score
        "repair": config.REPAIR,                   # repair method / costs per severity level
        "currency": config.CURRENCY,               # money symbol (₹)
        "version": API_VERSION,                    # server version number (to spot an old server)
    }


# GET /api/samples  -> In: nothing.  Out: a list of sample photos, each with its name and web address.
@app.get("/api/samples")   # decorator: a GET request to /api/samples runs the function below
def samples():
    # look at every file in the samples folder, keep only photo types, and sort them A-Z
    files = sorted(p for p in config.SAMPLES_FOLDER.iterdir() if p.suffix.lower() in PHOTO_TYPES)
    return [{"name": p.name, "url": f"/samples/{p.name}"} for p in files]   # the browser can load each photo from "url"


# POST /api/analyze  -> check ONE photo (upload, sample, or one live camera frame).
# In (form fields): the photo or sample name, engine, confidence, options and inspection details.
# Out: the report as JSON (count, severity, road score, repair plan, marked photo, GPS, inspection id).
# Each "= Form(...)" / "= File(...)" says where the value comes from and its default value if not sent.
@app.post("/api/analyze")   # decorator: a POST request to /api/analyze runs the function below
def analyze(file: Optional[UploadFile] = File(None), sample: Optional[str] = Form(None),   # uploaded photo OR sample name
            engine: str = Form(config.DEFAULT_ENGINE), confidence: float = Form(0.15),     # which AI; minimum sureness (15%)
            road_check: bool = Form(True), live: bool = Form(False), save: bool = Form(True),   # remove grass/lines? camera frame? save?
            source: str = Form("photo"), road_name: str = Form(""), ward: str = Form(""),  # where it came from; road and area
            inspector: str = Form(""), notes: str = Form("")):                             # who checked it; extra notes
    """
    live=True  -> a camera frame: fastest engine, not remembered, not saved (keeps it real-time).
    save=True  -> stored as an inspection (with road name, ward, inspector, notes).
    source     -> "photo" or "camera" (a saved snapshot from the live camera)
    """
    photo_bytes, image, name = read_photo(file, sample)   # get the photo (or send an error back)

    if live:   # this is a frame from the live camera
        # FAST PATH for the live camera: no drawing, no picture sent back -
        # only the box positions (0..1 of the frame), so the answer is tiny and quick.
        with ai_lock:   # wait for our turn: only one AI job at a time
            boxes, scores, seconds = Detector(config.LIVE_ENGINE, get_model).find(image)   # run the fastest AI engine
        report = build_report(image, boxes, scores, confidence, road_check, draw_picture=False)   # grade potholes, skip drawing
        height, width = image.shape[:2]   # size of the frame in pixels
        return {
            "seconds": round(seconds, 3), "count": report["count"], "counts": report["counts"],   # time and pothole counts
            "worst": report["worst"], "road_score": report["road_score"], "condition": report["condition"],   # worst level + road health
            # each box = [left, top, right, bottom], divided by width/height so it becomes 0..1
            # (then the website can draw it on a video of any size)
            "boxes": [{"number": p["number"], "level": p["level"], "confidence": round(p["confidence"], 2),
                       "box": [round(float(p["box"][0]) / width, 4), round(float(p["box"][1]) / height, 4),   # left, top
                               round(float(p["box"][2]) / width, 4), round(float(p["box"][3]) / height, 4)]}  # right, bottom
                      for p in report["potholes"]],   # ...repeated for every pothole
        }

    # ---- NORMAL PATH (a photo) ----
    if engine not in config.ENGINES:   # the website asked for an engine we do not have
        raise HTTPException(400, f"Unknown engine: {engine}")   # send error 400 back
    photo_key = hashlib.sha1(photo_bytes).hexdigest()      # the photo's "fingerprint"
    boxes, scores, seconds = find_potholes(photo_key, image, engine)   # run the AI (or reuse a remembered answer)
    report = build_report(image, boxes, scores, confidence, road_check)   # grade potholes, score the road, draw boxes
    gps = read_gps(photo_bytes)   # location from the photo, if it has one

    inspection_id = None   # stays None if we do not save
    if save:   # the website wants this saved in the history
        # the typed details; .strip() removes extra spaces at the start and end
        details = {"road_name": road_name.strip(), "ward": ward.strip(), "inspector": inspector.strip(), "notes": notes.strip()}
        # save in the database: fingerprint, source (only "photo" or "camera" allowed), file name, engine, report,
        # a small preview picture (quality 70, max 360 px wide), GPS and details. Gives back the inspection number.
        inspection_id = database.save_scan(photo_key, source if source in ("photo", "camera") else "photo", name, engine,
                                           report, image_to_text(report["picture"], 70, max_width=360), gps, details)
    # answer = file name + GPS + inspection number + everything from to_json ("**" = copy all its keys in here)
    return {"file_name": name, "gps": gps, "inspection_id": inspection_id, **to_json(report, seconds, engine)}


# POST /api/compare  -> check ONE photo with EVERY engine, so the website can show them side by side.
# In: photo or sample name, confidence, road_check.  Out: {"file_name": .., "results": [one result per engine]}.
# Nothing is saved in the history here.
@app.post("/api/compare")   # decorator: a POST request to /api/compare runs the function below
def compare(file: Optional[UploadFile] = File(None), sample: Optional[str] = Form(None),   # uploaded photo OR sample name
            confidence: float = Form(0.15), road_check: bool = Form(True)):                # minimum sureness; remove grass/lines?
    photo_bytes, image, name = read_photo(file, sample)   # get the photo (or send an error back)
    photo_key = hashlib.sha1(photo_bytes).hexdigest()     # the photo's fingerprint (for the memory)
    results = []                                          # empty list; one result per engine will be added
    for engine in config.ENGINES:                         # go through every engine one by one
        boxes, scores, seconds = find_potholes(photo_key, image, engine)   # run this engine (or reuse a remembered answer)
        results.append(to_json(build_report(image, boxes, scores, confidence, road_check), seconds, engine))   # make report, add to list
    return {"file_name": name, "results": results}        # send all results back


# POST /api/video  -> check a video frame by frame and send results LIVE (streaming, NDJSON).
# In: the video file, every_nth (check 1 of every N frames), confidence, road_check.
# Out: many lines of JSON: one {"type": "frame", ...} per checked frame, then one {"type": "summary", ...} at the end.
@app.post("/api/video")   # decorator: a POST request to /api/video runs the function below
def video(file: UploadFile = File(...), every_nth: int = Form(3),      # File(...) = the video is required; check every 3rd frame
          confidence: float = Form(0.15), road_check: bool = Form(True)):   # minimum sureness; remove grass/lines?
    """
    Sends one line of JSON per checked frame (LIVE), and a summary at the end.
    The worst frame is saved in the history. Pressing Stop ends the loop.
    """
    video_bytes = file.file.read()   # read the whole uploaded video into memory
    # make a temporary file with the same ending (.mp4, .mov...); delete=False = keep it after closing (we delete it later)
    temp = tempfile.NamedTemporaryFile(suffix=Path(file.filename or "v.mp4").suffix, delete=False)
    temp.write(video_bytes)                       # OpenCV needs a real file on disk
    temp.close()                                  # finish writing so OpenCV can open it

    # frames() is a "generator": each "yield" sends one piece of the answer right away, while the loop keeps going.
    # This is what makes the results appear LIVE on the website. If the user presses Stop, the browser
    # disconnects and the generator is stopped, so the loop ends.
    def frames():
        detector = Detector(config.VIDEO_ENGINE, get_model)       # the AI for video (the fastest engine)
        reader = cv2.VideoCapture(temp.name)                      # open the video file to read frames
        total = int(reader.get(cv2.CAP_PROP_FRAME_COUNT)) or 1    # how many frames the video has (1 if unknown, to avoid 0)
        number, checked, worst, road_scores = 0, 0, "None", []    # frame counter, checked counter, worst level so far, list of scores
        worst_frame = None                        # the frame with the most potholes
        try:   # "finally" below always runs, even if there is an error or the user stops
            while True:                           # loop over the frames until the video ends
                ok, frame = reader.read()         # read the next frame; ok = False when there are no more
                if not ok:
                    break                                         # end of the video
                number += 1                                       # count this frame (1, 2, 3...)
                if (number - 1) % max(1, every_nth):              # "%" = remainder; not 0 means: not our turn
                    continue                                      # skip this frame

                started = time.time()                             # remember when we started this frame
                if frame.shape[1] > config.VIDEO_MAX_WIDTH:       # smaller frame = less work
                    new_h = int(frame.shape[0] * config.VIDEO_MAX_WIDTH / frame.shape[1])   # keep the same shape
                    frame = cv2.resize(frame, (config.VIDEO_MAX_WIDTH, new_h))              # shrink the frame
                with ai_lock:                                     # only one AI job at a time
                    boxes, scores, seconds = detector.find(frame)  # run the AI on this frame
                report = build_report(frame, boxes, scores, confidence, road_check)   # grade, score and draw

                checked += 1                                      # one more frame checked
                road_scores.append(report["road_score"])          # keep this frame's road score (for the average)
                if worst_frame is None or report["count"] > worst_frame["count"]:   # more potholes than the best so far?
                    worst_frame = report                          # remember this frame as the worst
                # is this frame's worst level more dangerous than the worst level so far? (LEVEL_ORDER: Low < ... < Critical)
                if report["worst"] != "None" and (worst == "None" or
                        config.LEVEL_ORDER.index(report["worst"]) > config.LEVEL_ORDER.index(worst)):
                    worst = report["worst"]                       # update the worst level

                # send one line of JSON for this frame right now ("\n" = new line, so each message is on its own line)
                yield json.dumps({
                    "type": "frame", "frame": number, "total": total, "count": report["count"],   # which frame, how many potholes
                    "peak": worst_frame["count"], "worst": worst, "road_score": report["road_score"],   # highest count so far, worst level
                    "condition": report["condition"], "fps": round(1 / max(seconds, 1e-3), 1),   # fps = frames per second the AI managed
                    "image": image_to_text(report["picture"], quality=70),   # the frame with boxes drawn, as text
                }) + "\n"

                # Rest a little so the CPU does not run at 100% all the time (keeps the Mac cool).
                # wait time = (time allowed per frame) - (time already used); never less than 0
                time.sleep(max(0.0, 1 / config.VIDEO_MAX_CHECKS_PER_SECOND - (time.time() - started)))

            # after the loop: the average road score of all checked frames (None if no frame was checked)
            average = round(sum(road_scores) / len(road_scores)) if road_scores else None
            if worst_frame is not None:           # save the video in the history (with its worst frame)
                summary = {**worst_frame, "worst": worst, "road_score": average}   # copy of the worst frame's report, with video totals
                # fingerprint starts with "video:" so it never mixes with a photo; small preview picture of the worst frame
                database.save_scan("video:" + hashlib.sha1(video_bytes).hexdigest(), "video", file.filename,
                                   config.VIDEO_ENGINE, summary, image_to_text(worst_frame["picture"], 70, max_width=360))
            # the last line: a summary of the whole video
            yield json.dumps({"type": "summary", "checked": checked, "peak": worst_frame["count"] if worst_frame else 0,
                              "worst": worst, "average_score": average,
                              "repair_plan": worst_frame["repair_plan"] if worst_frame else None}) + "\n"
        finally:   # always runs at the end (normal finish, error, or Stop)
            reader.release()                                      # close the video file
            Path(temp.name).unlink(missing_ok=True)               # delete the temporary file

    # send the answer bit by bit as frames() produces it; "x-ndjson" tells the browser it is NDJSON
    return StreamingResponse(frames(), media_type="application/x-ndjson")


# GET /api/history  -> In: nothing.  Out: all saved inspections (newest first) + totals for the Overview cards.
@app.get("/api/history")   # decorator: a GET request to /api/history runs the function below
def get_history():
    return database.history()   # read everything from the database and send it back


# PATCH /api/history/{scan_id}  -> change ONE saved inspection.
# In: the inspection number in the address (e.g. /api/history/7) and a JSON body with the changes.
# Out: {"updated": <number>}, or error 400 if a change is not allowed (e.g. an unknown status).
@app.patch("/api/history/{scan_id}")   # decorator: {scan_id} = this part of the address is read as a variable
def change_one(scan_id: int, changes: dict = Body(...)):   # scan_id is a whole number; changes come from the request body (required)
    """e.g. {"status": "Scheduled"}  or  {"road_name": "MG Road"}"""
    try:
        database.update_scan(scan_id, changes)   # save the changes in the database
    except ValueError as error:                  # the database said the change is not allowed
        raise HTTPException(400, str(error))     # send that message back as error 400
    return {"updated": scan_id}                  # tell the website it worked


# DELETE /api/history/{scan_id}  -> delete ONE inspection.  In: its number in the address.  Out: {"deleted": <number>}.
@app.delete("/api/history/{scan_id}")   # decorator: a DELETE request to /api/history/<number> runs the function below
def delete_one(scan_id: int):
    database.delete_scan(scan_id)   # remove it from the database
    return {"deleted": scan_id}     # tell the website which one was deleted


# DELETE /api/history  -> delete ALL inspections.  In: nothing.  Out: {"deleted": "all"}.
@app.delete("/api/history")   # decorator: a DELETE request to /api/history runs the function below
def delete_everything():
    database.delete_all()       # empty the whole history
    return {"deleted": "all"}   # tell the website it worked


# =================================================================
# WEBSITE + SAMPLE PHOTOS (must come AFTER the API routes)
# (the website is mounted at "/", which matches every address; if it came first it would catch the /api calls too)
# =================================================================
# "mount" = attach a whole folder to a web address: /samples/road1.jpg -> the file samples/road1.jpg
app.mount("/samples", StaticFiles(directory=config.SAMPLES_FOLDER), name="samples")

if config.WEBSITE_FOLDER.exists():   # was the website built already (frontend/out folder exists)?
    # serve the built website at "/"; html=True means "/" shows index.html automatically
    app.mount("/", StaticFiles(directory=config.WEBSITE_FOLDER, html=True), name="website")
else:   # website not built yet
    @app.get("/", response_class=HTMLResponse)   # decorator: opening "/" runs the function below and answers with an HTML page
    def website_missing():   # shows a short help message instead of the website
        return "<h3>The website is not built yet.</h3><p>Run <code>./start.sh</code> in the project folder.</p>"
