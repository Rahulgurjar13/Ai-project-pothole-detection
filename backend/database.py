"""
database.py  -  saves every inspection (the history behind Overview + Inspections)
==================================================================================
Uses SQLite: a database that is just ONE file (history.db), built into Python.
No database server to install.

Table "scans" = one row per inspection (checked photo, video or camera snapshot):
    inspection details  -> road name, ward/zone, inspector, notes
    AI results          -> potholes, worst level, road score, potholes per level
    repair              -> estimated cost, STATUS (Open -> Scheduled -> Repaired)
    extra               -> GPS location, small picture

The same photo checked again (e.g. after moving the slider) UPDATES its row
instead of adding a new one, and never resets the repair status.
"""

import sqlite3
from datetime import datetime

import config

STATUSES = ["Open", "Scheduled", "Repaired"]

COLUMNS = {
    "id": "INTEGER PRIMARY KEY AUTOINCREMENT",
    "key": "TEXT UNIQUE",          # fingerprint of the photo (same photo = same key)
    "kind": "TEXT",                # "photo", "video" or "camera"
    "name": "TEXT",                # file name
    "engine": "TEXT",
    "created": "TEXT",             # date and time, e.g. 2026-11-19 14:05
    "road_name": "TEXT", "ward": "TEXT", "inspector": "TEXT", "notes": "TEXT",
    "count": "INTEGER", "worst": "TEXT", "road_score": "INTEGER",
    "low": "INTEGER", "medium": "INTEGER", "high": "INTEGER", "critical": "INTEGER",
    "repair_cost": "INTEGER",
    "status": "TEXT DEFAULT 'Open'",
    "lat": "REAL", "lon": "REAL",  # GPS location (empty if the photo has none)
    "thumbnail": "TEXT",           # small marked picture (as text)
}


def connect():
    """Open the database file (created the first time) and add any missing columns."""
    db = sqlite3.connect(config.DATABASE_FILE)
    db.row_factory = sqlite3.Row                 # rows behave like dictionaries
    db.execute("CREATE TABLE IF NOT EXISTS scans (" + ", ".join(f"{k} {v}" for k, v in COLUMNS.items()) + ")")
    existing = {row["name"] for row in db.execute("PRAGMA table_info(scans)")}
    for column, kind in COLUMNS.items():         # an older history.db gets the new columns
        if column not in existing:
            db.execute(f"ALTER TABLE scans ADD COLUMN {column} {kind}")
    return db


def save_scan(key, kind, name, engine, report, thumbnail, gps=None, details=None):
    """Save (or update) one inspection. Returns its id (used for the inspection number)."""
    details = details or {}
    counts = report["counts"]
    values = {
        "key": key, "kind": kind, "name": name, "engine": engine,
        "created": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "road_name": details.get("road_name", ""), "ward": details.get("ward", ""),
        "inspector": details.get("inspector", ""), "notes": details.get("notes", ""),
        "count": report["count"], "worst": report["worst"], "road_score": report["road_score"],
        "low": counts["Low"], "medium": counts["Medium"], "high": counts["High"], "critical": counts["Critical"],
        "repair_cost": report.get("repair_plan", {}).get("total_cost", 0),
        "lat": gps["lat"] if gps else None, "lon": gps["lon"] if gps else None,
        "thumbnail": thumbnail,
    }
    names = ", ".join(values)
    marks = ", ".join(":" + k for k in values)
    # on a repeat: update everything except the key, the first date and the status
    updates = ", ".join(f"{k} = excluded.{k}" for k in values if k not in ("key", "created"))
    with connect() as db:
        db.execute(f"INSERT INTO scans ({names}) VALUES ({marks}) ON CONFLICT(key) DO UPDATE SET {updates}", values)
        return db.execute("SELECT id FROM scans WHERE key = ?", (key,)).fetchone()["id"]


def update_scan(scan_id, changes):
    """Change the status or the details of one inspection (only these fields are allowed)."""
    allowed = {k: v for k, v in changes.items() if k in ("status", "road_name", "ward", "inspector", "notes")}
    if allowed.get("status") not in (None, *STATUSES):
        raise ValueError("Unknown status")
    if allowed:
        with connect() as db:
            db.execute(f"UPDATE scans SET {', '.join(f'{k} = :{k}' for k in allowed)} WHERE id = :id",
                       {**allowed, "id": scan_id})


def history(limit=500):
    """Newest inspections first + totals for the Overview cards."""
    with connect() as db:
        rows = [dict(r) for r in db.execute("SELECT * FROM scans ORDER BY id DESC LIMIT ?", (limit,))]
        totals = dict(db.execute("""
            SELECT COUNT(*) AS scans, COALESCE(SUM(count), 0) AS potholes,
                   ROUND(COALESCE(AVG(road_score), 0)) AS average_score,
                   COALESCE(SUM(low), 0) AS low, COALESCE(SUM(medium), 0) AS medium,
                   COALESCE(SUM(high), 0) AS high, COALESCE(SUM(critical), 0) AS critical,
                   COALESCE(SUM(repair_cost), 0) AS repair_cost,
                   COALESCE(SUM(CASE WHEN status = 'Open' THEN 1 END), 0) AS open,
                   COALESCE(SUM(CASE WHEN status = 'Scheduled' THEN 1 END), 0) AS scheduled,
                   COALESCE(SUM(CASE WHEN status = 'Repaired' THEN 1 END), 0) AS repaired,
                   COALESCE(SUM(CASE WHEN status != 'Repaired' THEN repair_cost END), 0) AS open_cost,
                   COALESCE(SUM(CASE WHEN status != 'Repaired' THEN critical END), 0) AS open_critical
            FROM scans""").fetchone())
    return {"scans": rows, "totals": totals, "currency": config.CURRENCY, "statuses": STATUSES}


def delete_scan(scan_id):
    with connect() as db:
        db.execute("DELETE FROM scans WHERE id = ?", (scan_id,))


def delete_all():
    with connect() as db:
        db.execute("DELETE FROM scans")
