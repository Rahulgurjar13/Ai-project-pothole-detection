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

import cv2                        # OpenCV: a library for working with images (resize, draw boxes, write text)

import config                     # our settings file (severity levels, penalties, repair costs, ...)
from detector import road_check   # helper that throws away boxes that are grass or lane paint, not potholes


# =================================================================
# PART 1: scores
# =================================================================
# danger_score(): input = one box (x1, y1, x2, y2 in pixels), the photo width and height, and the AI's
# confidence (0 to 1). Output = how dangerous this pothole is, a number from 0 to 100 (1 decimal).
def danger_score(box, width, height, confidence):
    x1, y1, x2, y2 = box                                                # corners: (x1, y1) top-left, (x2, y2) bottom-right
    size_share = (x2 - x1) * (y2 - y1) / (width * height)              # share of the photo
    size = min(size_share / 0.05, 1.0) * 50                             # 5% of the photo = full 50
    centre = (1 - abs((x1 + x2) / 2 - width / 2) / (width / 2)) * 20    # 1 in the middle, 0 at the edge
    close = ((y1 + y2) / 2 / height) * 15                               # 0 at the top, 1 at the bottom
    sure = confidence * 15                                              # 100% sure = full 15 points
    return round(size + centre + close + sure, 1)                       # add the 4 parts, round to 1 decimal


# severity_level(): input = a danger score. Output = its level name, e.g. "High".
def severity_level(score):
    """Danger score -> "Low" / "Medium" / "High" / "Critical"."""
    # SEVERITY_LEVELS is sorted from highest minimum to lowest; next() returns the FIRST level whose minimum we reach.
    return next(name for minimum, name in config.SEVERITY_LEVELS if score >= minimum)


# road_condition(): input = a road score (0-100). Output = (condition name, advice text).
def road_condition(score):
    """Road score -> (name, advice), e.g. ("Good", "Small wear...")."""
    # Same idea as above: the first row in ROAD_CONDITIONS whose minimum the score reaches.
    return next((name, advice) for minimum, name, advice in config.ROAD_CONDITIONS if score >= minimum)


# repair_estimate(): input = the pothole's level and its share of the photo.
# Output = a dictionary with its area, asphalt, cost, crew hours and how soon to fix it.
def repair_estimate(level, size_share):
    """
    Rough repair plan for ONE pothole (numbers come from config.py, section 6).
        size_share = part of the photo the pothole covers (0.01 = 1%)
        area   = size_share x road area in a normal photo (m²)
        volume = area x depth  -> asphalt needed (kg)
        cost   = fixed cost + area x cost per m²
    """
    rule = config.REPAIR[level]                                         # repair numbers for this level (depth, cost per m², ...)
    area_m2 = size_share * config.ROAD_AREA_IN_PHOTO_M2                 # turn "share of photo" into square metres (a guess)
    asphalt_kg = area_m2 * rule["depth_cm"] / 100 * config.ASPHALT_KG_PER_M3  # volume (m², cm -> m) x weight per m³
    return {
        "area_m2": round(area_m2, 2),                                   # area, 2 decimals
        "asphalt_kg": round(asphalt_kg, 1),                             # asphalt needed, 1 decimal
        "cost": round(config.COST_PER_POTHOLE + area_m2 * rule["cost_per_m2"]),  # fixed cost + size-based cost
        "hours": round(config.CREW_HOURS_PER_POTHOLE + area_m2 * config.CREW_HOURS_PER_M2, 1),  # work time for the crew
        "repair_within": rule["repair_within"],                         # how soon, e.g. "Within 30 days"
    }


# =================================================================
# PART 2: drawing the boxes
# =================================================================
# Colours are (Blue, Green, Red) in OpenCV; FONT = the plain built-in OpenCV font.
WHITE, BLACK, FONT = (255, 255, 255), (10, 10, 10), cv2.FONT_HERSHEY_SIMPLEX


# draw(): input = the photo and the list of graded potholes. Output = a new picture with boxes and labels drawn.
def draw(image, potholes):
    """
    White box with black outline (visible on any road) + black label "#2  High  81%".
    Small photos are enlarged first so boxes and labels stay sharp.
    """
    scale = max(1.0, 720 / min(image.shape[:2]))   # how much to enlarge so the short side is at least 720 px (never shrink)
    # Enlarge if needed (INTER_CUBIC = smooth resizing); otherwise work on a copy so the original photo is not changed.
    picture = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC) if scale > 1 else image.copy()
    height, width = picture.shape[:2]              # size of the picture we draw on

    short_side = min(height, width)                # the shorter side, used to size lines and text
    line = max(2, round(short_side / 360))         # box line thickness (at least 2 px), grows with the picture
    text_size = max(0.5, short_side / 1300)        # font size (at least 0.5), grows with the picture
    text_line = max(1, round(text_size * 1.6))     # thickness of the letters
    short_labels = len(potholes) > 6          # many potholes -> just "#3" so the photo stays clear

    boxes = [[int(v * scale) for v in p["box"]] for p in potholes]  # move each box to the enlarged size (whole pixels)
    for x1, y1, x2, y2 in boxes:              # boxes first, labels on top
        cv2.rectangle(picture, (x1, y1), (x2, y2), BLACK, line + 2, cv2.LINE_AA)  # thick black outline (LINE_AA = smooth)
        cv2.rectangle(picture, (x1, y1), (x2, y2), WHITE, line, cv2.LINE_AA)      # thinner white box on top of it

    used = []                                 # labels already placed (so they don't cover each other)
    for p, (x1, y1, x2, y2) in zip(potholes, boxes):  # each pothole together with its scaled box
        # Label text: "#3" when there are many potholes, otherwise e.g. "#3  High  81%".
        text = f"#{p['number']}" if short_labels else f"#{p['number']}  {p['level']}  {p['confidence']:.0%}"
        (tw, th), _ = cv2.getTextSize(text, FONT, text_size, text_line)  # width and height the text will take
        pad = max(3, int(th * 0.4))           # empty space around the text inside the label
        lw, lh = tw + 2 * pad, th + 2 * pad   # full label width and height (text + padding on both sides)
        left = min(max(0, x1), width - lw)    # label starts at the box's left edge, but stays inside the picture

        # try: above the box, inside the top, below the box, inside the bottom
        spots = [min(max(0, t), height - lh) for t in (y1 - lh, y1, y2, y2 - lh)]  # 4 possible tops, kept inside picture
        # Keep only the spots where the label would NOT overlap a label already placed (rectangle overlap check).
        free = [t for t in spots if not any(left < u[2] and u[0] < left + lw and t < u[3] and u[1] < t + lh for u in used)]
        top = (free or spots)[0]              # first free spot; if none is free, just use the first spot
        used.append((left, top, left + lw, top + lh))  # remember where this label went

        cv2.rectangle(picture, (left, top), (left + lw, top + lh), BLACK, -1)  # black label background (-1 = filled)
        # Write the white text on the label.
        cv2.putText(picture, text, (left + pad, top + th + pad - 1), FONT, text_size, WHITE, text_line, cv2.LINE_AA)
    return picture                            # the finished picture with all boxes and labels


# =================================================================
# PART 3: the report
# =================================================================
# build_report(): input = the photo, the AI's boxes and confidence scores, and some options.
# Output = one dictionary with every pothole, the counts, road score, repair plan and the drawn picture.
def build_report(image, boxes, scores, min_confidence=0.15, use_road_check=True, draw_picture=True):
    """Everything the website needs, as one dictionary.
    draw_picture=False skips drawing (the live camera draws its own boxes - faster)."""
    keep = scores >= min_confidence                        # 1. only potholes the AI is sure enough about
    boxes, scores = boxes[keep], scores[keep]              # keep only those boxes and their scores (True/False filter)
    if use_road_check:                                     # 2. remove grass / lane paint
        boxes, scores = road_check(image, boxes, scores)   # gives back only the boxes that look like real road

    height, width = image.shape[:2]                        # 3. grade every pothole
    potholes = []                                          # the graded potholes will be collected here
    for number, (box, conf) in enumerate(zip(boxes, scores), start=1):  # go through each box, numbered 1, 2, 3...
        danger = danger_score(box, width, height, float(conf))          # danger 0-100
        level = severity_level(danger)                                  # "Low" / "Medium" / "High" / "Critical"
        size_share = (box[2] - box[0]) * (box[3] - box[1]) / (width * height)  # box area / photo area
        potholes.append({                                  # save all facts about this pothole
            "number": number, "box": box, "confidence": float(conf),
            "danger": danger, "level": level, "size_percent": round(100 * size_share, 2),  # size as a % of the photo
            "repair": repair_estimate(level, size_share),  # its repair plan
        })

    levels = [p["level"] for p in potholes]                # 4. road score
    score = max(0, 100 - sum(config.ROAD_PENALTY[level] for level in levels))  # 100 minus penalties, never below 0
    condition, advice = road_condition(score)              # turn the score into a name + advice

    repairs = [p["repair"] for p in potholes]              # 5. total repair plan
    worst = max(levels, key=config.LEVEL_ORDER.index) if levels else None   # repair starts with the worst one

    return {                                               # everything the website needs, in one dictionary
        "potholes": potholes,                              # the list of graded potholes
        "count": len(potholes),                            # how many potholes
        "counts": {level: levels.count(level) for level in config.LEVEL_ORDER},  # how many per level
        "worst": worst or "None",                          # worst level, or the text "None" if no potholes
        "road_score": score,                               # 0-100
        "condition": condition,                            # e.g. "Good"
        "advice": advice,                                  # e.g. "Small wear. Check again later."
        "repair_plan": {                                   # totals for all potholes together
            "currency": config.CURRENCY,                   # money sign, e.g. ₹
            "total_cost": sum(r["cost"] for r in repairs),                       # add up all costs
            "total_area_m2": round(sum(r["area_m2"] for r in repairs), 2),      # add up all areas
            "asphalt_kg": round(sum(r["asphalt_kg"] for r in repairs), 1),      # add up all asphalt
            "crew_hours": round(sum(r["hours"] for r in repairs), 1),           # add up all work hours
            # how soon to start = the deadline of the worst pothole
            "start_within": config.REPAIR[worst]["repair_within"] if worst else "No repair needed",
        },
        "picture": draw(image, potholes) if draw_picture else None,  # the marked photo, or None if drawing was skipped
    }
