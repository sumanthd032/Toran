"""
Recordings for the AV Archive. SIP to AIP to DIP, as ingest.py does for text.

Run:  python3 pipeline/media.py [--refetch]

Reads pipeline/media.json. A recording is fetched only if its licence is on the
list of licences that permit a transcript, because a transcript is a derivative
work and a No Derivatives licence does not allow one. That check is the reason
this manifest is two items long rather than a hundred: D-126 refused audio that
claims to be Dr. Ambedkar's voice because the uploads record nothing about where
they came from, and the same bar applies to film.

Two files come out of each recording. A transcode the kiosk plays, at 640 px
wide, because the AV Archive puts the transcript first and the picture second
and a kiosk panel is 1280 px. And a mono 16 kHz Opus track for transcription,
which is what a speech model wants and is a twentieth of the size.

Requires ffmpeg and ffprobe.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from oais.packages import Premis, dublin_core, now, sha256_file, write_json

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SIP, AIP, DIP = DATA / "sip", DATA / "aip", DATA / "dip"
MANIFEST = ROOT / "pipeline" / "media.json"
UA = "toran-pipeline/0.1 (SIH26096 research project)"

# The width the kiosk plays. The transcript is the primary surface and the
# picture is secondary: it occupies about a third of a 1280 px panel, so 480 px
# is already more than the panel can show. A 46 minute episode does not need to
# ship at 720p to a device that draws it at 400.
PLAY_WIDTH = 480

# Measured against the source rather than guessed. The Internet Archive copies
# run at around 500 kbit/s in total for 46 minutes, so an earlier 700 kbit/s
# video target was producing a file larger than the one it was transcoding. At
# 480 px this is a clear picture of a 1988 videotape transfer and about 108 MB
# an episode, which is what each kiosk holds on its own card.
VIDEO_BITRATE = "250k"
PLAY_AUDIO_BITRATE = "64k"

# What a speech model wants: mono, 16 kHz. Opus at 24 kbps keeps speech clear
# and turns a 170 MB film into something that fits in one upload.
AUDIO_RATE = 16000
AUDIO_BITRATE = "24k"


def run(*args: str) -> None:
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f"{args[0]} failed:\n{result.stderr[-2000:]}")


def h264_encoder() -> tuple[str, list[str]]:
    """
    Whichever H.264 encoder this machine has, and how to ask it for a quality.

    H.264 rather than VP9 or AV1 because the kiosk build also serves the public
    web, and H.264 in an MP4 is the one combination every browser plays without
    a caveat. Which encoder provides it is not the same everywhere: Fedora's
    ffmpeg ships libopenh264 and not libx264, and they take different flags for
    quality, so this asks rather than assumes.
    """
    listed = subprocess.run(
        ["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True
    ).stdout
    if "libx264" in listed:
        # Constant quality. 30 is visibly fine at 480 px for a 1988 broadcast
        # and lands near the same size as the bitrate below.
        return "libx264", ["-crf", "30", "-preset", "medium"]
    if "libopenh264" in listed:
        # No constant-quality mode, so a bitrate.
        return "libopenh264", ["-b:v", VIDEO_BITRATE]
    raise SystemExit(
        "No H.264 encoder in this ffmpeg. Install one:\n"
        "  Fedora   sudo dnf install ffmpeg-free openh264\n"
        "  Debian   sudo apt install ffmpeg\n"
        "The kiosk plays H.264 in MP4 because it is the one combination every\n"
        "browser plays, and the public web build uses the same files."
    )


def duration_of(path: Path) -> float:
    """Seconds, read from the file rather than assumed."""
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(result.stdout.strip())


# How far a derived file may fall short of its source before it is a different
# recording. A transcode drops a fraction of a second at the tail; anything more
# is truncation.
DURATION_TOLERANCE_SECONDS = 2.0


def same_length(derived: Path, source_seconds: float, what: str, rid: str) -> None:
    """
    Refuses a derived file that is shorter than what it came from.

    This exists because it happened. A speech track for episode 4 was extracted
    while the source was still downloading, and came out 21.9 minutes long
    against a 45.9 minute film. Nothing complained: the transcript simply
    stopped at 21:44, and the archive would have gone on claiming to hold a
    46 minute film that could not be searched past its halfway point. A
    truncated derivative is the quietest kind of data loss there is, so it is
    checked rather than trusted.
    """
    got = duration_of(derived)
    if abs(got - source_seconds) > DURATION_TOLERANCE_SECONDS:
        derived.unlink(missing_ok=True)
        raise SystemExit(
            f"{rid}: the {what} is {got / 60:.1f} min but the source is "
            f"{source_seconds / 60:.1f} min. The short file has been deleted.\n"
            "This usually means the source was still downloading when it was "
            "read. Run the command again."
        )


def probe(path: Path) -> dict:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,size",
            "-show_entries",
            "stream=codec_type,width,height",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def fetch(url: str, into: Path) -> None:
    """Stream to disk. These are hundreds of megabytes; nothing is held in memory."""
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=600) as response:
        total = int(response.headers.get("content-length") or 0)
        done = 0
        with into.open("wb") as fh:
            while True:
                chunk = response.read(1 << 20)
                if not chunk:
                    break
                fh.write(chunk)
                done += len(chunk)
                if total:
                    print(
                        f"\r  {into.name}  {done / 1e6:6.1f} / {total / 1e6:.1f} MB",
                        end="",
                        flush=True,
                    )
        print()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refetch", action="store_true", help="download again")
    args = parser.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    permitted = set(manifest["licences_that_permit_a_transcript"])
    premis = Premis(AIP / "media" / "premis.jsonl")

    out_sip = SIP / "media"
    out_aip = AIP / "media"
    out_dip = DIP / "media"
    for directory in (out_sip, out_aip, out_dip):
        directory.mkdir(parents=True, exist_ok=True)

    records = []
    for recording in manifest["recordings"]:
        rid = recording["id"]
        licence = recording["licence"]

        # The refusal that keeps this list short. A licence that forbids
        # derivatives forbids the transcript this whole application is built
        # on, so the recording is not ingested at all rather than ingested and
        # shown without one.
        if licence not in permitted:
            print(f"  REFUSED  {rid}: {licence} does not permit a transcript")
            premis.event(
                "ingestion",
                "refused",
                f"licence {licence} does not permit a derivative transcript",
                objects=[rid],
            )
            continue

        source = out_sip / f"{rid}.mp4"
        if args.refetch or not source.exists():
            print(f"  fetching {rid}")
            fetch(recording["url"], source)
            premis.event(
                "ingestion",
                "success",
                f"fetched from {recording['url']}",
                objects=[rid],
            )

        checksum = sha256_file(source)
        info = probe(source)
        duration = float(info["format"]["duration"])
        video = next(s for s in info["streams"] if s["codec_type"] == "video")

        play = out_dip / f"{rid}.mp4"
        if args.refetch or not play.exists():
            encoder, quality = h264_encoder()
            print(f"  transcoding {rid} to {PLAY_WIDTH}px with {encoder}")
            run(
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-i",
                str(source),
                "-vf",
                f"scale={PLAY_WIDTH}:-2",
                "-c:v",
                encoder,
                *quality,
                "-c:a",
                "aac",
                "-b:a",
                PLAY_AUDIO_BITRATE,
                # The kiosk seeks to a second in a transcript, so the index has
                # to be at the front of the file rather than at the end of it.
                "-movflags",
                "+faststart",
                str(play),
            )
        same_length(play, duration, "play copy", rid)

        audio = out_aip / f"{rid}.opus"
        if args.refetch or not audio.exists():
            print(f"  extracting speech from {rid}")
            run(
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-i",
                str(source),
                "-vn",
                "-ac",
                "1",
                "-ar",
                str(AUDIO_RATE),
                "-c:a",
                "libopus",
                "-b:a",
                AUDIO_BITRATE,
                str(audio),
            )
        same_length(audio, duration, "speech track", rid)

        record = {
            "id": rid,
            "title": recording["title"],
            "series": recording["series"],
            "episode": recording["episode"],
            "language": recording["language"],
            "kind": recording["kind"],
            "durationSeconds": round(duration, 2),
            "width": video["width"],
            "height": video["height"],
            "playWidth": PLAY_WIDTH,
            "file": f"{rid}.mp4",
            "audio": f"{rid}.opus",
            "sha256": checksum,
            # Everything a screen needs to say where this came from. The AV
            # Archive prints the attribution under the player, because CC BY
            # requires it and because a visitor should know who made what they
            # are watching.
            "creator": recording["creator"],
            "publisher": recording["publisher"],
            "year": recording["year"],
            "licence": licence,
            "licenceName": recording["licence_name"],
            "attribution": recording["attribution"],
            "source": recording["source"],
            "original": recording["original"],
            "mirroredBy": recording["mirrored_by"],
            "whyHere": recording["why_here"],
            "dublinCore": dublin_core(
                title=recording["title"],
                creator=recording["creator"],
                publisher=recording["publisher"],
                date=str(recording["year"]),
                type="MovingImage",
                format="video/mp4",
                identifier=rid,
                source=recording["source"],
                language=recording["language"],
                relation=recording["based_on"],
                rights=f"{recording['licence_name']}, {licence}",
            ),
        }
        records.append(record)
        print(
            f"  {rid}  {duration / 60:.1f} min  "
            f"{source.stat().st_size / 1e6:.0f} MB source  "
            f"{play.stat().st_size / 1e6:.0f} MB play  "
            f"{audio.stat().st_size / 1e6:.1f} MB speech"
        )

    write_json(out_dip / "recordings.json", records)
    premis.event(
        "metadata modification",
        "success",
        f"wrote {len(records)} recording records",
        objects=[r["id"] for r in records],
    )
    print(f"\n{len(records)} recording(s) at {now()}")
    print(f"  {out_dip / 'recordings.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
