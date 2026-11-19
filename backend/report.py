"""
report.py  -  turns the AI's boxes into a full report
======================================================

    boxes + scores  ->  filter  ->  danger score per pothole  ->  road score  ->  draw on photo

DANGER SCORE of one pothole (0 to 100) - 4 simple ideas:
    1. SIZE    bigger pothole = worse                          up to 50 points
    2. CENTRE  in the middle of the road = worse (cars drive)  up to 20 points
    3. CLOSE   lower in the photo = closer to the car = worse  up to 15 points
    4. SURE    the surer the AI is, the more we trust it       up to 15 points

ROAD SCORE (0 to 100): starts at 100, every pothole takes points away.

REPAIR PLAN: estimated size (m²), asphalt (kg), cost and how soon to repair each pothole.
"""

import cv2

import config
from detector import road_check


# =================================================================
# PART 1: scores
# =================================================================
def danger_score(box, width, height, confidence):
    x1, y1, x2, y2 = box
    size_share = (x2 - x1) * (y2 - y1) / (width * height)              # share of the photo
    size = min(size_share / 0.05, 1.0) * 50                             # 5% of the photo = full 50
    centre = (1 - abs((x1 + x2) / 2 - width / 2) / (width / 2)) * 20    # 1 in the middle, 0 at the edge
    close = ((y1 + y2) / 2 / height) * 15                               # 0 at the top, 1 at the bottom
    sure = confidence * 15
    return round(size + centre + close + sure, 1)


def severity_level(score):
    """Danger score -> "Low" / "Medium" / "High" / "Critical"."""
    return next(name for minimum, name in config.SEVERITY_LEVELS if score >= minimum)


def road_condition(score):
    """Road score -> (name, advice), e.g. ("Good", "Small wear...")."""
    return next((name, advice) for minimum, name, advice in config.ROAD_CONDITIONS if score >= minimum)


def repair_estimate(level, size_share):
    """
    Rough repair plan for ONE pothole (numbers come from config.py, section 6).
        size_share = part of the photo the pothole covers (0.01 = 1%)
        area   = size_share x road area in a normal photo (m²)
        volume = area x depth  -> asphalt needed (kg)
        cost   = fixed cost + area x cost per m²
    """
    rule = config.REPAIR[level]
    area_m2 = size_share * config.ROAD_AREA_IN_PHOTO_M2
    asphalt_kg = area_m2 * rule["depth_cm"] / 100 * config.ASPHALT_KG_PER_M3
    return {
        "area_m2": round(area_m2, 2),
        "asphalt_kg": round(asphalt_kg, 1),
        "cost": round(config.COST_PER_POTHOLE + area_m2 * rule["cost_per_m2"]),
        "hours": round(config.CREW_HOURS_PER_POTHOLE + area_m2 * config.CREW_HOURS_PER_M2, 1),
        "repair_within": rule["repair_within"],
    }


# =================================================================
# PART 2: drawing the boxes
# =================================================================
WHITE, BLACK, FONT = (255, 255, 255), (10, 10, 10), cv2.FONT_HERSHEY_SIMPLEX


def draw(image, potholes):
    """
    White box with black outline (visible on any road) + black label "#2  High  81%".
    Small photos are enlarged first so boxes and labels stay sharp.
    """
    scale = max(1.0, 720 / min(image.shape[:2]))
    picture = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC) if scale > 1 else image.copy()
    height, width = picture.shape[:2]

    short_side = min(height, width)
    line = max(2, round(short_side / 360))
    text_size = max(0.5, short_side / 1300)
    text_line = max(1, round(text_size * 1.6))
    short_labels = len(potholes) > 6          # many potholes -> just "#3" so the photo stays clear

    boxes = [[int(v * scale) for v in p["box"]] for p in potholes]
    for x1, y1, x2, y2 in boxes:              # boxes first, labels on top
        cv2.rectangle(picture, (x1, y1), (x2, y2), BLACK, line + 2, cv2.LINE_AA)
        cv2.rectangle(picture, (x1, y1), (x2, y2), WHITE, line, cv2.LINE_AA)

    used = []                                 # labels already placed (so they don't cover each other)
    for p, (x1, y1, x2, y2) in zip(potholes, boxes):
        text = f"#{p['number']}" if short_labels else f"#{p['number']}  {p['level']}  {p['confidence']:.0%}"
        (tw, th), _ = cv2.getTextSize(text, FONT, text_size, text_line)
        pad = max(3, int(th * 0.4))
        lw, lh = tw + 2 * pad, th + 2 * pad
        left = min(max(0, x1), width - lw)

        # try: above the box, inside the top, below the box, inside the bottom
        spots = [min(max(0, t), height - lh) for t in (y1 - lh, y1, y2, y2 - lh)]
        free = [t for t in spots if not any(left < u[2] and u[0] < left + lw and t < u[3] and u[1] < t + lh for u in used)]
        top = (free or spots)[0]
        used.append((left, top, left + lw, top + lh))

        cv2.rectangle(picture, (left, top), (left + lw, top + lh), BLACK, -1)
        cv2.putText(picture, text, (left + pad, top + th + pad - 1), FONT, text_size, WHITE, text_line, cv2.LINE_AA)
    return picture


# =================================================================
# PART 3: the report
# =================================================================
def build_report(image, boxes, scores, min_confidence=0.15, use_road_check=True, draw_picture=True):
    """Everything the website needs, as one dictionary.
    draw_picture=False skips drawing (the live camera draws its own boxes - faster)."""
    keep = scores >= min_confidence                        # 1. only potholes the AI is sure enough about
    boxes, scores = boxes[keep], scores[keep]
    if use_road_check:                                     # 2. remove grass / lane paint
        boxes, scores = road_check(image, boxes, scores)

    height, width = image.shape[:2]                        # 3. grade every pothole
    potholes = []
    for number, (box, conf) in enumerate(zip(boxes, scores), start=1):
        danger = danger_score(box, width, height, float(conf))
        level = severity_level(danger)
        size_share = (box[2] - box[0]) * (box[3] - box[1]) / (width * height)
        potholes.append({
            "number": number, "box": box, "confidence": float(conf),
            "danger": danger, "level": level, "size_percent": round(100 * size_share, 2),
            "repair": repair_estimate(level, size_share),
        })

    levels = [p["level"] for p in potholes]                # 4. road score
    score = max(0, 100 - sum(config.ROAD_PENALTY[level] for level in levels))
    condition, advice = road_condition(score)

    repairs = [p["repair"] for p in potholes]              # 5. total repair plan
    worst = max(levels, key=config.LEVEL_ORDER.index) if levels else None   # repair starts with the worst one

    return {
        "potholes": potholes,
        "count": len(potholes),
        "counts": {level: levels.count(level) for level in config.LEVEL_ORDER},
        "worst": worst or "None",
        "road_score": score,
        "condition": condition,
        "advice": advice,
        "repair_plan": {
            "currency": config.CURRENCY,
            "total_cost": sum(r["cost"] for r in repairs),
            "total_area_m2": round(sum(r["area_m2"] for r in repairs), 2),
            "asphalt_kg": round(sum(r["asphalt_kg"] for r in repairs), 1),
            "crew_hours": round(sum(r["hours"] for r in repairs), 1),
            "start_within": config.REPAIR[worst]["repair_within"] if worst else "No repair needed",
        },
        "picture": draw(image, potholes) if draw_picture else None,
    }
