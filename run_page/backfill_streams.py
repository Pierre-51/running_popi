"""
One-time backfill script: fetches laps + streams for all activities
that don't have them yet and updates data.db + activities.json.

Usage:
    python run_page/backfill_streams.py CLIENT_ID CLIENT_SECRET REFRESH_TOKEN

Run this once from your repo root after deploying the new db.py / generator.
The updated data.db and activities.json will then be committed by the next sync,
or you can commit them manually.
"""

import argparse
import json
import sys
import time

sys.path.insert(0, "run_page")

from config import JSON_FILE, SQL_FILE
from generator import Generator
from generator.db import Activity, init_db


def backfill(client_id: str, client_secret: str, refresh_token: str):
    # Init DB (adds missing columns automatically)
    session = init_db(SQL_FILE)

    gen = Generator(SQL_FILE)
    gen.set_strava_config(client_id, client_secret, refresh_token)
    gen.check_access()

    # Find all activities with null laps or streams
    activities = (
        session.query(Activity)
        .filter((Activity.laps == None) | (Activity.streams == None))  # noqa: E711
        .order_by(Activity.run_id.desc())
        .all()
    )

    print(f"Found {len(activities)} activities needing backfill")
    if not activities:
        print("Nothing to do.")
        return

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

            # Respect Strava rate limit: 100 req / 15 min = ~1 req/9s
            # laps + streams = 2 requests per activity → sleep 10s every activity
            # For the daily limit (1000/day), 258 activities = 516 requests — fine.
            if i < len(activities) - 1:
                time.sleep(10)

        except Exception as e:
            print(f"✗ {e}")
            failed += 1
            session.rollback()
            time.sleep(15)  # back off on error

    print(f"\nDone. {success} updated, {failed} failed.")

    # Regenerate activities.json
    print("Regenerating activities.json ...")
    all_acts = session.query(Activity).all()
    data = [a.to_dict() for a in all_acts]
    with open(JSON_FILE, "w") as f:
        json.dump(data, f)
    print(f"Wrote {len(data)} activities to {JSON_FILE}")
    print("\nCommit data.db and src/static/activities.json to apply changes.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill Strava laps and streams")
    parser.add_argument("client_id")
    parser.add_argument("client_secret")
    parser.add_argument("refresh_token")
    opts = parser.parse_args()
    backfill(opts.client_id, opts.client_secret, opts.refresh_token)
