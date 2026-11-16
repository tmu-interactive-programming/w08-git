"""
Checks a class-wall pull request: it may only add or edit wall/<PR author>.txt, with a short message.

Runs from the *base* branch under pull_request_target, so a PR cannot change the rules it is
checked against. The PR's files are only read as data through git (never executed).

Usage: python scripts/check_wall_pr.py BASE_SHA HEAD_SHA PR_AUTHOR
Exit code 0 = OK, 1 = problems (printed in zh-TW, also written to $GITHUB_STEP_SUMMARY).
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from wall_rules import USERNAME_RE, message_problems  # noqa: E402


def git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def check(base: str, head: str, author: str) -> list[str]:
    expected = f"wall/{author}.txt"
    raw = git("diff", "--name-status", "--no-renames", f"{base}...{head}")
    changes = [line.split("\t") for line in raw.splitlines() if line.strip()]
    if not changes:
        return ["這個 PR 沒有任何檔案變更"]

    problems = []
    others = [c for c in changes if c[-1].lower() != expected.lower()]
    for status, *paths in others:
        problems.append(f"只能新增或修改 `{expected}`，但這個 PR 也動到了 `{paths[-1]}`（{status}）")

    mine = [c for c in changes if c[-1].lower() == expected.lower()]
    if not mine:
        problems.append(f"找不到 `{expected}`。檔名要是你的 GitHub 帳號：`{expected}`")
    for status, path in mine:
        if status == "D":
            problems.append(f"不要刪除 `{path}`")
            continue
        content = git("show", f"{head}:{path}")
        problems.extend(message_problems(content))
    return problems


def main() -> int:
    base, head, author = sys.argv[1:4]
    if not USERNAME_RE.match(author):
        print(f"無效的帳號：{author}")
        return 1
    problems = check(base, head, author)
    lines = (["## ✅ wall-check 通過", "", f"可以按 **Merge pull request** 了，@{author}！"] if not problems
             else ["## ❌ wall-check 沒有通過", "", *[f"- {p}" for p in problems], "",
                   "修改後再 commit 一次到同一個分支，檢查會自動重跑。"])
    report = "\n".join(lines)
    print(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(report + "\n")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
