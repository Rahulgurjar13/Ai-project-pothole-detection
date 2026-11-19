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

import argparse
import csv
from collections import Counter
from pathlib import Path

import config

TINY = 0.01   # boxes smaller than 1% of the photo are too small to learn from


# ---------------------------------------------------------------
# check-folder
# ---------------------------------------------------------------
def check_folder(folder, engine, confidence):
    import cv2
    from detector import Detector
    from report import build_report

    photos = sorted(p for p in Path(folder).iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"))
    if not photos:
        return print(f"No photos found in {folder}")

    config.RESULTS_FOLDER.mkdir(exist_ok=True)
    detector = Detector(engine)
    rows = []
    for photo in photos:
        image = cv2.imread(str(photo))
        if image is None:
            continue
        boxes, scores, seconds = detector.find(image)
        report = build_report(image, boxes, scores, confidence)
        cv2.imwrite(str(config.RESULTS_FOLDER / f"marked_{photo.name}"), report["picture"])
        print(f"  {photo.name:24} {report['count']:3} potholes   road {report['road_score']:3}/100  {report['condition']}")
        rows.append({"photo": photo.name, "potholes": report["count"], "worst": report["worst"],
                     "road_score": report["road_score"], "condition": report["condition"]})

    with open(config.RESULTS_FOLDER / "report.csv", "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nSaved in: {config.RESULTS_FOLDER}")


# ---------------------------------------------------------------
# dataset-check / dataset-clean
# ---------------------------------------------------------------
def read_label(line):
    """'class x y w h' -> (class, x, y, w, h), or None if the line is broken."""
    parts = line.split()
    try:
        cls, x, y, w, h = int(float(parts[0])), *map(float, parts[1:])
    except (ValueError, IndexError, TypeError):
        return None
    if len(parts) != 5 or not (0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1):
        return None
    return cls, x, y, w, h


def label_files(dataset):
    for split in ("train", "valid", "test"):
        yield from sorted((Path(dataset) / split / "labels").glob("*.txt"))


def dataset_check(dataset):
    classes, broken, tiny = Counter(), 0, 0
    for file in label_files(dataset):
        for line in filter(str.strip, file.read_text().splitlines()):
            label = read_label(line)
            if label is None:
                broken += 1
                print(f"  broken line in {file.name}: {line!r}")
            else:
                classes[label[0]] += 1
                tiny += label[3] < TINY or label[4] < TINY
    print("Boxes per class:", dict(sorted(classes.items())))
    print(f"Broken lines: {broken}   Tiny boxes: {tiny}")


def dataset_clean(dataset, keep):
    kept = removed_photos = 0
    for file in label_files(dataset):
        good = []
        for line in file.read_text().splitlines():
            label = read_label(line)
            if label and label[0] in keep and label[3] >= TINY and label[4] >= TINY:
                good.append("0 " + " ".join(f"{v:.6f}" for v in label[1:]))
        if good:
            file.write_text("\n".join(good) + "\n")
            kept += len(good)
        else:                                       # no pothole left: delete label + photo
            file.unlink()
            for ext in (".jpg", ".jpeg", ".png"):
                photo = file.parent.parent / "images" / (file.stem + ext)
                if photo.exists():
                    photo.unlink()
                    removed_photos += 1
    print(f"Kept boxes: {kept}   Removed photos: {removed_photos}")


# ---------------------------------------------------------------
# train
# ---------------------------------------------------------------
def train(data_yaml, base_model, epochs, device):
    from ultralytics import YOLO
    model = YOLO(base_model)
    model.train(data=data_yaml, epochs=epochs, imgsz=640, batch=8, device=device,
                patience=30, fliplr=0.5, mosaic=0.5, hsv_v=0.4,      # random flips/brightness = learns more
                project=str(config.PROJECT_FOLDER / "runs"), name="pothole")
    metrics = model.val(data=data_yaml, device=device)
    print(f"Precision {metrics.box.mp:.3f}   Recall {metrics.box.mr:.3f}   mAP50 {metrics.box.map50:.3f}")
    print("Copy runs/pothole/weights/best.pt into models/ and add it to MODEL_FILES in config.py")


# ---------------------------------------------------------------
# the command line
# ---------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pothole project tools")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("check-folder", help="find potholes in every photo of a folder")
    p.add_argument("folder", nargs="?", default=str(config.SAMPLES_FOLDER))
    p.add_argument("--engine", default=config.DEFAULT_ENGINE, choices=list(config.ENGINES))
    p.add_argument("--confidence", type=float, default=0.15)

    p = sub.add_parser("dataset-check", help="check a YOLO dataset (changes nothing)")
    p.add_argument("dataset")

    p = sub.add_parser("dataset-clean", help="clean a YOLO dataset (changes files!)")
    p.add_argument("dataset")
    p.add_argument("--keep", type=int, nargs="+", default=[0], help="class numbers that are potholes")

    p = sub.add_parser("train", help="train your own model")
    p.add_argument("data_yaml")
    p.add_argument("--model", default="yolov8n.pt")
    p.add_argument("--epochs", type=int, default=100)
    p.add_argument("--device", default="cpu", help="cpu, mps (Apple chip) or 0 (NVIDIA GPU)")

    args = parser.parse_args()
    if args.command == "check-folder":
        check_folder(args.folder, args.engine, args.confidence)
    elif args.command == "dataset-check":
        dataset_check(args.dataset)
    elif args.command == "dataset-clean":
        dataset_clean(args.dataset, set(args.keep))
    else:
        train(args.data_yaml, args.model, args.epochs, args.device)
