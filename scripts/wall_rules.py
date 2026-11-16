"""Shared rules for class-wall messages (used by check_wall_pr.py and build_wall.py)."""
from __future__ import annotations

import re

MAX_LENGTH = 80
MAX_LINES = 3
USERNAME_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$")
URL_RE = re.compile(r"https?://|www\.", re.IGNORECASE)
LONG_NUMBER_RE = re.compile(r"\d{7,}")


def normalize(text: str) -> str:
    """Strip a BOM and surrounding whitespace, collapse Windows newlines."""
    return text.lstrip("﻿").replace("\r\n", "\n").strip()


def message_problems(text: str) -> list[str]:
    """Returns zh-TW explanations of what is wrong with a wall message (empty list = OK)."""
    msg = normalize(text)
    problems = []
    if not msg:
        problems.append("內容是空的，請寫一句話")
    if len(msg) > MAX_LENGTH:
        problems.append(f"太長了：{len(msg)} 字，最多 {MAX_LENGTH} 字")
    if msg.count("\n") + 1 > MAX_LINES:
        problems.append(f"最多 {MAX_LINES} 行")
    if URL_RE.search(msg):
        problems.append("請不要放網址")
    if LONG_NUMBER_RE.search(msg):
        problems.append("看起來像學號或電話，請不要放個人資料")
    if "<" in msg and ">" in msg:
        problems.append("請不要放 HTML 標籤")
    return problems
