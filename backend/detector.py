"""
detector.py  -  finds potholes in a photo with the YOLO AI models
==================================================================

What is a "box"?
    4 numbers [x1, y1, x2, y2]: the top-left and bottom-right corner of a pothole.
    Every pothole the AI finds = 1 box + 1 score (how sure the AI is, 0 to 1).

The steps (see Detector.find at the bottom):
    1. Every main model looks at the photo and returns boxes.
    2. The helper model looks too (on big photos also square by square).
    3. Boxes from all models are MERGED: boxes on the same pothole become one box.
    4. Duplicates (a box inside a stronger box) are removed.
"""

import os
import time

os.environ.setdefault("YOLO_OFFLINE", "true")   # never go online during a demo

import cv2
import numpy as np
import torch
from ultralytics import YOLO

import config

# Keep the computer cool: limit how many CPU cores the AI may use.
torch.set_num_threads(config.CPU_THREADS)
cv2.setNumThreads(1)


# =================================================================
# PART 1: running ONE model
# =================================================================
def load_model(name):
    """Load a model by its short name, e.g. "YOLOv8s"."""
    path = config.MODEL_FILES[name]
    if not path.exists():
        raise FileNotFoundError(f"Model file is missing: {path}")
    return YOLO(str(path))


def run_model(model, image):
    """Run ONE model on ONE image. Returns boxes (N x 4) and scores (N), potholes only."""
    result = model.predict(image, conf=config.LOWEST_CONFIDENCE, iou=0.5, verbose=False, device="cpu")[0]

    # Some models know several classes; keep only the ones named "pothole".
    pothole_ids = [i for i, name in model.names.items() if "pothole" in str(name).lower()]
    pothole_ids = pothole_ids or list(model.names)
    keep = np.isin(result.boxes.cls.cpu().numpy().astype(int), pothole_ids)
    return result.boxes.xyxy.cpu().numpy()[keep], result.boxes.conf.cpu().numpy()[keep]


def run_model_with_tiles(model, image):
    """
    For BIG photos: check the whole photo AND every square ("tile") of it.
    Tiles keep full detail, so tiny far-away potholes are found too.
    """
    boxes, scores = run_model(model, image)
    height, width = image.shape[:2]
    if max(height, width) <= config.TILE_ABOVE:
        return boxes, scores                          # small photo: no tiles needed

    all_boxes, all_scores = list(boxes), list(scores)
    step = int(config.TILE_SIZE * (1 - config.TILE_OVERLAP))
    lefts = sorted(set(list(range(0, max(width - config.TILE_SIZE, 0) + 1, step)) + [max(width - config.TILE_SIZE, 0)]))
    tops = sorted(set(list(range(0, max(height - config.TILE_SIZE, 0) + 1, step)) + [max(height - config.TILE_SIZE, 0)]))

    for top in tops:
        for left in lefts:
            right, bottom = min(left + config.TILE_SIZE, width), min(top + config.TILE_SIZE, height)
            tile_boxes, tile_scores = run_model(model, image[top:bottom, left:right])
            tile_w, tile_h = right - left, bottom - top

            for (x1, y1, x2, y2), score in zip(tile_boxes, tile_scores):
                # skip boxes cut by a tile edge (the whole pothole is in a neighbour tile)
                cut = ((x1 < 4 and left > 0) or (y1 < 4 and top > 0) or
                       (x2 > tile_w - 4 and right < width) or (y2 > tile_h - 4 and bottom < height))
                # skip big boxes (big potholes were already found on the whole photo)
                big = (x2 - x1) * (y2 - y1) > 0.2 * tile_w * tile_h
                if not cut and not big:
                    all_boxes.append([x1 + left, y1 + top, x2 + left, y2 + top])   # tile -> photo position
                    all_scores.append(score)

    return as_arrays(all_boxes, all_scores)


# =================================================================
# PART 2: box maths (merge, remove duplicates, road check)
# =================================================================
def area(box):
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def shared_area(a, b):
    """Area where two boxes cover the same pixels."""
    return area([max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])])


def overlap(a, b):
    """0 = boxes don't touch, 1 = exactly the same box. (Called "IoU" in computer vision.)"""
    shared = shared_area(a, b)
    total = area(a) + area(b) - shared
    return shared / total if total > 0 else 0.0


def merge_boxes(main_results, helper_result=None):
    """
    Merge the boxes of several models into ONE list ("Weighted Box Fusion").
      - Boxes that overlap a lot are the same pothole -> one group.
      - Each group becomes one box (average position; surer boxes count more).
      - Score = sum of main-model scores / number of main models.
        So a pothole that BOTH models see scores higher than one only one model sees.
      - The helper can lift a score up to 70% of its own score.
    """
    pile = [(np.asarray(b, float), float(s), False) for boxes, scores in main_results for b, s in zip(boxes, scores)]
    if helper_result is not None:
        pile += [(np.asarray(b, float), float(s), True) for b, s in zip(*helper_result)]
    pile.sort(key=lambda item: -item[1])          # most confident first

    groups = []                                    # each group = one pothole
    for box, score, is_helper in pile:
        best = max(groups, key=lambda g: overlap(box, g["box"]), default=None)
        if best is None or overlap(box, best["box"]) <= config.SAME_POTHOLE:
            groups.append({"box": box, "members": [(box, score, is_helper)]})
            continue
        best["members"].append((box, score, is_helper))
        weights = np.array([m[1] for m in best["members"]])
        best["box"] = (np.array([m[0] for m in best["members"]]) * weights[:, None]).sum(0) / weights.sum()

    n_main = max(len(main_results), 1)
    boxes, scores = [], []
    for g in groups:
        main = [s for _, s, helper in g["members"] if not helper]
        main_score = max(main) if len(main) > n_main else sum(main) / n_main
        helper_score = config.HELPER_TRUST * max([s for _, s, helper in g["members"] if helper], default=0.0)
        boxes.append(g["box"])
        scores.append(max(main_score, helper_score))
    return as_arrays(boxes, scores)


def remove_duplicates(boxes, scores):
    """Remove a box when most of it lies inside a surer box (or the other way round)."""
    kept = []
    for i in np.argsort(-scores):
        smaller = lambda j: max(min(area(boxes[i]), area(boxes[j])), 1e-9)
        if all(shared_area(boxes[i], boxes[j]) / smaller(j) <= config.INSIDE_OTHER_BOX for j in kept):
            kept.append(i)
    return as_arrays([boxes[i] for i in kept], [scores[i] for i in kept])


def road_check(image, boxes, scores):
    """
    Throw away boxes that are clearly not potholes:
      - mostly GREEN  -> grass or trees
      - tall and mostly WHITE -> painted lane line
    Colours are read in HSV (Hue = colour, Saturation = colour strength, Value = brightness).
    """
    kept_boxes, kept_scores = [], []
    for box, score in zip(boxes, scores):
        x1, y1, x2, y2 = [int(v) for v in box]
        piece = image[max(0, y1):y2, max(0, x1):x2]
        if piece.size == 0:
            continue
        hue, sat, val = cv2.split(cv2.cvtColor(piece, cv2.COLOR_BGR2HSV))
        green = ((hue >= 30) & (hue <= 90) & (sat >= 60) & (val >= 40)).mean()
        white = ((sat <= 40) & (val >= 190)).mean()
        tall = (y2 - y1) > 1.2 * (x2 - x1)
        if green <= config.MAX_GREEN and not (tall and white > config.MAX_WHITE):
            kept_boxes.append(box)
            kept_scores.append(score)
    return as_arrays(kept_boxes, kept_scores)


def as_arrays(boxes, scores):
    """Python lists -> numpy arrays (also correct when the lists are empty)."""
    return np.array(boxes, dtype=float).reshape(-1, 4), np.array(scores, dtype=float)


# =================================================================
# PART 3: the Detector (puts it all together)
# =================================================================
class Detector:
    """
    Example:
        detector = Detector("Ensemble", get_model=load_model)
        boxes, scores, seconds = detector.find(image)
    """

    def __init__(self, engine, get_model=load_model):
        settings = config.ENGINES[engine]
        self.main_models = [get_model(name) for name in settings["main"]]
        self.helper_model = get_model(settings["helper"]) if settings["helper"] else None

    def find(self, image):
        """Returns boxes, scores (surest first) and the time it took in seconds."""
        start = time.time()
        main_results = [run_model(model, image) for model in self.main_models]
        helper_result = run_model_with_tiles(self.helper_model, image) if self.helper_model else None

        if len(main_results) == 1 and helper_result is None:
            boxes, scores = main_results[0]          # one model: nothing to merge
        else:
            boxes, scores = merge_boxes(main_results, helper_result)
        boxes, scores = remove_duplicates(*as_arrays(boxes, scores))

        order = np.argsort(-scores)
        return boxes[order], scores[order], time.time() - start
