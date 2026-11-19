"""
tools.py  -  extra commands you run in the terminal (no website needed)
========================================================================
Run them from the backend folder:

    ../.venv/bin/python tools.py check-folder ../samples
        -> finds potholes in every photo of a folder,
           saves the marked photos + report.csv into the "results" folder

    ../.venv/bin/python tools.py dataset-check ../my_dataset
        -> checks a YOLO training dataset: boxes per class, broken lines, tiny boxes

    ../.venv/bin/python tools.py dataset-clean ../my_dataset --keep 0 2
        -> keeps only pothole classes (renamed to 0), removes broken/tiny boxes
           and photos with no pothole left.  MAKE A BACKUP FIRST!

    ../.venv/bin/python tools.py train ../my_dataset/data.yaml --epochs 50
        -> trains your own YOLO model

A YOLO dataset looks like:  train/images, train/labels, valid/images, valid/labels, data.yaml
Each label .txt has one line per pothole:  class x_center y_center width height  (numbers 0-1)
"""

import argparse                    # built-in library that reads the words typed after "python tools.py ..."
import csv                         # built-in library to write .csv files (tables that Excel can open)
from collections import Counter    # Counter = a dictionary that counts things (e.g. how many boxes per class)
from pathlib import Path           # Path = an easy way to work with file and folder paths

import config                      # our own settings file (config.py): folder names, engines, etc.

TINY = 0.01   # boxes smaller than 1% of the photo are too small to learn from


# ---------------------------------------------------------------
# check-folder
# ---------------------------------------------------------------
# check_folder: finds potholes in every photo inside one folder.
# In:  folder = path of the folder with photos, engine = which AI model to use,
#      confidence = lowest AI score (0-1) we accept as a real pothole.
# Out: returns nothing; saves "marked_<name>" photos and report.csv into the results folder
#      and prints one line per photo.
def check_folder(folder, engine, confidence):
    import cv2                              # OpenCV: reads and saves images (imported here so other commands start faster)
    from detector import Detector           # our class that runs the AI model on a picture
    from report import build_report         # our function that counts potholes, grades them and draws boxes

    # list every file in the folder whose ending is .jpg/.jpeg/.png/.webp (lower() so ".JPG" also works), sorted A-Z
    photos = sorted(p for p in Path(folder).iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"))
    if not photos:                                   # if the list is empty (no photos found)...
        return print(f"No photos found in {folder}")  # ...print a message and stop the function here

    config.RESULTS_FOLDER.mkdir(exist_ok=True)   # make the results folder (exist_ok=True = no error if it already exists)
    detector = Detector(engine)                  # load the chosen AI model once, to reuse for every photo
    rows = []                                    # empty list; we add one row per photo for the CSV report
    for photo in photos:                         # go through the photos one by one
        image = cv2.imread(str(photo))           # read the photo file into memory as a grid of pixel numbers
        if image is None:                        # imread gives None when the file cannot be read (broken file)
            continue                             # skip this photo and go to the next one
        boxes, scores, seconds = detector.find(image)   # run the AI: boxes = pothole positions, scores = AI confidence, seconds = time taken
        report = build_report(image, boxes, scores, confidence)   # keep boxes above "confidence", grade them, draw them on the photo
        # save the photo with boxes drawn on it as "marked_<original name>" in the results folder
        cv2.imwrite(str(config.RESULTS_FOLDER / f"marked_{photo.name}"), report["picture"])
        # print one neat line: name (24 chars wide), pothole count (3 wide), road score out of 100, condition word
        print(f"  {photo.name:24} {report['count']:3} potholes   road {report['road_score']:3}/100  {report['condition']}")
        # add this photo's results as one row (a dictionary) to the list for the CSV file
        rows.append({"photo": photo.name, "potholes": report["count"], "worst": report["worst"],
                     "road_score": report["road_score"], "condition": report["condition"]})

    # open (create) report.csv for writing; "w" = write mode, newline="" stops extra blank lines on Windows
    with open(config.RESULTS_FOLDER / "report.csv", "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))   # CSV writer; column names = keys of the first row
        writer.writeheader()                                   # write the first line with the column names
        writer.writerows(rows)                                 # write one line for every photo
    print(f"\nSaved in: {config.RESULTS_FOLDER}")              # tell the user where the files are (\n = empty line first)


# ---------------------------------------------------------------
# dataset-check / dataset-clean
# ---------------------------------------------------------------
# read_label: reads ONE line of a YOLO label file.
# In:  line = text like "0 0.5 0.4 0.1 0.2".
# Out: a tuple (class, x, y, w, h) with numbers, or None if the line is broken or the numbers are out of range.
def read_label(line):
    """'class x y w h' -> (class, x, y, w, h), or None if the line is broken."""
    parts = line.split()        # cut the line at spaces -> list of text pieces, e.g. ["0", "0.5", ...]
    try:                        # try the next line; if it fails, jump to "except" instead of crashing
        # first piece -> whole number (class); the other pieces -> decimal numbers (x, y, w, h)
        cls, x, y, w, h = int(float(parts[0])), *map(float, parts[1:])
    except (ValueError, IndexError, TypeError):   # text is not a number / pieces missing / wrong count
        return None                               # broken line
    # must have exactly 5 pieces; centre x,y must be between 0 and 1; width/height above 0 and at most 1
    if len(parts) != 5 or not (0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1):
        return None                               # numbers are wrong -> treat as broken
    return cls, x, y, w, h                        # good line: give back the 5 numbers


# label_files: finds all label .txt files of a dataset.
# In:  dataset = path of the dataset folder.
# Out: gives back (yields) every .txt file in train/labels, valid/labels and test/labels, one at a time.
def label_files(dataset):
    for split in ("train", "valid", "test"):      # the three parts of a YOLO dataset
        # glob("*.txt") = all files ending in .txt; "yield from" hands them out one by one (missing folders give none)
        yield from sorted((Path(dataset) / split / "labels").glob("*.txt"))


# dataset_check: looks at every label line and counts things. It changes NO files.
# In:  dataset = path of the dataset folder.
# Out: returns nothing; prints boxes per class, number of broken lines and number of tiny boxes.
def dataset_check(dataset):
    classes, broken, tiny = Counter(), 0, 0       # a counter for classes, and two counts starting at 0
    for file in label_files(dataset):             # go through every label file
        # read the file, split into lines, and skip empty lines (filter keeps only lines with text)
        for line in filter(str.strip, file.read_text().splitlines()):
            label = read_label(line)              # turn the line into numbers (or None if broken)
            if label is None:                     # broken line
                broken += 1                       # count it
                print(f"  broken line in {file.name}: {line!r}")   # show which file and the line (!r shows it in quotes)
            else:                                 # good line
                classes[label[0]] += 1            # add 1 to the count of this class number
                tiny += label[3] < TINY or label[4] < TINY   # width or height under 1%? True counts as 1, False as 0
    print("Boxes per class:", dict(sorted(classes.items())))   # print the class counts, sorted by class number
    print(f"Broken lines: {broken}   Tiny boxes: {tiny}")      # print the two totals


# dataset_clean: rewrites the label files so only good pothole boxes remain. It CHANGES and DELETES files.
# In:  dataset = path of the dataset folder, keep = set of class numbers that mean "pothole".
# Out: returns nothing; every kept box gets class 0; files with no box left are deleted with their photo;
#      prints how many boxes were kept and how many photos were removed.
def dataset_clean(dataset, keep):
    kept = removed_photos = 0                     # both counters start at 0
    for file in label_files(dataset):             # go through every label file
        good = []                                 # the lines we want to keep for this file
        for line in file.read_text().splitlines():   # each line of the file
            label = read_label(line)              # turn it into numbers (None if broken)
            # keep it only if: not broken, class is in "keep", and width and height are at least 1%
            if label and label[0] in keep and label[3] >= TINY and label[4] >= TINY:
                # rebuild the line with class "0" and x, y, w, h written with 6 decimal places
                good.append("0 " + " ".join(f"{v:.6f}" for v in label[1:]))
        if good:                                  # at least one box is left
            file.write_text("\n".join(good) + "\n")   # overwrite the file with the good lines, one per line
            kept += len(good)                     # add how many boxes we kept
        else:                                       # no pothole left: delete label + photo
            file.unlink()                         # unlink = delete the label file
            for ext in (".jpg", ".jpeg", ".png"):   # the photo can have any of these endings
                # the matching photo: go up from "labels" to the split folder, into "images", same name + ending
                photo = file.parent.parent / "images" / (file.stem + ext)
                if photo.exists():                # if that photo file is really there...
                    photo.unlink()                # ...delete it
                    removed_photos += 1           # and count it
    print(f"Kept boxes: {kept}   Removed photos: {removed_photos}")   # print the totals


# ---------------------------------------------------------------
# train
# ---------------------------------------------------------------
# train: teaches (trains) a YOLO model on your dataset, then tests it.
# In:  data_yaml = path of data.yaml, base_model = starting model file (e.g. yolov8n.pt),
#      epochs = how many times to go over all training photos, device = cpu / mps / 0 (GPU).
# Out: returns nothing; saves the trained model under runs/pothole and prints precision, recall and mAP50.
def train(data_yaml, base_model, epochs, device):
    from ultralytics import YOLO                  # the YOLO library (imported here because it is big and slow to load)
    model = YOLO(base_model)                      # load the starting model; we improve it instead of starting from zero
    # start training: imgsz=640 = photos resized to 640 pixels, batch=8 = 8 photos at a time,
    # patience=30 = stop early if 30 epochs give no improvement,
    # fliplr/mosaic/hsv_v = random mirror, mixing photos together, brightness change (more variety),
    # project/name = save results in <project folder>/runs/pothole
    model.train(data=data_yaml, epochs=epochs, imgsz=640, batch=8, device=device,
                patience=30, fliplr=0.5, mosaic=0.5, hsv_v=0.4,      # random flips/brightness = learns more
                project=str(config.PROJECT_FOLDER / "runs"), name="pothole")
    metrics = model.val(data=data_yaml, device=device)   # test the trained model on the validation photos
    # precision = how many found boxes were real potholes, recall = how many real potholes were found,
    # mAP50 = overall accuracy score (box counts as correct if it overlaps the real one by 50%+); :.3f = 3 decimals
    print(f"Precision {metrics.box.mp:.3f}   Recall {metrics.box.mr:.3f}   mAP50 {metrics.box.map50:.3f}")
    print("Copy runs/pothole/weights/best.pt into models/ and add it to MODEL_FILES in config.py")   # next-step hint


# ---------------------------------------------------------------
# the command line
# ---------------------------------------------------------------
if __name__ == "__main__":                        # true only when this file is run directly (not imported)
    parser = argparse.ArgumentParser(description="Pothole project tools")   # the object that reads terminal words
    sub = parser.add_subparsers(dest="command", required=True)   # sub-commands; the chosen name goes into args.command

    p = sub.add_parser("check-folder", help="find potholes in every photo of a folder")   # sub-command 1
    p.add_argument("folder", nargs="?", default=str(config.SAMPLES_FOLDER))   # nargs="?" = optional; default = samples folder
    p.add_argument("--engine", default=config.DEFAULT_ENGINE, choices=list(config.ENGINES))   # only allowed engine names
    p.add_argument("--confidence", type=float, default=0.15)   # minimum AI score, as a decimal number (default 0.15)

    p = sub.add_parser("dataset-check", help="check a YOLO dataset (changes nothing)")   # sub-command 2
    p.add_argument("dataset")                     # required: path of the dataset folder

    p = sub.add_parser("dataset-clean", help="clean a YOLO dataset (changes files!)")   # sub-command 3
    p.add_argument("dataset")                     # required: path of the dataset folder
    # --keep takes one or more whole numbers (nargs="+"); default is just class 0
    p.add_argument("--keep", type=int, nargs="+", default=[0], help="class numbers that are potholes")

    p = sub.add_parser("train", help="train your own model")   # sub-command 4
    p.add_argument("data_yaml")                   # required: path of the data.yaml file
    p.add_argument("--model", default="yolov8n.pt")   # starting model (n = nano, the smallest and fastest YOLOv8)
    p.add_argument("--epochs", type=int, default=100)   # number of training rounds (default 100)
    p.add_argument("--device", default="cpu", help="cpu, mps (Apple chip) or 0 (NVIDIA GPU)")   # where to train

    args = parser.parse_args()                    # read what the user typed; stops with a help message if wrong
    if args.command == "check-folder":            # run the function that matches the chosen sub-command
        check_folder(args.folder, args.engine, args.confidence)   # scan the folder with the typed settings
    elif args.command == "dataset-check":         # else, if the user typed "dataset-check"...
        dataset_check(args.dataset)               # ...only count and report, change nothing
    elif args.command == "dataset-clean":         # else, if the user typed "dataset-clean"...
        dataset_clean(args.dataset, set(args.keep))   # set() removes duplicates and makes "in keep" checks fast
    else:                                         # the only one left is "train"
        train(args.data_yaml, args.model, args.epochs, args.device)   # train a model with the typed settings
