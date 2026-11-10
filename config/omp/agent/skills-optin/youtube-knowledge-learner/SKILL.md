---
name: youtube-knowledge-learner
description: Use this skill whenever the user provides a YouTube URL or video file and wants the AI to transcribe it, learn the useful knowledge, create a reusable Markdown reference note, or apply the video knowledge to another task. Trigger even when the user says "watch this video", "learn from this YouTube video", "summarize this tutorial", "use this video as context", "make notes from this lecture", or asks to produce a reference document from video content.
hide: true
---

# YouTube Knowledge Learner

Use this skill to turn a YouTube video into task-ready knowledge:

1. Acquire a transcript or captions.
2. Preserve source metadata and timestamped references.
3. Distill the video into a reusable Markdown reference.
4. Apply the learned knowledge to the user's current task.

The goal is not a generic summary. The output should help a future agent quickly reuse the video as reliable context without watching it again.

## Inputs

Accept any of these:

- A YouTube URL.
- A local audio/video file.
- A transcript file supplied by the user.
- A YouTube URL plus a task, such as "watch this and implement the approach".

If the user gives both a video and a task, produce the reference note first, then use that note as context for the task.

## Default Output

Create a Markdown note under a sensible project-local folder, usually:

```text
knowledge/youtube/<slug>.md
```

If the project already has a docs, notes, research, or knowledge folder, follow that convention instead.

Use this structure:

```markdown
# <Video title>

Source: <URL or file path>
Channel/author: <name if known>
Captured: <YYYY-MM-DD>
Transcript source: <official captions | auto captions | local transcription | user-provided transcript>
Task context: <what the user wanted to do with this video, or "reference only">

## Executive Summary
<5-10 bullets with the video's main claims and practical conclusions.>

## Core Concepts
<Concept-by-concept explanation, preserving definitions, assumptions, and constraints.>

## Procedures And Workflows
<Step-by-step methods taught in the video. Include timestamps when available.>

## Decisions, Tradeoffs, And Warnings
<What to do, what not to do, when advice changes, limitations, caveats.>

## Task-Relevant Notes
<Only include this when the user gave a task. Explain how the knowledge applies to that task.>

## Timestamp Index
- <00:00> <topic>
- <03:12> <topic>

## Reusable Prompt Context
<A compact block a future agent can paste into a prompt to reuse the knowledge.>

## Open Questions
<Unclear, missing, or unverifiable points.>
```

Do not paste a full copyrighted transcript into the final response. For local project files, store raw transcripts only when needed for processing or when the user explicitly asked for a transcript artifact. The reference note should mostly be paraphrased synthesis with short timestamped excerpts only where they are essential.

## Transcript Acquisition

Prefer sources in this order:

1. Official/manual captions from YouTube.
2. Auto-generated captions from YouTube.
3. User-provided transcript.
4. Local transcription from downloaded audio using the project's existing transcription tool, Whisper, OpenAI audio transcription, or another already-approved tool.

Do not add new dependencies unless the user explicitly asks. If tools are missing, explain the missing tool and use the next available path.

### Automated Builder

This skill includes `scripts/auto_build_knowledge.py`, which automates the entire pipeline:
1. **Transcription**: Fetches captions (prefers `vi`, fallbacks to `en`).
2. **Knowledge Synthesis**: Extracts concepts, procedures, warnings, and creates a timestamp index without generic placeholders.
3. **Learning Materials**: Generates flashcards, quizzes, and a spaced repetition schedule.

The script is located at:
`.agent/skills/youtube-knowledge-learner/scripts/auto_build_knowledge.py`

#### Usage

**Batch from file:**
```powershell
python .agent/skills/youtube-knowledge-learner/scripts/auto_build_knowledge.py urls.txt
```

**Single URL with Task:**
```powershell
python .agent/skills/youtube-knowledge-learner/scripts/auto_build_knowledge.py "https://youtube.com/watch?v=..." --single --task "implement this workflow"
```

**Local Transcript File:**
```powershell
python .agent/skills/youtube-knowledge-learner/scripts/auto_build_knowledge.py "path/to/transcript.txt" --transcript
```

## Quality Bar

The generated knowledge note is complete when it allows answering:
- What did the video teach? (Executive Summary)
- Which steps should I follow? (Procedures)
- Which assumptions and caveats matter? (Warnings)
- Where in the video did each point appear? (Timestamp Index)
- How does this knowledge affect the user's task? (Task-Relevant Notes)

## Applying The Knowledge

When the user gives a downstream task, treat the generated `.knowledge.md` as a source artifact:
- Read the relevant sections before editing code or producing a plan.
- Cite the note path and timestamped source points in your reasoning.
- Prefer concrete procedures from the video over vague summary.

## Failure Handling

If captions cannot be fetched:
- Check if `yt-dlp` is installed and the URL is accessible.
- Try another caption language if the user allows it.
- Ask the user for a transcript only after tool-based paths are exhausted.

---
*Next skill: writing-plans* (if applying knowledge to a project)
*Next skill: adaptive-learning* (to store learned insights permanently)

