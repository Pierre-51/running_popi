import datetime
import json
import os
import sys

import arrow
import stravalib
from gpxtrackposter import track_loader
from sqlalchemy import func

from polyline_processor import filter_out

from .db import Activity, init_db, update_or_create_activity

from synced_data_file_logger import save_synced_data_file_list

IGNORE_BEFORE_SAVING = os.getenv("IGNORE_BEFORE_SAVING", False)

# Stream types to fetch per activity (altitude + HR + pace + distance)
STREAM_TYPES = ["distance", "altitude", "heartrate", "velocity_smooth", "time"]


class Generator:
    def __init__(self, db_path):
        self.client = stravalib.Client()
        self.session = init_db(db_path)

        self.client_id = ""
        self.client_secret = ""
        self.refresh_token = ""
        self.only_run = False

    def set_strava_config(self, client_id, client_secret, refresh_token):
        self.client_id = client_id
        self.client_secret = client_secret
        self.refresh_token = refresh_token

    def check_access(self):
        response = self.client.refresh_access_token(
            client_id=self.client_id,
            client_secret=self.client_secret,
            refresh_token=self.refresh_token,
        )
        self.access_token = response["access_token"]
        self.refresh_token = response["refresh_token"]
        self.client.access_token = response["access_token"]
        print("Access ok")

    def _fetch_laps(self, activity_id):
        """Fetch real lap data from Strava and return as a JSON-serialisable list."""
        try:
            laps = []
            for lap in self.client.get_activity_laps(activity_id):
                laps.append(
                    {
                        "lap_index": lap.lap_index,
                        "name": lap.name,
                        "distance": float(lap.distance) if lap.distance else 0,
                        "moving_time": (
                            lap.moving_time.total_seconds()
                            if isinstance(lap.moving_time, datetime.timedelta)
                            else float(lap.moving_time or 0)
                        ),
                        "elapsed_time": (
                            lap.elapsed_time.total_seconds()
                            if isinstance(lap.elapsed_time, datetime.timedelta)
                            else float(lap.elapsed_time or 0)
                        ),
                        "average_speed": (
                            float(lap.average_speed) if lap.average_speed else None
                        ),
                        "max_speed": float(lap.max_speed) if lap.max_speed else None,
                        "average_heartrate": (
                            float(lap.average_heartrate)
                            if lap.average_heartrate
                            else None
                        ),
                        "max_heartrate": (
                            float(lap.max_heartrate) if lap.max_heartrate else None
                        ),
                        "total_elevation_gain": (
                            float(lap.total_elevation_gain)
                            if lap.total_elevation_gain
                            else None
                        ),
                        "average_cadence": (
                            float(lap.average_cadence) if lap.average_cadence else None
                        ),
                    }
                )
            return laps
        except Exception as e:
            print(f"  Warning: could not fetch laps for {activity_id}: {e}")
            return None

    def _fetch_streams(self, activity_id):
        """Fetch altitude/HR/pace streams and return as a JSON-serialisable dict."""
        try:
            streams = self.client.get_activity_streams(activity_id, types=STREAM_TYPES)
            out = {}
            for key, stream in streams.items():
                out[str(key)] = stream.data
            return out
        except Exception as e:
            print(f"  Warning: could not fetch streams for {activity_id}: {e}")
            return None

    def sync(self, force):
        self.check_access()
        print("Start syncing")

        if force:
            filters = {"before": datetime.datetime.now(datetime.timezone.utc)}
        else:
            last_activity = self.session.query(func.max(Activity.start_date)).scalar()
            if last_activity:
                last_activity_date = arrow.get(last_activity)
                last_activity_date = last_activity_date.shift(days=-7)
                filters = {"after": last_activity_date.datetime}
            else:
                filters = {"before": datetime.datetime.now(datetime.timezone.utc)}

        for activity in self.client.get_activities(**filters):
            if self.only_run and activity.type != "Run":
                continue
            if IGNORE_BEFORE_SAVING:
                if activity.map and activity.map.summary_polyline:
                    activity.map.summary_polyline = filter_out(
                        activity.map.summary_polyline
                    )
            activity.elevation_gain = activity.total_elevation_gain
            activity.subtype = activity.type
            created = update_or_create_activity(self.session, activity)

            # Fetch and store laps + streams for new OR not-yet-enriched activities
            db_activity = (
                self.session.query(Activity).filter_by(run_id=int(activity.id)).first()
            )
            if db_activity and (
                db_activity.laps is None or db_activity.streams is None
            ):
                if db_activity.laps is None:
                    laps = self._fetch_laps(int(activity.id))
                    if laps is not None:
                        db_activity.laps = json.dumps(laps)
                if db_activity.streams is None:
                    streams = self._fetch_streams(int(activity.id))
                    if streams is not None:
                        db_activity.streams = json.dumps(streams)

            if created:
                sys.stdout.write("+")
            else:
                sys.stdout.write(".")
            sys.stdout.flush()

        self.session.commit()

    def sync_from_data_dir(self, data_dir, file_suffix="gpx", activity_title_dict={}):
        loader = track_loader.TrackLoader()
        tracks = loader.load_tracks(
            data_dir, file_suffix=file_suffix, activity_title_dict=activity_title_dict
        )
        print(f"load {len(tracks)} tracks")
        if not tracks:
            print("No tracks found.")
            return

        synced_files = []

        for t in tracks:
            created = update_or_create_activity(
                self.session, t.to_namedtuple(run_from=file_suffix)
            )
            if created:
                sys.stdout.write("+")
            else:
                sys.stdout.write(".")
            synced_files.extend(t.file_names)
            sys.stdout.flush()

        save_synced_data_file_list(synced_files)
        self.session.commit()

    def sync_from_app(self, app_tracks):
        if not app_tracks:
            print("No tracks found.")
            return
        print("Syncing tracks '+' means new track '.' means update tracks")
        synced_files = []
        for t in app_tracks:
            created = update_or_create_activity(self.session, t)
            if created:
                sys.stdout.write("+")
            else:
                sys.stdout.write(".")
            if hasattr(t, "file_names"):
                synced_files.extend(t.file_names)
            sys.stdout.flush()

        save_synced_data_file_list(synced_files)
        self.session.commit()

    def load(self):
        activities = self.session.query(Activity).all()
        return [a.to_dict() for a in activities]
