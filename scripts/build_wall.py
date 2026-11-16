"""
Builds wall.json from wall/*.txt for the class wall on the site.

Usage: python scripts/build_wall.py [WALL_DIR] [OUTPUT]   (defaults: wall  wall.json)
Files that break the rules are skipped (with a warning), so one bad file can't break the page.
The time of each entry is the last commit that touched the file (needs full git history).
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from wall_rules import USERNAME_RE, message_problems, normalize  # noqa: E402


def commit_time(path: Path) -> str | None:
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%cI", "--", str(path)],
                             check=True, capture_output=True, text=True).stdout.strip()
        return out or None
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def build(wall_dir: Path) -> dict:
    entries = []
    for path in sorted(wall_dir.glob("*.txt")):
        user = path.stem
        if not USERNAME_RE.match(user):
            print(f"skip {path}: not a GitHub username", file=sys.stderr)
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        problems = message_problems(text)
        if problems:
            print(f"skip {path}: {'; '.join(problems)}", file=sys.stderr)
            continue
        entries.append({"user": user, "message": normalize(text), "time": commit_time(path)})
    entries.sort(key=lambda e: (e["time"] or "", e["user"].lower()))
    return {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "entries": entries}


if __name__ == "__main__":
    wall_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "wall")
    output = Path(sys.argv[2] if len(sys.argv) > 2 else "wall.json")
    data = build(wall_dir)
    output.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {output}: {len(data['entries'])} entries")
