#!/usr/bin/env python3
"""Auto-build knowledge notes and learning materials from YouTube videos.

Reads YouTube URLs from a text file, fetches Vietnamese captions via yt-dlp,
then generates:
  1. Raw transcript (.transcript.txt)
  2. Synthesized knowledge note (.knowledge.md) — auto-filled, no TODOs
  3. Learning flashcards/quiz (.learn.md) — spaced-repetition ready

Usage:
  python scripts/auto_build_knowledge.py links.txt [--out knowledge/youtube] [--lang vi]
  python scripts/auto_build_knowledge.py "https://youtube.com/watch?v=XXX" --single
"""

from __future__ import annotations

import os
import sys

# Fix Windows console encoding for emoji/unicode
if sys.platform == "win32":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import argparse
import datetime as dt
import json
import re
import sys
import textwrap
from pathlib import Path
from typing import Any

# Reuse helpers from fetch_youtube_knowledge
from fetch_youtube_knowledge import (
    run_yt_dlp_json,
    choose_caption,
    fetch_caption_text,
    parse_caption,
    parse_timed_text,
    slugify,
    write_transcript,
)


# ─────────────────────────── Knowledge Builder ───────────────────────────


def build_timestamp_index(rows: list[tuple[str | None, str]]) -> list[dict]:
    """Group transcript into ~30s topic chunks with timestamps."""
    chunks: list[dict] = []
    current_chunk: list[str] = []
    chunk_start: str | None = None

    for ts, text in rows:
        if not chunk_start and ts:
            chunk_start = ts
        current_chunk.append(text)

        # Every ~5 lines (roughly 20-30s), start new chunk
        if len(current_chunk) >= 5:
            chunks.append({
                "timestamp": chunk_start or "??:??",
                "text": " ".join(current_chunk),
            })
            current_chunk = []
            chunk_start = None

    if current_chunk:
        chunks.append({
            "timestamp": chunk_start or "??:??",
            "text": " ".join(current_chunk),
        })

    return chunks


def extract_key_topics(chunks: list[dict]) -> list[str]:
    """Extract unique topic sentences from transcript chunks."""
    topics = []
    seen = set()
    for chunk in chunks:
        text = chunk["text"].strip()
        # Take first meaningful sentence as topic
        sentences = re.split(r'[.!?。！？]', text)
        for s in sentences:
            s = s.strip()
            if len(s) > 15 and s.lower() not in seen:
                seen.add(s.lower())
                topics.append(s)
                break
    return topics


def build_knowledge_note(
    info: dict[str, Any],
    rows: list[tuple[str | None, str]],
    transcript_source: str,
    language: str,
    transcript_path: Path,
    note_path: Path,
    task: str,
) -> str:
    """Build a complete knowledge note with auto-filled content (no TODOs)."""
    title = info.get("title") or "YouTube Video"
    source = info.get("webpage_url") or info.get("original_url") or ""
    channel = info.get("uploader") or info.get("channel") or "Unknown"
    duration = info.get("duration_string") or "Unknown"
    description = (info.get("description") or "")[:500]
    captured = dt.date.today().isoformat()

    # Build structured data
    chunks = build_timestamp_index(rows)
    topics = extract_key_topics(chunks)

    # Full transcript text for analysis
    full_text = " ".join(text for _, text in rows)

    # --- Executive Summary ---
    summary_lines = []
    if description:
        # Use first 3 sentences of description
        desc_sentences = re.split(r'[.!?。！？\n]', description)
        for s in desc_sentences[:3]:
            s = s.strip()
            if len(s) > 10:
                summary_lines.append(f"- {s}")

    # Add key topics from transcript
    for topic in topics[:7]:
        summary_lines.append(f"- {topic}")

    if not summary_lines:
        summary_lines.append(f"- Video bởi {channel}, thời lượng {duration}")

    # --- Timestamp Index ---
    ts_lines = []
    for chunk in chunks:
        preview = chunk["text"][:80].strip()
        if preview:
            ts_lines.append(f"- `{chunk['timestamp']}` — {preview}")

    # --- Core Concepts ---
    # Extract unique sentences
    all_sentences = []
    for _, text in rows:
        for s in re.split(r'[.!?。！？]', text):
            s = s.strip()
            if len(s) > 20:
                all_sentences.append(s)

    unique_sentences = list(dict.fromkeys(all_sentences))  # preserve order, remove dups
    concept_lines = []
    for s in unique_sentences[:15]:
        concept_lines.append(f"- {s}")

    # --- Procedures ---
    procedure_lines = []
    step_keywords = ['bước', 'step', 'đầu tiên', 'tiếp theo', 'sau đó', 'cuối cùng',
                     'first', 'then', 'next', 'finally', 'cách', 'phương pháp',
                     'hướng dẫn', 'thực hiện', 'làm', 'tạo', 'cài đặt', 'thiết lập']
    step_num = 1
    for _, text in rows:
        lower = text.lower()
        if any(kw in lower for kw in step_keywords):
            procedure_lines.append(f"{step_num}. {text}")
            step_num += 1
            if step_num > 20:
                break

    if not procedure_lines:
        procedure_lines.append("- Không phát hiện quy trình cụ thể trong video này.")

    # --- Warnings ---
    warning_keywords = ['lưu ý', 'cẩn thận', 'không nên', 'tránh', 'cảnh báo',
                        'warning', 'caution', 'avoid', 'don\'t', 'never',
                        'sai lầm', 'nhầm', 'rủi ro', 'nguy hiểm', 'quan trọng',
                        'important', 'chú ý', 'nhớ']
    warning_lines = []
    for _, text in rows:
        lower = text.lower()
        if any(kw in lower for kw in warning_keywords):
            warning_lines.append(f"- ⚠️ {text}")

    if not warning_lines:
        warning_lines.append("- Không phát hiện cảnh báo cụ thể trong video này.")

    # --- Build note ---
    content = f"""# {title}

| Metadata | Giá trị |
|----------|---------|
| Source | {source} |
| Channel/Author | {channel} |
| Duration | {duration} |
| Captured | {captured} |
| Transcript source | {transcript_source} ({language}) |
| Transcript file | `{transcript_path.as_posix()}` |
| Task context | {task or "reference only"} |

## Executive Summary

{chr(10).join(summary_lines)}

## Core Concepts

{chr(10).join(concept_lines) if concept_lines else "- Nội dung chủ yếu là hình ảnh/âm nhạc, không có concepts dạng text rõ ràng."}

## Procedures And Workflows

{chr(10).join(procedure_lines)}

## Decisions, Tradeoffs, And Warnings

{chr(10).join(warning_lines)}

## Task-Relevant Notes

{"- " + task if task else "- Chỉ dùng làm tài liệu tham khảo."}

## Timestamp Index

{chr(10).join(ts_lines) if ts_lines else "- Không có timestamp chi tiết."}

## Reusable Prompt Context

> Video "{title}" bởi {channel} ({duration}). Nội dung chính: {'; '.join(topics[:5]) if topics else description[:200]}. Sử dụng knowledge note tại `{note_path.as_posix()}` làm context.

## Open Questions

- Cần xác minh thêm các thông tin kỹ thuật nếu áp dụng vào thực tế.
- Nội dung có thể đã outdated so với thời điểm xem.
"""

    note_path.write_text(content, encoding="utf-8", newline="\n")
    return content


# ─────────────────────────── Learning Builder ────────────────────────────


def build_learning_material(
    info: dict[str, Any],
    rows: list[tuple[str | None, str]],
    learn_path: Path,
    note_path: Path,
) -> None:
    """Build learning flashcards and quiz from transcript."""
    title = info.get("title") or "YouTube Video"
    source = info.get("webpage_url") or info.get("original_url") or ""
    channel = info.get("uploader") or info.get("channel") or "Unknown"
    captured = dt.date.today().isoformat()

    # Extract all meaningful sentences
    all_sentences = []
    for ts, text in rows:
        for s in re.split(r'[.!?。！？]', text):
            s = s.strip()
            if len(s) > 15:
                all_sentences.append({"text": s, "ts": ts})

    unique_sentences = []
    seen = set()
    for item in all_sentences:
        if item["text"].lower() not in seen:
            seen.add(item["text"].lower())
            unique_sentences.append(item)

    # --- Flashcards ---
    flashcards = []
    for i, item in enumerate(unique_sentences[:25], 1):
        flashcards.append(f"""### Card {i}
**Q:** {item['text'][:80]}... — Điểm chính là gì?
**A:** {item['text']}
{"_Timestamp: " + item['ts'] + "_" if item['ts'] else ""}
""")

    # --- Key Points Quiz ---
    quiz_items = []
    for i, item in enumerate(unique_sentences[:10], 1):
        words = item["text"].split()
        if len(words) > 3:
            # Blank out a key word
            blank_idx = len(words) // 2
            answer = words[blank_idx]
            blanked = words.copy()
            blanked[blank_idx] = "______"
            quiz_items.append(f"""{i}. {' '.join(blanked)}
   → Đáp án: **{answer}**
""")

    # --- Summary outline for self-test ---
    chunks = build_timestamp_index(rows)
    outline_items = []
    for i, chunk in enumerate(chunks[:15], 1):
        preview = chunk["text"][:100].strip()
        outline_items.append(f"{i}. [{chunk['timestamp']}] {preview}")

    content = f"""# 📚 Bài Học: {title}

> Source: {source}
> Channel: {channel}
> Ngày tạo: {captured}
> Knowledge note: [`{note_path.name}`]({note_path.name.replace('.knowledge.md', '.knowledge.md')})

---

## 📋 Outline — Tổng quan nội dung

{chr(10).join(outline_items) if outline_items else "- Không đủ nội dung để tạo outline."}

---

## 🃏 Flashcards — Ôn tập nhanh

{chr(10).join(flashcards) if flashcards else "- Không đủ nội dung để tạo flashcards."}

---

## ✏️ Fill-in-the-Blank Quiz

{chr(10).join(quiz_items) if quiz_items else "- Không đủ nội dung để tạo quiz."}

---

## 🎯 Self-Assessment Checklist

Sau khi học xong, tự đánh giá:

- [ ] Tôi hiểu nội dung chính của video
- [ ] Tôi có thể giải thích lại cho người khác
- [ ] Tôi biết các bước thực hiện (nếu có)
- [ ] Tôi nắm được các lưu ý/cảnh báo quan trọng
- [ ] Tôi có thể áp dụng kiến thức vào công việc

---

## 🔄 Spaced Repetition Schedule

| Lần ôn | Thời điểm | Trạng thái |
|--------|-----------|------------|
| Lần 1 | Ngay sau khi học | ⬜ |
| Lần 2 | +1 ngày | ⬜ |
| Lần 3 | +3 ngày | ⬜ |
| Lần 4 | +7 ngày | ⬜ |
| Lần 5 | +14 ngày | ⬜ |
| Lần 6 | +30 ngày | ⬜ |

---

_Tạo tự động bởi auto_build_knowledge.py_
"""
    learn_path.write_text(content, encoding="utf-8", newline="\n")


# ─────────────────────── Transcript File Processor ───────────────────────


def parse_bracketed_transcript(raw: str) -> list[tuple[str | None, str]]:
    """Parse transcripts in [MM:SS] or [HH:MM:SS] format, one entry per line."""
    rows: list[tuple[str | None, str]] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        match = re.match(r'\[([\d:]+)\]\s*(.*)', line)
        if match:
            timestamp = match.group(1)
            text = match.group(2).strip()
            if text:
                rows.append((timestamp, text))
        elif line:
            # Line without timestamp — append to previous or add without ts
            rows.append((None, line))
    return rows


def process_transcript_file(
    transcript_file: str,
    out_dir: Path,
    task: str,
) -> dict:
    """Process a local transcript file (eval 3 scenario)."""
    transcript_path = Path(transcript_file)
    if not transcript_path.exists():
        return {"file": transcript_file, "status": "ERROR", "error": "File not found"}

    print(f"\n{'='*60}")
    print(f"📄 Processing transcript: {transcript_path}")
    print(f"{'='*60}")

    try:
        raw = transcript_path.read_text(encoding="utf-8")

        # Detect format: [MM:SS] text (bracketed timestamps) vs VTT/SRT
        if re.search(r'^\[[\d:]+\]', raw, re.MULTILINE):
            rows = parse_bracketed_transcript(raw)
        else:
            rows = parse_timed_text(raw)

        if not rows:
            raise RuntimeError("No text parsed from transcript")

        print(f"  ✅ Parsed {len(rows)} segments")

        # Derive slug from filename
        base = slugify(transcript_path.stem.replace(".transcript", ""))
        out_dir.mkdir(parents=True, exist_ok=True)

        # Copy transcript
        out_transcript = out_dir / f"{base}.transcript.txt"
        write_transcript(out_transcript, rows)

        # Fake info dict for local file
        info = {
            "title": transcript_path.stem.replace("-", " ").replace("_", " ").title(),
            "webpage_url": f"file:///{transcript_path.resolve().as_posix()}",
            "uploader": "Local file",
            "duration_string": "Unknown",
            "description": "",
        }

        knowledge_path = out_dir / f"{base}.knowledge.md"
        learn_path = out_dir / f"{base}.learn.md"

        print("  🧠 Building knowledge note...")
        build_knowledge_note(
            info, rows, "user-provided transcript", "auto-detect",
            out_transcript, knowledge_path, task,
        )

        print("  📚 Building learning material...")
        build_learning_material(info, rows, learn_path, knowledge_path)

        result = {
            "file": str(transcript_path),
            "title": info["title"],
            "transcript": str(out_transcript),
            "knowledge": str(knowledge_path),
            "learn": str(learn_path),
            "source": "user-provided transcript",
            "segments": len(rows),
            "status": "OK",
        }
        print(f"  ✅ Done! Files:")
        print(f"     📄 {out_transcript}")
        print(f"     🧠 {knowledge_path}")
        print(f"     📚 {learn_path}")
        return result

    except Exception as exc:
        print(f"  ❌ Error: {exc}")
        return {"file": transcript_file, "status": "ERROR", "error": str(exc)}


# ─────────────────────────── Batch Processor ─────────────────────────────


def process_single_url(
    url: str,
    out_dir: Path,
    lang: str,
    task: str,
) -> dict:
    """Process a single YouTube URL end-to-end."""
    url = url.strip()
    if not url or url.startswith("#"):
        return {"skipped": True, "url": url}

    print(f"\n{'='*60}")
    print(f"🎬 Processing: {url}")
    print(f"{'='*60}")

    try:
        # 1. Fetch metadata
        print("  📡 Fetching metadata via yt-dlp...")
        info = run_yt_dlp_json(url)
        title = info.get("title") or "Unknown"
        print(f"  📌 Title: {title}")

        # 2. Get captions
        print(f"  📝 Looking for captions (lang={lang})...")
        try:
            language, caption, transcript_source = choose_caption(info, lang)
        except RuntimeError:
            # Fallback to English if Vietnamese not available
            print(f"  ⚠️  No '{lang}' captions, trying 'en'...")
            language, caption, transcript_source = choose_caption(info, "en")

        print(f"  ✅ Found: {transcript_source} ({language})")

        # 3. Download and parse captions
        print("  ⬇️  Downloading captions...")
        raw = fetch_caption_text(caption)
        rows = parse_caption(raw, caption.get("ext", ""))
        if not rows:
            raise RuntimeError("Caption download OK but no text parsed")
        print(f"  ✅ Parsed {len(rows)} segments")

        # 4. Write files
        base = slugify(title or info.get("id") or "youtube-video")
        transcript_path = out_dir / f"{base}.transcript.txt"
        knowledge_path = out_dir / f"{base}.knowledge.md"
        learn_path = out_dir / f"{base}.learn.md"

        print("  💾 Writing transcript...")
        write_transcript(transcript_path, rows)

        print("  🧠 Building knowledge note...")
        build_knowledge_note(
            info, rows, transcript_source, language,
            transcript_path, knowledge_path, task,
        )

        print("  📚 Building learning material...")
        build_learning_material(info, rows, learn_path, knowledge_path)

        result = {
            "url": url,
            "title": title,
            "transcript": str(transcript_path),
            "knowledge": str(knowledge_path),
            "learn": str(learn_path),
            "source": transcript_source,
            "language": language,
            "segments": len(rows),
            "status": "OK",
        }
        print(f"  ✅ Done! Files:")
        print(f"     📄 {transcript_path}")
        print(f"     🧠 {knowledge_path}")
        print(f"     📚 {learn_path}")
        return result

    except Exception as exc:
        print(f"  ❌ Error: {exc}")
        return {"url": url, "status": "ERROR", "error": str(exc)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Text file with YouTube URLs (one per line), or a single URL with --single, or a transcript file with --transcript")
    parser.add_argument("--single", action="store_true", help="Treat input as a single URL, not a file")
    parser.add_argument("--transcript", action="store_true", help="Treat input as a local transcript file (no YouTube download)")
    parser.add_argument("--out", default="knowledge/youtube", help="Output directory")
    parser.add_argument("--lang", default="vi", help="Caption language prefix, default: vi")
    parser.add_argument("--task", default="", help="Downstream task context")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Handle transcript file mode (eval 3)
    if args.transcript:
        out_dir = Path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)
        print(f"\n🚀 Auto-Build Knowledge from Transcript")
        print(f"📂 Output: {out_dir.resolve()}")
        result = process_transcript_file(args.input, out_dir, args.task)
        summary_path = out_dir / "_build_summary.json"
        summary_path.write_text(
            json.dumps([result], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"\n📋 Summary saved: {summary_path}")
        return 0 if result.get("status") == "OK" else 1

    # Collect URLs
    if args.single:
        urls = [args.input]
    else:
        input_path = Path(args.input)
        if not input_path.exists():
            print(f"❌ File not found: {input_path}", file=sys.stderr)
            return 1
        urls = [line.strip() for line in input_path.read_text(encoding="utf-8").splitlines()
                if line.strip() and not line.strip().startswith("#")]

    if not urls:
        print("❌ No URLs found!", file=sys.stderr)
        return 1

    print(f"\n🚀 Auto-Build Knowledge — {len(urls)} video(s)")
    print(f"📂 Output: {out_dir.resolve()}")
    print(f"🌐 Language: {args.lang}")

    results = []
    for url in urls:
        result = process_single_url(url, out_dir, args.lang, args.task)
        results.append(result)

    # Summary
    ok = [r for r in results if r.get("status") == "OK"]
    errors = [r for r in results if r.get("status") == "ERROR"]
    skipped = [r for r in results if r.get("skipped")]

    print(f"\n{'='*60}")
    print(f"📊 SUMMARY")
    print(f"{'='*60}")
    print(f"  ✅ Success: {len(ok)}")
    print(f"  ❌ Errors:  {len(errors)}")
    print(f"  ⏭️  Skipped: {len(skipped)}")

    if errors:
        print("\nFailed URLs:")
        for r in errors:
            print(f"  - {r['url']}: {r.get('error', 'unknown')}")

    # Write summary JSON
    summary_path = out_dir / "_build_summary.json"
    summary_path.write_text(
        json.dumps(results, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n📋 Summary saved: {summary_path}")

    return 1 if errors else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
