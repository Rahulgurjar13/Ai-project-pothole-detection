"""
config.py  -  ALL settings of the project in one place
======================================================
Want to change something (how sure the AI must be, colours of the score,
how hard the computer works)? Change it HERE, nowhere else.
"""

import os
from pathlib import Path

# ----------------------------------------------------------------
# 1. FOLDERS
# ----------------------------------------------------------------
PROJECT_FOLDER = Path(__file__).resolve().parent.parent   # the main project folder
MODELS_FOLDER = PROJECT_FOLDER / "models"                  # AI model files (.pt)
SAMPLES_FOLDER = PROJECT_FOLDER / "samples"                # example road photos
WEBSITE_FOLDER = PROJECT_FOLDER / "frontend" / "out"       # the built website (made by "npm run build")
RESULTS_FOLDER = PROJECT_FOLDER / "results"                # output of tools.py
DATABASE_FILE = PROJECT_FOLDER / "history.db"              # saved scans (SQLite database, made automatically)

# ----------------------------------------------------------------
# 2. KEEP THE COMPUTER COOL
# ----------------------------------------------------------------
# The AI may use only HALF of the CPU cores (max 4). Less heat, the Mac stays usable.
CPU_THREADS = max(1, min(4, (os.cpu_count() or 2) // 2))

# Videos: frames are made smaller and we check at most a few frames per second.
VIDEO_MAX_WIDTH = 640           # pixels
VIDEO_MAX_CHECKS_PER_SECOND = 5  # the AI rests between frames

# ----------------------------------------------------------------
# 3. AI MODELS
# ----------------------------------------------------------------
# 3 ready-trained YOLO models ("YOLO" = You Only Look Once, an object-finding AI).
MODEL_FILES = {
    "YOLOv8s": MODELS_FOLDER / "best.pt",                   # fast and accurate
    "YOLOv9c": MODELS_FOLDER / "pothole_yolov9c.pt",        # bigger, slower
    "PotholeNet": MODELS_FOLDER / "potholenet_yolo11n.pt",  # small, good at water-filled potholes
}

# An "engine" = which models work together.
#   main   -> these models VOTE together (their boxes are merged)
#   helper -> only ADDS potholes the main models missed
ENGINES = {
    "Ensemble": {"main": ["YOLOv8s", "YOLOv9c"], "helper": "PotholeNet",
                 "about": "YOLOv8s + YOLOv9c + PotholeNet, with tiling. Most complete."},
    "YOLOv8s": {"main": ["YOLOv8s"], "helper": None, "about": "Single YOLOv8s model. Fastest."},
    "YOLOv9c": {"main": ["YOLOv9c"], "helper": None, "about": "Single YOLOv9c model."},
    "PotholeNet": {"main": ["PotholeNet"], "helper": None, "about": "YOLO11n specialised in water-filled potholes."},
}
DEFAULT_ENGINE = "Ensemble"
VIDEO_ENGINE = "YOLOv8s"   # many frames -> use the fastest engine

# ----------------------------------------------------------------
# 4. DETECTION NUMBERS
# ----------------------------------------------------------------
# "Confidence" = how sure the AI is, from 0.0 (not sure) to 1.0 (100% sure).
SENSITIVITY = {
    "High": {"confidence": 0.15, "road_check": True},       # finds faint potholes, ignores grass/paint
    "Balanced": {"confidence": 0.25, "road_check": False},  # only surer potholes
}
LOWEST_CONFIDENCE = 0.01   # the AI keeps everything above 1%; the website filters later

SAME_POTHOLE = 0.45        # two boxes overlapping more than 45% = the same pothole
INSIDE_OTHER_BOX = 0.70    # a box 70% inside a stronger box = duplicate, removed
HELPER_TRUST = 0.70        # a pothole seen ONLY by the helper keeps 70% of its score

# Big photos are also cut into squares ("tiles") so tiny far-away potholes are not lost.
TILE_SIZE = 640            # each square: 640 x 640 pixels
TILE_OVERLAP = 0.25        # squares overlap 25% so no pothole is cut in half
TILE_ABOVE = 960           # only photos bigger than this are cut

# Road check: throw away boxes that are not on the road.
MAX_GREEN = 0.50           # box more than 50% green  -> grass / trees
MAX_WHITE = 0.40           # tall box more than 40% white -> painted lane line

# ----------------------------------------------------------------
# 5. SEVERITY AND ROAD SCORE
# ----------------------------------------------------------------
# Each pothole gets a danger score 0-100. Score at or above the number -> that level.
SEVERITY_LEVELS = [(60, "Critical"), (40, "High"), (20, "Medium"), (0, "Low")]
LEVEL_ORDER = ["Low", "Medium", "High", "Critical"]   # least -> most dangerous

# The road starts at 100 points; every pothole takes some away.
ROAD_PENALTY = {"Low": 3, "Medium": 7, "High": 15, "Critical": 35}

# Road score -> name and advice.
ROAD_CONDITIONS = [
    (85, "Excellent", "Smooth road. No repair needed."),
    (70, "Good", "Small wear. Check again later."),
    (50, "Fair", "Visible damage. Plan a repair."),
    (30, "Poor", "A lot of damage. Repair soon."),
    (0, "Dangerous", "Unsafe road. Repair right away."),
]

# ----------------------------------------------------------------
# 6. REPAIR PLANNER (rough estimates - change them to your city's numbers)
# ----------------------------------------------------------------
# We do not know the real distance to the road, so we ASSUME a normal road photo
# shows about 20 square metres of road. A pothole covering 1% of the photo = 0.2 m².
ROAD_AREA_IN_PHOTO_M2 = 20

CURRENCY = "₹"
# Per severity level:  depth (cm), repair cost per m², and how soon it must be fixed.
REPAIR = {
    "Low":      {"depth_cm": 2, "cost_per_m2": 600,  "repair_within": "Next routine check"},
    "Medium":   {"depth_cm": 4, "cost_per_m2": 900,  "repair_within": "Within 30 days"},
    "High":     {"depth_cm": 6, "cost_per_m2": 1300, "repair_within": "Within 7 days"},
    "Critical": {"depth_cm": 8, "cost_per_m2": 1800, "repair_within": "Within 24 hours"},
}
COST_PER_POTHOLE = 500          # fixed cost per pothole (crew, travel, cleaning)
ASPHALT_KG_PER_M3 = 2300        # cold-mix asphalt weighs about 2.3 tonnes per m³
CREW_HOURS_PER_POTHOLE = 0.5    # setting up, cleaning the hole
CREW_HOURS_PER_M2 = 1.0         # filling and compacting

# ----------------------------------------------------------------
# 7. LIVE CAMERA
# ----------------------------------------------------------------
LIVE_ENGINE = "YOLOv8s"         # the fastest engine, for real-time camera frames
