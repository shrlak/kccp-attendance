#!/usr/bin/env python3
"""Keep one overwrite-in-place backup and remove legacy dated backup objects.

The upload step writes the same four `backups/current.*` keys on every successful run,
so R2 replaces the previous encrypted data, schema archive, and checksums in place. This
post-upload guard verifies that all four new objects exist before deleting dated objects
left by the former multi-generation retention policy.

Unknown objects are never deleted. AWS credentials and R2_ENDPOINT/R2_BUCKET come from
`.github/workflows/backup.yml`.

Runs once per 부(department) stream, selected by PARTITION (see run-backup.sh):
  youth -> backups/         (the whole-database snapshot)
  adult -> backups/adult/   (장년부 people + attendance only)
Each stream only ever looks at — and only ever deletes within — its own prefix. Note that
the 장년부 objects live *under* backups/, so the youth listing has to skip anything with a
further "/" in it, or verifying one stream would see the other's files.
"""
import json
import os
import re
import subprocess

BUCKET = os.environ["R2_BUCKET"]
ENDPOINT = os.environ["R2_ENDPOINT"]
PARTITION = os.environ.get("PARTITION", "youth")
if PARTITION not in ("youth", "adult"):
    raise SystemExit(f"::error::Unknown PARTITION {PARTITION!r} (expected youth or adult)")
PREFIX = "backups/adult/" if PARTITION == "adult" else "backups/"
CURRENT_KEYS = {
    PREFIX + name
    for name in (
        "current.sql.age",
        "current.sql.age.sha256",
        "current.schema.tar.gz.age",
        "current.schema.tar.gz.age.sha256",
    )
}
LEGACY_KEY_RE = re.compile(
    re.escape(PREFIX) + r"backup-\d{4}-\d{2}-\d{2}\."
    r"(?:sql\.age|schema\.tar\.gz\.age)(?:\.sha256)?$"
)
WARN_THRESHOLD_GB = 8.0


def aws_json(*args):
    out = subprocess.run(
        ["aws", "--endpoint-url", ENDPOINT, *args, "--output", "json"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return json.loads(out) if out.strip() else {}


def list_objects():
    response = aws_json("s3api", "list-objects-v2", "--bucket", BUCKET, "--prefix", PREFIX)
    # Objects directly under this stream's prefix — never the other stream's, which sits in
    # a sub-"directory" of it (backups/adult/... is also matched by the prefix backups/).
    return {
        obj["Key"]: obj
        for obj in response.get("Contents", [])
        if "/" not in obj["Key"][len(PREFIX):]
    }


def main():
    objects = list_objects()
    missing = sorted(CURRENT_KEYS - objects.keys())
    if missing:
        print("::error::Current backup is incomplete; legacy backups were not deleted. "
              + "Missing: " + ", ".join(missing))
        raise SystemExit(1)

    legacy_keys = sorted(key for key in objects if LEGACY_KEY_RE.fullmatch(key))
    for key in legacy_keys:
        subprocess.run(
            ["aws", "--endpoint-url", ENDPOINT, "s3", "rm", f"s3://{BUCKET}/{key}"],
            check=True,
        )

    current_size = sum(int(objects[key].get("Size", 0)) for key in CURRENT_KEYS)
    print(f"Current {PARTITION} backup verified: {current_size:,} B "
          f"across {len(CURRENT_KEYS)} objects under {PREFIX}.")
    print(f"Removed {len(legacy_keys)} legacy dated backup object(s).")

    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        with open(step_summary, "a", encoding="utf-8") as summary:
            summary.write(f"## Current backup — {PARTITION} ({PREFIX})\n\n")
            summary.write(f"**Size: {current_size / 1e6:.2f} MB**  \n")
            summary.write("Storage mode: overwrite previous backup  \n")
            summary.write(f"Legacy objects removed: {len(legacy_keys)}\n")

    if current_size / 1e9 > WARN_THRESHOLD_GB:
        print(f"::warning::Current {PARTITION} R2 backup is {current_size / 1e9:.2f} GB, over the "
              f"{WARN_THRESHOLD_GB} GB watch threshold.")


if __name__ == "__main__":
    main()
