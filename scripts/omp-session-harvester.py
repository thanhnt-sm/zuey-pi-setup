#!/usr/bin/env python3
"""
scripts/omp-session-harvester.py
Harvest reusable tool scripts, detect duplicated utility implementations across
OMP sessions (~/.omp/agent/sessions/*.jsonl) and local workspaces, and register
them into plans/omp-consolidation-ledger.json and plans/harvest-inventory.md.

Dual-Mode:
  - Non-interactive / Agent Mode: python scripts/omp-session-harvester.py --scan
  - Interactive Human Mode:       python scripts/omp-session-harvester.py
"""

import os
import sys
import json
import glob
import re
import hashlib
import argparse
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional, Set, Tuple

# Classification Keywords and Domain Indicators
SUITE_PATTERNS = {
    "pmo_project_suite": [
        r"\bwbs\b", r"\bcpm\b", r"\bevm\b", r"\bpert\b", r"critical_path", r"float_calc",
        r"earned_value", r"msproject", r"\bmpp\b", r"\braid\b", r"\bpmo\.py\b",
        r"MSProject\.Application", r"schedule_calc", r"pmi[-_]pmo"
    ],
    "office_doc_suite": [
        r"\bopenpyxl\b", r"python-docx", r"\bdocx\b", r"\bxlsxwriter\b", r"\bmermaid\b",
        r"spatial_extract", r"receipt_extract", r"md-convert",
        r"table_extract", r"pdfplumber", r"\bpypdf\b", r"export_excel"
    ],
    "email_intelligence_suite": [
        r"extract_msg", r"email\.parser", r"Outlook\.Application",
        r"\.eml\b", r"\.msg\b", r"email_export", r"msg_parser",
        r"thread_parser", r"email_extract", r"thread_hash", r"email_source",
        r"\bmailbox\b", r"\bemails\b"
    ],
    "system_maintenance_suite": [
        r"cleanpc", r"wiztree", r"uninstaller", r"disk_usage",
        r"windows-cleanup", r"clean_temp", r"dev_cache", r"ai-tool-uninstaller",
        r"macos[-_]clean"
    ]
}

PATH_AFFINITIES = [
    (re.compile(r"(02_Emails_Export|email_export|email)", re.IGNORECASE), "email_intelligence_suite", 10),
    (re.compile(r"(project-excel-sync|pmi-pmo|pmo|Note_multiline|schedule_calc)", re.IGNORECASE), "pmo_project_suite", 10),
    (re.compile(r"(CleanPC|wiztree|uninstaller|cleanup)", re.IGNORECASE), "system_maintenance_suite", 10),
    (re.compile(r"(document-analysis|spatial|md-convert|docx|pdf)", re.IGNORECASE), "office_doc_suite", 10),
]

SENSITIVE_PATTERNS = [
    (re.compile(r"(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z-_]{35}|tvly-[a-zA-Z0-9]{20,})"), "[REDACTED_API_KEY]"),
    (re.compile(r"Bearer\s+[a-zA-Z0-9_\-\.]{20,}", re.IGNORECASE), "Bearer [REDACTED_TOKEN]"),
    (re.compile(r"[a-zA-Z0-9_.+-]+@softmart\.net\.vn", re.IGNORECASE), "[REDACTED_INTERNAL_EMAIL]"),
    (re.compile(r"\b(PVC|QLSV)\b"), "[PROJECT_CODE]"),
    (re.compile(r"[A-Za-z]:[\\/][^\"'\s]+", re.IGNORECASE), lambda m: sanitize_path(m.group(0)))
]

def sanitize_path(path_str: str) -> str:
    norm = path_str.replace("\\", "/")
    # Mask user home and specific workspace folders
    home = os.path.expanduser("~").replace("\\", "/")
    if norm.lower().startswith(home.lower()):
        return "~" + norm[len(home):]
    if re.match(r'^[A-Za-z]:/', norm):
        parts = [p for p in norm.split("/") if p]
        tail = parts[-2:] if len(parts) >= 2 else parts
        return "<local-workspace>/" + "/".join(tail)
    return norm

def sanitize_text(text: str) -> str:
    res = text
    for pat, repl in SENSITIVE_PATTERNS:
        if callable(repl):
            res = pat.sub(repl, res)
        else:
            res = pat.sub(repl, res)
    return res

def classify_snippet(code: str, file_path: str = "") -> str:
    haystack = (file_path + " " + code).lower()
    scores: Dict[str, int] = {}
    # Apply path affinity bias first
    for pat, suite, weight in PATH_AFFINITIES:
        if pat.search(file_path):
            scores[suite] = scores.get(suite, 0) + weight

    for suite, patterns in SUITE_PATTERNS.items():
        score = sum(1 for p in patterns if re.search(p, haystack, re.IGNORECASE))
        if score > 0:
            scores[suite] = scores.get(suite, 0) + score
    if scores:
        return max(scores.items(), key=lambda x: x[1])[0]
    return "general_utilities"
def compute_code_hash(code: str) -> str:
    # Normalize whitespace to catch structural duplicates
    lines = [l.strip() for l in code.splitlines() if l.strip() and not l.strip().startswith(("#", "//"))]
    normalized = "\n".join(lines)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:12]

class SessionHarvester:
    def __init__(self, sessions_dir: Optional[str] = None, ledger_path: str = "plans/omp-consolidation-ledger.json"):
        self.sessions_dir = sessions_dir or os.path.expanduser("~/.omp/agent/sessions")
        self.ledger_path = ledger_path
        self.harvested_artifacts: List[Dict[str, Any]] = []
        self.duplicate_groups: Dict[str, List[Dict[str, Any]]] = {}

    def scan_sessions(self) -> Dict[str, Any]:
        all_jsonl = glob.glob(os.path.join(self.sessions_dir, "**", "*.jsonl"), recursive=True)
        # Exclude advisor files
        session_files = [sf for sf in all_jsonl if not os.path.basename(sf).startswith("__advisor")]
        top_level_count = sum(1 for sf in session_files if not os.path.basename(os.path.dirname(sf)).startswith("2026-"))
        subagent_count = len(session_files) - top_level_count
        print(f"[*] Found {len(session_files)} session transcripts ({top_level_count} top-level, {subagent_count} subagents; {len(all_jsonl) - len(session_files)} advisors skipped) in {self.sessions_dir}")

        total_tool_calls = 0
        extracted_scripts = 0

        for sf in session_files:
            rel_session = os.path.relpath(sf, self.sessions_dir)
            session_written: Dict[str, Dict[str, Any]] = {}
            try:
                with open(sf, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            entry = json.loads(line)
                        except json.JSONDecodeError:
                            continue

                        msg = entry.get("message")
                        if not isinstance(msg, dict):
                            continue
                        content = msg.get("content", [])
                        if not isinstance(content, list):
                            continue

                        for block in content:
                            if not isinstance(block, dict) or block.get("type") != "toolCall":
                                continue
                            total_tool_calls += 1
                            name = block.get("name")
                            args = block.get("arguments", {})
                            if not isinstance(args, dict):
                                continue

                            code_content = ""
                            target_path = ""
                            tool_kind = name

                            if name == "write":
                                target_path = args.get("path", "")
                                code_content = args.get("content", "")
                            elif name == "eval":
                                lang = args.get("language", "py")
                                code_content = args.get("code", "")
                                if len(code_content) > 120 and any(kw in code_content for kw in [
                                    "def ", "class ", "import openpyxl", "import docx", "from docx", "wbs", "cpm", "evm", "raid"
                                ]):
                                    target_path = f"eval_{lang}"
                            elif name == "bash":
                                cmd = args.get("command", "")
                                if "cat <<" in cmd:
                                    m = re.search(r"cat\s+<<\s*['\"]?EOF['\"]?\s*>\s*([^\s\n]+)\n(.*?)\nEOF", cmd, re.DOTALL)
                                    if m:
                                        target_path = m.group(1).strip()
                                        code_content = m.group(2)

                            if target_path and code_content and len(code_content) > 100:
                                # Keep final written content per target path within this session
                                session_written[target_path] = {
                                    "tool": tool_kind,
                                    "content": code_content
                                }

                for target_path, item in session_written.items():
                    code_content = item["content"]
                    tool_kind = item["tool"]
                    suite = classify_snippet(code_content, target_path)
                    c_hash = compute_code_hash(code_content)
                    sanitized = sanitize_text(code_content)

                    artifact = {
                        "session": sanitize_path(rel_session),
                        "tool": tool_kind,
                        "target": sanitize_path(target_path),
                        "suite": suite,
                        "hash": c_hash,
                        "lines": len(code_content.splitlines()),
                        "bytes": len(code_content),
                        "snippet_preview": sanitized[:200].replace("\n", " ") + ("..." if len(sanitized) > 200 else "")
                    }
                    self.harvested_artifacts.append(artifact)
                    self.duplicate_groups.setdefault(c_hash, []).append(artifact)
                    extracted_scripts += 1
            except Exception as e:
                print(f"[!] Warning reading session {sf}: {e}", file=sys.stderr)

        print(f"[v] Parsed {total_tool_calls} tool calls; extracted {extracted_scripts} candidate code artifacts from sessions.")
        return {
            "total_sessions": len(session_files),
            "top_level_sessions": top_level_count,
            "subagent_sessions": subagent_count,
            "total_tool_calls": total_tool_calls,
            "extracted_scripts": extracted_scripts,
            "unique_hashes": len(self.duplicate_groups)
        }
    def scan_workspaces(self, workspace_paths: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        if workspace_paths is None:
            env_paths = os.environ.get("OMP_HARVEST_WORKSPACES", "").strip()
            if env_paths:
                ws_list = [p.strip() for p in env_paths.replace(";", ",").split(",") if p.strip()]
            else:
                config_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config", "harvest-workspaces.json")
                if os.path.exists(config_file):
                    try:
                        with open(config_file, "r", encoding="utf-8") as cf:
                            ws_list = json.load(cf)
                    except Exception:
                        ws_list = []
                else:
                    ws_list = []
        else:
            ws_list = workspace_paths
        found_files = []
        for ws in ws_list:
            if not os.path.exists(ws):
                continue
            for ext in ["*.py", "*.ps1", "*.sh"]:
                for fp in glob.glob(os.path.join(ws, "**", ext), recursive=True):
                    if any(ign in fp for ign in ["node_modules", ".git", ".venv", "__pycache__", "venv"]):
                        continue
                    try:
                        sz = os.path.getsize(fp)
                        if sz > 150: # filter out tiny inits
                            with open(fp, "r", encoding="utf-8", errors="ignore") as f:
                                content = f.read()
                            suite = classify_snippet(content, fp)
                            c_hash = compute_code_hash(content)
                            rel_name = os.path.basename(fp)
                            artifact = {
                                "session": "local_workspace",
                                "tool": "file",
                                "target": sanitize_path(fp),
                                "suite": suite,
                                "hash": c_hash,
                                "lines": len(content.splitlines()),
                                "bytes": sz,
                                "snippet_preview": sanitize_text(content[:200].replace("\n", " ")) + "..."
                            }
                            self.harvested_artifacts.append(artifact)
                            self.duplicate_groups.setdefault(c_hash, []).append(artifact)
                            found_files.append(artifact)
                    except Exception as e:
                        pass
        print(f"[v] Scanned local workspaces: extracted {len(found_files)} script files.")
        return found_files

    def update_ledger(self) -> None:
        if not os.path.exists(self.ledger_path):
            print(f"[!] Ledger not found at {self.ledger_path}, creating blank baseline.")
            ledger = {"version": "1.0.0", "suites": {}, "summary": {}}
        else:
            with open(self.ledger_path, "r", encoding="utf-8") as f:
                ledger = json.load(f)

        # Update summary statistics
        ledger.setdefault("summary", {})
        ledger["summary"]["totalSessionsScouted"] = len(glob.glob(os.path.join(self.sessions_dir, "**", "*.jsonl"), recursive=True))
        ledger["summary"]["harvestedArtifactsCount"] = len(self.harvested_artifacts)
        ledger["summary"]["uniqueCodeClusters"] = len(self.duplicate_groups)
        ledger["summary"]["lastHarvestTimestamp"] = datetime.now(timezone.utc).isoformat()
        ledger["status"] = "HARVESTED"

        # Update suite mapping
        suite_counts = {}
        for a in self.harvested_artifacts:
            suite = a.get("suite", "general_utilities")
            suite_counts[suite] = suite_counts.get(suite, 0) + 1

        ledger.setdefault("suites", {})
        for s_name, count in suite_counts.items():
            if s_name in ledger["suites"]:
                ledger["suites"][s_name]["harvestedCount"] = count
                ledger["suites"][s_name]["status"] = "HARVESTED"

        # Record top duplicate clusters
        top_dupes = []
        for c_hash, items in sorted(self.duplicate_groups.items(), key=lambda x: len(x[1]), reverse=True):
            if len(items) > 1:
                top_dupes.append({
                    "hash": c_hash,
                    "suite": items[0]["suite"],
                    "occurrences": len(items),
                    "targets": [x["target"] for x in items[:5]]
                })
        ledger["topDuplicateClusters"] = top_dupes[:20]

        os.makedirs(os.path.dirname(self.ledger_path), exist_ok=True)
        with open(self.ledger_path, "w", encoding="utf-8") as f:
            json.dump(ledger, f, indent=2, ensure_ascii=False)
        print(f"[v] Updated ledger at {self.ledger_path}")

    def generate_inventory_report(self, output_path: str = "plans/harvest-inventory.md") -> None:
        suite_groups: Dict[str, List[Dict[str, Any]]] = {}
        for art in self.harvested_artifacts:
            suite = art.get("suite", "general_utilities")
            suite_groups.setdefault(suite, []).append(art)

        lines = [
            "# OMP Harvest Inventory & Deduplication Report",
            "",
            f"- **Generated:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
            f"- **Total Candidate Artifacts Extracted:** {len(self.harvested_artifacts)}",
            f"- **Unique Code Hashes:** {len(self.duplicate_groups)}",
            "",
            "## 1. Summary by Target Suite",
            "",
            "| Target Suite | Extracted Artifacts | Proposed Managed Skill Location |",
            "|---|---|---|"
        ]

        target_paths = {
            "pmo_project_suite": "`config/omp/agent/managed-skills/pmo-project-suite`",
            "office_doc_suite": "`config/omp/agent/managed-skills/office-doc-suite`",
            "email_intelligence_suite": "`config/omp/agent/managed-skills/email-intelligence-suite`",
            "system_maintenance_suite": "`config/omp/agent/managed-skills/system-maintenance-suite`",
            "general_utilities": "`config/omp/agent/managed-skills/general-utilities`"
        }

        for s_name, items in sorted(suite_groups.items(), key=lambda x: len(x[1]), reverse=True):
            loc = target_paths.get(s_name, f"`config/omp/agent/managed-skills/{s_name}`")
            lines.append(f"| **`{s_name}`** | {len(items)} | {loc} |")

        sorted_clusters = sorted(self.duplicate_groups.items(), key=lambda x: len(x[1]), reverse=True)
        dup_clusters = [(c_hash, items) for c_hash, items in sorted_clusters if len(items) > 1]
        lines.extend([
            "",
            "## 2. Top Duplicated Code Clusters (Repeated Utilities)",
            "",
            f"Found **{len(dup_clusters)}** duplicate code clusters across scanned sessions and workspaces:",
            "",
            "| Hash | Occurrences | Suite | Sample Targets / Snippet Preview |",
            "|---|---|---|---|"
        ])
        if not dup_clusters:
            lines.append("| - | 0 | - | No verbatim duplicate scripts detected across workspaces. |")
        else:
            for c_hash, items in dup_clusters[:20]:
                rep = items[0]
                targets_sample = ", ".join(list(set(x["target"] for x in items))[:3])
                preview = rep["snippet_preview"][:120].replace("|", "\\|")
                lines.append(f"| `{c_hash}` | **{len(items)}** | `{rep['suite']}` | `{targets_sample}`<br>*{preview}* |")
        lines.extend([
            "",
            "## 3. Recommended Consolidation Actions",
            "",
            "1. **PMO Project Suite (`pmo-project-suite`):** Consolidate all CPM/EVM/WBS math into pure Python `core_pmo.py` with `openpyxl` & `defusedxml`, eliminating redundant ad-hoc scripts.",
            "2. **Office Document Suite (`office-doc-suite`):** Standardize Markdown-to-DOCX/XLSX pipeline with embedded Mermaid and table extractors into a single CLI.",
            "3. **Email Intelligence Suite (`email-intelligence-suite`):** Unify multi-threaded `.eml`/`.msg` parser with SHA-256 deduplication and Markdown/Excel reporting.",
            "4. **System Maintenance Suite (`system-maintenance-suite`):** Merge Windows `.ps1` and macOS `.sh` cleanup modules under an OS-adaptive dispatcher.",
            ""
        ])

        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        print(f"[v] Generated inventory report at {output_path}")

def run_interactive_menu(harvester: SessionHarvester) -> None:
    while True:
        print("\n" + "="*50)
        print(" OMP Session & Workspace Harvester CLI")
        print("="*50)
        print("1. Scan sessions & workspaces (Dry-Run)")
        print("2. Update ledger and generate Markdown report")
        print("3. View top duplicated code clusters")
        print("4. Exit")
        try:
            choice = input("\nSelect option [1-4]: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting.")
            break

        if choice == "1":
            harvester.scan_sessions()
            harvester.scan_workspaces()
        elif choice == "2":
            if not harvester.harvested_artifacts:
                harvester.scan_sessions()
                harvester.scan_workspaces()
            harvester.update_ledger()
            harvester.generate_inventory_report()
        elif choice == "3":
            if not harvester.duplicate_groups:
                harvester.scan_sessions()
                harvester.scan_workspaces()
            print("\n--- Top Duplicated Clusters ---")
            for h, items in sorted(harvester.duplicate_groups.items(), key=lambda x: len(x[1]), reverse=True)[:10]:
                print(f"[{h}] {len(items)} times ({items[0]['suite']}): {items[0]['target']}")
        elif choice == "4":
            print("Done.")
            break
        else:
            print("[!] Invalid selection.")

def main():
    parser = argparse.ArgumentParser(description="Harvest reusable OMP tools across sessions and workspaces.")
    parser.add_argument("--scan", action="store_true", help="Run in non-interactive scan mode.")
    parser.add_argument("--sessions-dir", type=str, default=None, help="Custom sessions directory to scan.")
    parser.add_argument("--ledger", type=str, default="plans/omp-consolidation-ledger.json", help="Path to consolidation ledger.")
    parser.add_argument("--report", type=str, default="plans/harvest-inventory.md", help="Path to output markdown inventory report.")
    parser.add_argument("--workspaces", nargs="*", default=None, help="List of workspace directories to scan.")

    args = parser.parse_args()
    harvester = SessionHarvester(sessions_dir=args.sessions_dir, ledger_path=args.ledger)

    if args.scan:
        harvester.scan_sessions()
        harvester.scan_workspaces(workspace_paths=args.workspaces)
        harvester.update_ledger()
        harvester.generate_inventory_report(output_path=args.report)
    else:
        # Check if running in interactive TTY
        if sys.stdin.isatty():
            run_interactive_menu(harvester)
        else:
            # Fall back to scan mode if piped or non-tty
            harvester.scan_sessions()
            harvester.scan_workspaces(workspace_paths=args.workspaces)
            harvester.update_ledger()
            harvester.generate_inventory_report(output_path=args.report)

if __name__ == "__main__":
    main()
