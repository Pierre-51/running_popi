"""
One-time backfill script: fetches laps + streams for all activities
that don't have them yet, updates data.db, writes per-activity detail
files to src/static/activities/, and regenerates activities.json
(which no longer contains laps/streams).

Usage:
    python run_page/backfill_streams.py CLIENT_ID CLIENT_SECRET REFRESH_TOKEN
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, "run_page")

from config import JSON_FILE, SQL_FILE
from generator import Generator
from generator.db import Activity, init_db

DETAILS_DIR = os.path.join(os.path.dirname(JSON_FILE), "activities")


def backfill(client_id: str, client_secret: str, refresh_token: str):
    session = init_db(SQL_FILE)

    gen = Generator(SQL_FILE)
    gen.set_strava_config(client_id, client_secret, refresh_token)
    gen.check_access()

    activities = (
        session.query(Activity)
        .filter((Activity.laps == None) | (Activity.streams == None))  # noqa: E711
        .order_by(Activity.run_id.desc())
        .all()
    )

    print(f"Found {len(activities)} activities needing backfill")
    if not activities:
        print("Nothing to do — writing detail files and regenerating JSON.")
    else:
        success = 0
        failed = 0

        for i, act in enumerate(activities):
            print(f"[{i+1}/{len(activities)}] {act.run_id} — {act.name} ... ", end="")
            try:
                if act.laps is None:
                    laps = gen._fetch_laps(act.run_id)
                    if laps is not None:
                        act.laps = json.dumps(laps)

                if act.streams is None:
                    streams = gen._fetch_streams(act.run_id)
                    if streams is not None:
                        act.streams = json.dumps(streams)

                session.commit()
                print("✓")
                success += 1

                if i < len(activities) - 1:
                    time.sleep(10)

            except Exception as e:
                print(f"✗ {e}")
                failed += 1
                session.rollback()
                time.sleep(15)

        print(f"\nDone. {success} updated, {failed} failed.")

    # Write per-activity detail files
    print("Writing per-activity detail files...")
    os.makedirs(DETAILS_DIR, exist_ok=True)
    all_acts = session.query(Activity).all()
    written = 0
    for act in all_acts:
        detail = act.to_detail_dict()
        if detail["laps"] is not None or detail["streams"] is not None:
            path = os.path.join(DETAILS_DIR, f"{act.run_id}.json")
            with open(path, "w") as f:
                json.dump(detail, f)
            written += 1
    print(f"Wrote {written} detail files to {DETAILS_DIR}/")

    # Regenerate slim activities.json (no laps/streams)
    print("Regenerating activities.json (slim, no laps/streams)...")
    data = [a.to_dict() for a in all_acts]
    with open(JSON_FILE, "w") as f:
        json.dump(data, f)
    import os as _os

    size_kb = _os.path.getsize(JSON_FILE) / 1024
    print(f"Wrote {len(data)} activities to {JSON_FILE} ({size_kb:.0f} KB)")
    print(
        "\nCommit data.db, src/static/activities.json, and src/static/activities/ to apply."
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill Strava laps and streams")
    parser.add_argument("client_id")
    parser.add_argument("client_secret")
    parser.add_argument("refresh_token")
    opts = parser.parse_args()
    backfill(opts.client_id, opts.client_secret, opts.refresh_token)
