#!/usr/bin/env python3
"""Fetch YouTube captions with yt-dlp and create a knowledge-note scaffold."""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path
from typing import Any


def run_yt_dlp_json(url: str) -> dict[str, Any]:
    if not shutil.which("yt-dlp"):
        raise RuntimeError("yt-dlp is not installed or is not on PATH")

    result = subprocess.run(
        ["yt-dlp", "--dump-single-json", "--skip-download", url],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "yt-dlp failed")
    return json.loads(result.stdout)


def choose_caption(info: dict[str, Any], lang_prefix: str) -> tuple[str, dict[str, Any], str]:
    subtitles = info.get("subtitles") or {}
    automatic = info.get("automatic_captions") or {}

    for source_name, group in (("official captions", subtitles), ("auto captions", automatic)):
        for lang, entries in group.items():
            if not lang.lower().startswith(lang_prefix.lower()):
                continue
            preferred = sorted(
                entries,
                key=lambda item: 0 if item.get("ext") in {"vtt", "json3", "srv3", "srt"} else 1,
            )
            if preferred:
                return lang, preferred[0], source_name

    available = sorted(set(subtitles.keys()) | set(automatic.keys()))
    raise RuntimeError(
        f"No captions found for language prefix {lang_prefix!r}. "
        f"Available languages: {', '.join(available) if available else 'none'}"
    )


def fetch_caption_text(caption: dict[str, Any]) -> str:
    url = caption.get("url")
    if not url:
        raise RuntimeError("Selected caption has no URL")
    with urllib.request.urlopen(url, timeout=30) as response:
        raw = response.read()
    return raw.decode("utf-8", errors="replace")


def parse_caption(raw: str, ext: str) -> list[tuple[str | None, str]]:
    ext = (ext or "").lower()
    if ext == "json3":
        return parse_json3(raw)
    return parse_timed_text(raw)


def parse_json3(raw: str) -> list[tuple[str | None, str]]:
    data = json.loads(raw)
    rows: list[tuple[str | None, str]] = []
    for event in data.get("events", []):
        parts = event.get("segs") or []
        text = "".join(part.get("utf8", "") for part in parts)
        text = normalize_text(text)
        if not text:
            continue
        timestamp = ms_to_timestamp(event.get("tStartMs"))
        rows.append((timestamp, text))
    return merge_repeated(rows)


def parse_timed_text(raw: str) -> list[tuple[str | None, str]]:
    rows: list[tuple[str | None, str]] = []
    current_time: str | None = None
    current_lines: list[str] = []

    def flush() -> None:
        nonlocal current_lines, current_time
        text = normalize_text(" ".join(current_lines))
        if text:
            rows.append((current_time, text))
        current_lines = []

    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or stripped == "WEBVTT" or stripped.startswith(("Kind:", "Language:", "NOTE")):
            flush()
            continue
        if "-->" in stripped:
            flush()
            current_time = stripped.split("-->", 1)[0].strip().replace(",", ".")
            continue
        if re.match(r"^\d+$", stripped):
            continue
        current_lines.append(stripped)
    flush()
    return merge_repeated(rows)


def normalize_text(text: str) -> str:
    text = html.unescape(text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def merge_repeated(rows: list[tuple[str | None, str]]) -> list[tuple[str | None, str]]:
    merged: list[tuple[str | None, str]] = []
    previous = ""
    for timestamp, text in rows:
        if text == previous:
            continue
        merged.append((timestamp, text))
        previous = text
    return merged


def ms_to_timestamp(value: Any) -> str | None:
    if value is None:
        return None
    total = int(value) // 1000
    hours, remainder = divmod(total, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.lower()).strip("-")
    return slug[:80] or "youtube-video"


def write_transcript(path: Path, rows: list[tuple[str | None, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for timestamp, text in rows:
            if timestamp:
                handle.write(f"[{timestamp}] {text}\n")
            else:
                handle.write(f"{text}\n")


def write_note(
    path: Path,
    transcript_path: Path,
    info: dict[str, Any],
    transcript_source: str,
    language: str,
    task: str,
) -> None:
    title = info.get("title") or "YouTube Video"
    source = info.get("webpage_url") or info.get("original_url") or ""
    channel = info.get("uploader") or info.get("channel") or "Unknown"
    captured = dt.date.today().isoformat()

    content = f"""# {title}

Source: {source}
Channel/author: {channel}
Captured: {captured}
Transcript source: {transcript_source} ({language})
Transcript file: {transcript_path.as_posix()}
Task context: {task or "reference only"}

## Executive Summary
- TODO: Read the transcript and replace this scaffold with 5-10 durable takeaways.

## Core Concepts
- TODO: Extract definitions, assumptions, models, and important claims.

## Procedures And Workflows
- TODO: Capture step-by-step methods with timestamps.

## Decisions, Tradeoffs, And Warnings
- TODO: Capture constraints, caveats, failure modes, and rejected approaches.

## Task-Relevant Notes
- TODO: If there is a downstream task, explain exactly how this video changes the work.

## Timestamp Index
- TODO: Add timestamped topic map after reading the transcript.

## Reusable Prompt Context
Use the knowledge note at `{path.as_posix()}` as source context for tasks related to this video. Key points are pending synthesis.

## Open Questions
- TODO: Add unclear or unverifiable points.
"""
    path.write_text(content, encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="YouTube URL")
    parser.add_argument("--out", default="knowledge/youtube", help="Output directory")
    parser.add_argument("--lang", default="vi", help="Caption language prefix, default: vi")
    parser.add_argument("--task", default="", help="Downstream task context to include in the note")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    info = run_yt_dlp_json(args.url)
    language, caption, transcript_source = choose_caption(info, args.lang)
    raw = fetch_caption_text(caption)
    rows = parse_caption(raw, caption.get("ext", ""))
    if not rows:
        raise RuntimeError("Caption download succeeded, but no transcript text was parsed")

    base = slugify(info.get("title") or info.get("id") or "youtube-video")
    transcript_path = out_dir / f"{base}.transcript.txt"
    note_path = out_dir / f"{base}.md"

    write_transcript(transcript_path, rows)
    write_note(note_path, transcript_path, info, transcript_source, language, args.task)

    print(json.dumps({
        "note": str(note_path),
        "transcript": str(transcript_path),
        "title": info.get("title"),
        "source": transcript_source,
        "language": language,
        "segments": len(rows),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)

