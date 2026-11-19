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

import sqlite3                    # Python's built-in library to talk to an SQLite database file
from datetime import datetime     # used to write the date and time of each inspection

import config                     # our settings file (where history.db is, which currency, ...)

# The 3 repair steps an inspection can be in, in order: not fixed yet -> repair planned -> fixed.
STATUSES = ["Open", "Scheduled", "Repaired"]

# All columns of the "scans" table: column name -> its SQL type (and extra rules).
# A "column" is one piece of information that every row has (like a column in Excel).
COLUMNS = {
    "id": "INTEGER PRIMARY KEY AUTOINCREMENT",  # unique row number, the database counts 1, 2, 3... by itself
    "key": "TEXT UNIQUE",          # fingerprint of the photo (same photo = same key); UNIQUE = no two rows can share it
    "kind": "TEXT",                # "photo", "video" or "camera"
    "name": "TEXT",                # file name
    "engine": "TEXT",              # which AI engine/model did the checking
    "created": "TEXT",             # date and time, e.g. 2026-11-19 14:05
    "road_name": "TEXT", "ward": "TEXT", "inspector": "TEXT", "notes": "TEXT",  # details typed in by the inspector
    "count": "INTEGER", "worst": "TEXT", "road_score": "INTEGER",  # number of potholes, worst level, road score 0-100
    "low": "INTEGER", "medium": "INTEGER", "high": "INTEGER", "critical": "INTEGER",  # how many potholes per level
    "repair_cost": "INTEGER",      # estimated total repair cost
    "status": "TEXT DEFAULT 'Open'",  # repair status; a new row starts as 'Open' if no status is given
    "lat": "REAL", "lon": "REAL",  # GPS location (empty if the photo has none); REAL = number with decimals
    "thumbnail": "TEXT",           # small marked picture (as text)
}


# connect(): no input. Opens history.db, makes sure the table and all columns exist,
# and gives back the open database connection.
def connect():
    """Open the database file (created the first time) and add any missing columns."""
    db = sqlite3.connect(config.DATABASE_FILE)   # open the file (SQLite creates it if it does not exist yet)
    db.row_factory = sqlite3.Row                 # rows behave like dictionaries (row["name"] instead of row[0])
    # Build and run "CREATE TABLE IF NOT EXISTS scans (id INTEGER ..., key TEXT UNIQUE, ...)" from COLUMNS.
    # IF NOT EXISTS = only make the table the first time; later calls do nothing.
    db.execute("CREATE TABLE IF NOT EXISTS scans (" + ", ".join(f"{k} {v}" for k, v in COLUMNS.items()) + ")")
    # PRAGMA table_info = ask SQLite for the list of columns the table has right now; keep just their names.
    existing = {row["name"] for row in db.execute("PRAGMA table_info(scans)")}
    for column, kind in COLUMNS.items():         # an older history.db gets the new columns
        if column not in existing:               # this column is missing from the file on disk
            db.execute(f"ALTER TABLE scans ADD COLUMN {column} {kind}")  # ALTER TABLE = change the table: add it
    return db                                    # give the ready connection to whoever called us


# save_scan(): input = one checked photo/video and its AI report (+ optional GPS and inspector details).
# Saves it as a new row, or updates the old row if the same photo was saved before. Output = the row's id.
def save_scan(key, kind, name, engine, report, thumbnail, gps=None, details=None):
    """Save (or update) one inspection. Returns its id (used for the inspection number)."""
    details = details or {}                      # no details given -> use an empty dictionary so .get() works
    counts = report["counts"]                    # potholes per level, e.g. {"Low": 2, "Medium": 1, ...}
    # One dictionary: column name -> the value to save in that column.
    values = {
        "key": key, "kind": kind, "name": name, "engine": engine,  # what was checked and by which engine
        "created": datetime.now().strftime("%Y-%m-%d %H:%M"),     # current date and time as text, e.g. 2026-11-19 14:05
        "road_name": details.get("road_name", ""), "ward": details.get("ward", ""),  # .get(x, "") = value or "" if missing
        "inspector": details.get("inspector", ""), "notes": details.get("notes", ""),
        "count": report["count"], "worst": report["worst"], "road_score": report["road_score"],  # main AI results
        "low": counts["Low"], "medium": counts["Medium"], "high": counts["High"], "critical": counts["Critical"],
        "repair_cost": report.get("repair_plan", {}).get("total_cost", 0),  # total cost, or 0 if there is no repair plan
        "lat": gps["lat"] if gps else None, "lon": gps["lon"] if gps else None,  # GPS, or None (empty) if no GPS
        "thumbnail": thumbnail,                  # small picture with the boxes drawn on it
    }
    names = ", ".join(values)                    # column names joined: "key, kind, name, ..."
    marks = ", ".join(":" + k for k in values)   # placeholders ":key, :kind, ..." - SQLite fills them in safely
    # on a repeat: update everything except the key, the first date and the status
    # (builds "kind = excluded.kind, name = excluded.name, ..."; excluded.x = the new value we tried to insert)
    updates = ", ".join(f"{k} = excluded.{k}" for k in values if k not in ("key", "created"))
    with connect() as db:                        # open the database; "with" saves (commits) the changes at the end
        # "Upsert" = INSERT a new row, but if a row with the same key already exists (ON CONFLICT),
        # UPDATE that row instead. status is not in `values`, so it is never reset.
        db.execute(f"INSERT INTO scans ({names}) VALUES ({marks}) ON CONFLICT(key) DO UPDATE SET {updates}", values)
        # Look up the id of the row with this key (new or old) and give it back. "?" = placeholder for key.
        return db.execute("SELECT id FROM scans WHERE key = ?", (key,)).fetchone()["id"]


# update_scan(): input = an inspection id and a dictionary of changes (e.g. {"status": "Repaired"}).
# Changes only the allowed fields of that row. Output: nothing (raises an error for an unknown status).
def update_scan(scan_id, changes):
    """Change the status or the details of one inspection (only these fields are allowed)."""
    # Keep only the safe fields; anything else in `changes` is silently ignored (protects other columns).
    allowed = {k: v for k, v in changes.items() if k in ("status", "road_name", "ward", "inspector", "notes")}
    if allowed.get("status") not in (None, *STATUSES):  # status given but not Open/Scheduled/Repaired?
        raise ValueError("Unknown status")              # stop with an error (the API turns it into a message)
    if allowed:                                         # only touch the database if there is something to change
        with connect() as db:                           # open the database; changes are saved at the end of "with"
            # Builds "UPDATE scans SET status = :status, notes = :notes WHERE id = :id" and fills in the values.
            db.execute(f"UPDATE scans SET {', '.join(f'{k} = :{k}' for k in allowed)} WHERE id = :id",
                       {**allowed, "id": scan_id})      # the values: the allowed changes plus the row id


# history(): input = the most rows to return (default 500).
# Output = a dictionary with the newest inspections, the totals for the Overview cards, the currency and statuses.
def history(limit=500):
    """Newest inspections first + totals for the Overview cards."""
    with connect() as db:                               # open the database
        # Get every column (*) of the newest rows first (ORDER BY id DESC), at most `limit` rows; turn each into a dict.
        rows = [dict(r) for r in db.execute("SELECT * FROM scans ORDER BY id DESC LIMIT ?", (limit,))]
        # One SQL query that adds up the whole table into a single row of totals:
        #   COUNT(*) = number of inspections, SUM = add up, AVG = average, ROUND = round to a whole number,
        #   COALESCE(x, 0) = use 0 when x is empty (e.g. the table has no rows yet),
        #   SUM(CASE WHEN status = 'Open' THEN 1 END) = count only rows with that status,
        #   open_cost / open_critical = cost and critical potholes of inspections NOT yet repaired.
        # fetchone() takes that single row and dict() turns it into a dictionary.
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
    # Send everything the website needs back in one dictionary.
    return {"scans": rows, "totals": totals, "currency": config.CURRENCY, "statuses": STATUSES}


# delete_scan(): input = an inspection id. Removes that one row from the table. Output: nothing.
def delete_scan(scan_id):
    with connect() as db:                               # open the database; the delete is saved at the end
        db.execute("DELETE FROM scans WHERE id = ?", (scan_id,))  # remove the row whose id matches ("?" = scan_id)


# delete_all(): no input. Removes EVERY row from the table (the table itself stays). Output: nothing.
def delete_all():
    with connect() as db:                               # open the database; the delete is saved at the end
        db.execute("DELETE FROM scans")                 # no WHERE part = delete all rows
