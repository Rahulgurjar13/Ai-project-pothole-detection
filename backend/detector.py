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

import os    # talk to the operating system (here: set an environment setting)
import time  # measure how many seconds the detection takes

os.environ.setdefault("YOLO_OFFLINE", "true")   # never go online during a demo (set before ultralytics is imported)

import cv2                      # OpenCV = library for working with images (cut, colours, resize)
import numpy as np              # numpy = fast maths on lists of numbers ("arrays"); "np" is its short name
import torch                    # PyTorch = the deep-learning library the YOLO models run on
from ultralytics import YOLO    # the YOLO class: loads a model file and finds objects in images

import config                   # our settings file (config.py)

# Keep the computer cool: limit how many CPU cores the AI may use.
torch.set_num_threads(config.CPU_THREADS)  # PyTorch may use only this many cores
cv2.setNumThreads(1)                       # OpenCV may use only 1 core


# =================================================================
# PART 1: running ONE model
# =================================================================
# In: a short model name. Out: the loaded YOLO model (error if its file is missing).
def load_model(name):
    """Load a model by its short name, e.g. "YOLOv8s"."""
    path = config.MODEL_FILES[name]  # look up the model file path in config.py
    if not path.exists():  # the file is not on the disk
        raise FileNotFoundError(f"Model file is missing: {path}")  # stop with a clear error message
    return YOLO(str(path))  # load the model from the file (str() turns the Path into plain text)


# In: one model and one image. Out: two numpy arrays - pothole boxes and their scores.
def run_model(model, image):
    """Run ONE model on ONE image. Returns boxes (N x 4) and scores (N), potholes only."""
    # predict = let the AI look at the image. conf = keep boxes above 1%; iou=0.5 = the model itself
    # merges its own boxes that overlap more than 50%; verbose=False = no printing; device="cpu" = no GPU.
    # [0] = the result for the first (and only) image.
    result = model.predict(image, conf=config.LOWEST_CONFIDENCE, iou=0.5, verbose=False, device="cpu")[0]

    # Some models know several classes; keep only the ones named "pothole".
    # model.names = {class number: class name}; collect the numbers whose name contains "pothole"
    pothole_ids = [i for i, name in model.names.items() if "pothole" in str(name).lower()]
    pothole_ids = pothole_ids or list(model.names)  # if no class is called "pothole", keep all classes
    # cls = class number of each box; .cpu().numpy() = turn the PyTorch tensor into a numpy array;
    # np.isin = True/False per box: is its class a pothole class?
    keep = np.isin(result.boxes.cls.cpu().numpy().astype(int), pothole_ids)
    # xyxy = box corners [x1, y1, x2, y2]; conf = scores; [keep] = keep only the pothole boxes
    return result.boxes.xyxy.cpu().numpy()[keep], result.boxes.conf.cpu().numpy()[keep]


# In: one model and one image. Out: boxes and scores from the whole photo plus all its tiles.
def run_model_with_tiles(model, image):
    """
    For BIG photos: check the whole photo AND every square ("tile") of it.
    Tiles keep full detail, so tiny far-away potholes are found too.
    """
    boxes, scores = run_model(model, image)  # first: look at the whole photo
    height, width = image.shape[:2]  # image.shape = (height, width, colours); take the first two
    if max(height, width) <= config.TILE_ABOVE:  # longest side is 960 pixels or less
        return boxes, scores                          # small photo: no tiles needed

    all_boxes, all_scores = list(boxes), list(scores)  # start the lists with the whole-photo results
    step = int(config.TILE_SIZE * (1 - config.TILE_OVERLAP))  # move 640 * 0.75 = 480 pixels to the next tile (so tiles overlap 25%)
    # Left edges of the tiles: 0, 480, 960, ... plus one last tile touching the right edge; set() removes repeats, sorted() orders them
    lefts = sorted(set(list(range(0, max(width - config.TILE_SIZE, 0) + 1, step)) + [max(width - config.TILE_SIZE, 0)]))
    # Top edges of the tiles: same idea, going down the photo
    tops = sorted(set(list(range(0, max(height - config.TILE_SIZE, 0) + 1, step)) + [max(height - config.TILE_SIZE, 0)]))

    for top in tops:  # every row of tiles
        for left in lefts:  # every tile in this row
            right, bottom = min(left + config.TILE_SIZE, width), min(top + config.TILE_SIZE, height)  # tile's right/bottom edge (inside photo)
            tile_boxes, tile_scores = run_model(model, image[top:bottom, left:right])  # cut out the tile and run the model on it
            tile_w, tile_h = right - left, bottom - top  # width and height of this tile

            for (x1, y1, x2, y2), score in zip(tile_boxes, tile_scores):  # every box found in this tile, with its score
                # skip boxes cut by a tile edge (the whole pothole is in a neighbour tile)
                # (a box closer than 4 pixels to an inner tile edge counts as "cut")
                cut = ((x1 < 4 and left > 0) or (y1 < 4 and top > 0) or
                       (x2 > tile_w - 4 and right < width) or (y2 > tile_h - 4 and bottom < height))
                # skip big boxes (big potholes were already found on the whole photo)
                big = (x2 - x1) * (y2 - y1) > 0.2 * tile_w * tile_h  # box covers more than 20% of the tile
                if not cut and not big:  # keep only whole, small boxes
                    all_boxes.append([x1 + left, y1 + top, x2 + left, y2 + top])   # tile -> photo position
                    all_scores.append(score)  # keep its score too

    return as_arrays(all_boxes, all_scores)  # turn the lists into numpy arrays


# =================================================================
# PART 2: box maths (merge, remove duplicates, road check)
# =================================================================
# In: one box [x1, y1, x2, y2]. Out: its area (width x height); 0 if the box is "upside down".
def area(box):
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])  # width * height (max(0, ...) stops negative sizes)


# In: two boxes. Out: the area where they overlap (0 if they don't touch).
def shared_area(a, b):
    """Area where two boxes cover the same pixels."""
    # the overlap box: biggest left/top edge and smallest right/bottom edge of the two boxes
    return area([max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])])


# In: two boxes. Out: IoU number 0 to 1 = how much the two boxes overlap.
def overlap(a, b):
    """0 = boxes don't touch, 1 = exactly the same box. (Called "IoU" in computer vision.)"""
    shared = shared_area(a, b)  # "Intersection" = the part both boxes cover
    total = area(a) + area(b) - shared  # "Union" = area covered by either box (shared part counted once)
    return shared / total if total > 0 else 0.0  # IoU = Intersection / Union (0 if both boxes are empty)


# In: results of the main models (+ optional helper result). Out: merged boxes and scores.
def merge_boxes(main_results, helper_result=None):
    """
    Merge the boxes of several models into ONE list ("Weighted Box Fusion").
      - Boxes that overlap a lot are the same pothole -> one group.
      - Each group becomes one box (average position; surer boxes count more).
      - Score = sum of main-model scores / number of main models.
        So a pothole that BOTH models see scores higher than one only one model sees.
      - The helper can lift a score up to 70% of its own score.
    """
    # pile = one big list of (box, score, is_helper) from all main models; is_helper = False
    pile = [(np.asarray(b, float), float(s), False) for boxes, scores in main_results for b, s in zip(boxes, scores)]
    if helper_result is not None:  # there is a helper model
        pile += [(np.asarray(b, float), float(s), True) for b, s in zip(*helper_result)]  # add helper boxes with is_helper = True
    pile.sort(key=lambda item: -item[1])          # most confident first

    groups = []                                    # each group = one pothole
    for box, score, is_helper in pile:  # go through every box, surest first
        best = max(groups, key=lambda g: overlap(box, g["box"]), default=None)  # the group this box overlaps most (None if no groups yet)
        if best is None or overlap(box, best["box"]) <= config.SAME_POTHOLE:  # no group overlaps more than 45%
            groups.append({"box": box, "members": [(box, score, is_helper)]})  # -> it is a new pothole: start a new group
            continue  # go to the next box
        best["members"].append((box, score, is_helper))  # same pothole: add the box to that group
        weights = np.array([m[1] for m in best["members"]])  # the scores of all boxes in the group = their weights
        # new group box = weighted average of all member boxes (surer boxes pull the position more)
        best["box"] = (np.array([m[0] for m in best["members"]]) * weights[:, None]).sum(0) / weights.sum()

    n_main = max(len(main_results), 1)  # number of main models (at least 1, so we never divide by 0)
    boxes, scores = [], []  # the final merged boxes and scores
    for g in groups:  # every pothole group
        main = [s for _, s, helper in g["members"] if not helper]  # scores from the main models only
        # normally: average over the main models (a model that missed it counts as 0);
        # if the group has more main boxes than main models (one model gave several boxes), take the best one
        main_score = max(main) if len(main) > n_main else sum(main) / n_main
        # helper score = 70% of the helper's best score in this group (0 if the helper did not see it)
        helper_score = config.HELPER_TRUST * max([s for _, s, helper in g["members"] if helper], default=0.0)
        boxes.append(g["box"])  # save the merged box
        scores.append(max(main_score, helper_score))  # final score = the higher of the two
    return as_arrays(boxes, scores)  # turn the lists into numpy arrays


# In: boxes and scores. Out: the same, minus boxes that lie mostly inside a surer box.
def remove_duplicates(boxes, scores):
    """Remove a box when most of it lies inside a surer box (or the other way round)."""
    kept = []  # numbers (indexes) of the boxes we keep
    for i in np.argsort(-scores):  # argsort(-scores) = box numbers ordered from surest to least sure
        smaller = lambda j: max(min(area(boxes[i]), area(boxes[j])), 1e-9)  # area of the smaller box of i and j (never 0, to avoid dividing by 0)
        # keep box i only if, for every kept box, the shared part is at most 70% of the smaller box
        if all(shared_area(boxes[i], boxes[j]) / smaller(j) <= config.INSIDE_OTHER_BOX for j in kept):
            kept.append(i)  # not a duplicate: keep it
    return as_arrays([boxes[i] for i in kept], [scores[i] for i in kept])  # only the kept boxes and their scores


# In: the photo, boxes and scores. Out: only the boxes that pass the colour check.
def road_check(image, boxes, scores):
    """
    Throw away boxes that are clearly not potholes:
      - mostly GREEN  -> grass or trees
      - tall and mostly WHITE -> painted lane line
    Colours are read in HSV (Hue = colour, Saturation = colour strength, Value = brightness).
    """
    kept_boxes, kept_scores = [], []  # boxes and scores that pass
    for box, score in zip(boxes, scores):  # every box with its score
        x1, y1, x2, y2 = [int(v) for v in box]  # corners as whole pixel numbers
        piece = image[max(0, y1):y2, max(0, x1):x2]  # cut out the part of the photo inside the box (rows = y, columns = x)
        if piece.size == 0:  # empty cut-out (box outside the photo)
            continue  # skip this box
        # convert the cut-out from BGR (OpenCV's colour order) to HSV and split it into 3 channels
        hue, sat, val = cv2.split(cv2.cvtColor(piece, cv2.COLOR_BGR2HSV))
        green = ((hue >= 30) & (hue <= 90) & (sat >= 60) & (val >= 40)).mean()  # share of pixels that are clearly green (0 to 1)
        white = ((sat <= 40) & (val >= 190)).mean()  # share of pixels that are white (almost no colour, very bright)
        tall = (y2 - y1) > 1.2 * (x2 - x1)  # box is taller than wide, like a lane line seen from a car
        if green <= config.MAX_GREEN and not (tall and white > config.MAX_WHITE):  # not grass and not a lane line
            kept_boxes.append(box)  # keep the box
            kept_scores.append(score)  # keep its score
    return as_arrays(kept_boxes, kept_scores)  # turn the lists into numpy arrays


# In: Python lists of boxes and scores. Out: numpy arrays (boxes always shaped N x 4).
def as_arrays(boxes, scores):
    """Python lists -> numpy arrays (also correct when the lists are empty)."""
    # reshape(-1, 4) = rows of 4 numbers; makes an empty list a (0 x 4) array instead of a wrong shape
    return np.array(boxes, dtype=float).reshape(-1, 4), np.array(scores, dtype=float)


# =================================================================
# PART 3: the Detector (puts it all together)
# =================================================================
# The Detector loads the models of one engine once, then finds potholes in any number of images.
class Detector:
    """
    Example:
        detector = Detector("Ensemble", get_model=load_model)
        boxes, scores, seconds = detector.find(image)
    """

    # In: engine name (e.g. "Ensemble") and a function that loads a model by name. Loads the models.
    def __init__(self, engine, get_model=load_model):
        settings = config.ENGINES[engine]  # which main models and helper this engine uses
        self.main_models = [get_model(name) for name in settings["main"]]  # load every main model
        self.helper_model = get_model(settings["helper"]) if settings["helper"] else None  # load the helper, or None if there is none

    # In: one image. Out: boxes, scores (surest first) and seconds taken.
    def find(self, image):
        """Returns boxes, scores (surest first) and the time it took in seconds."""
        start = time.time()  # remember the start time
        main_results = [run_model(model, image) for model in self.main_models]  # step 1: every main model looks at the photo
        helper_result = run_model_with_tiles(self.helper_model, image) if self.helper_model else None  # step 2: helper looks (with tiles)

        if len(main_results) == 1 and helper_result is None:  # only one model and no helper
            boxes, scores = main_results[0]          # one model: nothing to merge
        else:
            boxes, scores = merge_boxes(main_results, helper_result)  # step 3: merge boxes of all models
        boxes, scores = remove_duplicates(*as_arrays(boxes, scores))  # step 4: remove boxes inside surer boxes

        order = np.argsort(-scores)  # box numbers from highest to lowest score
        return boxes[order], scores[order], time.time() - start  # sorted boxes, sorted scores, seconds taken
