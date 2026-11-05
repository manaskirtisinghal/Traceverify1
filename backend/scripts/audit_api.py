"""Live end-to-end audit of a running TRACEVERIFY API.

Starts investigations for several seeds over HTTP (at the fixed system threshold) and re-runs
them with a narrower window, then verifies that every returned event is a real ingested row
(matching both PostgreSQL and the original source file line), that accepted links meet the
threshold, that narrowing the window never adds events, that a per-request threshold is
rejected, and that scores recompute from their components.

Usage (backend running on :8000, from backend/):
    python -m scripts.audit_api [--base http://127.0.0.1:8000]
"""
import argparse
import gzip
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

from sqlalchemy import text

from app.config import PROJECT_ROOT
from app.database.session import engine

FAILURES: list[str] = []


def call(base: str, method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(base + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def check(cond: bool, msg: str) -> None:
    if not cond:
        FAILURES.append(msg)
        print(f"   FAIL {msg}")


def source_lines() -> dict[str, list[str]]:
    lines = {}
    for p in list((PROJECT_ROOT / "data").rglob("*.txt.gz")) + list((PROJECT_ROOT / "data").rglob("*.txt")):
        opener = gzip.open if p.suffix == ".gz" else open
        with opener(p, "rt", encoding="utf-8") as fh:
            lines[p.name] = [ln.rstrip("\r\n") for ln in fh]
    return lines


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    base = ap.parse_args().base
    files = source_lines()

    seeds = call(base, "GET", "/api/investigations/seeds")
    print(f"seeds: {len(seeds)}")
    chosen = [seeds[0], seeds[4], seeds[10]]
    for seed in chosen:
        print(f"\n== seed #{seed['id']} t={seed['ts']} {seed['user_name']} {seed['src_computer']}->{seed['dst_computer']}")
        inv = call(base, "POST", "/api/investigations/start", {"seed_event_id": seed["id"]})
        thr = inv["params"]["threshold"]
        try:
            call(base, "POST", f"/api/investigations/{inv['id']}/rerun", {"threshold": 0.45})
            check(False, "per-request threshold was accepted (it is a fixed system setting)")
        except urllib.error.HTTPError as e:
            check(e.code == 422, f"per-request threshold returned HTTP {e.code}, expected 422")
        tl = call(base, "GET", f"/api/investigations/{inv['id']}/events")
        rels = call(base, "GET", f"/api/investigations/{inv['id']}/relationships")
        w = inv["params"]["weights"]
        ids = {t["id"] for t in tl if not t["is_seed"]}
        m = inv["metrics"]
        rules = sorted({r["matched_rule_code"] or "-" for r in rels})
        print(f"   default window thr={thr:.2f} events={len(ids):>2} rels={len(rels):>2} candidates={m['candidates_evaluated']:>2}/"
              f"{m['events_in_window']} depth={m['max_path_depth']} latency={m['latency_ms']}ms rules={','.join(rules)}")
        for r in rels:
            recomputed = w["entity"] * r["entity_score"] + w["temporal"] * r["temporal_score"] + w["rule"] * r["rule_score"]
            check(abs(recomputed - r["final_score"]) < 2e-3, f"rel {r['id']} final {r['final_score']} != {recomputed:.4f}")
            check(r["final_score"] >= thr, f"rel {r['id']} below threshold")
        t_min, t_max = seed["ts"] - inv["params"]["window_before"], seed["ts"] + inv["params"]["window_after"]
        with engine.connect() as conn:
            for t in tl:
                row = conn.execute(text("SELECT raw_line, source_file, line_no, ts FROM events WHERE id=:i"),
                                   {"i": t["id"]}).one()
                check(row.raw_line == t["raw_line"], f"event {t['id']} raw line differs from DB")
                check(files[row.source_file][row.line_no - 1] == row.raw_line,
                      f"event {t['id']} not found at {row.source_file}:{row.line_no}")
                check(t["is_seed"] or t_min <= t["ts"] <= t_max, f"event {t['id']} outside window")
        # narrow the window
        inv = call(base, "POST", f"/api/investigations/{inv['id']}/rerun",
                   {"window_before": 0, "window_after": 20})
        tl = call(base, "GET", f"/api/investigations/{inv['id']}/events")
        print(f"   window -0/+20s thr={thr:.2f} events={len(tl) - 1}")
        check(all(seed["ts"] <= t["ts"] <= seed["ts"] + 20 for t in tl), "narrow window leaked events")
        check(len(tl) - 1 <= len(ids), "narrow window returned more events than wide window")
        detail = call(base, "GET", f"/api/events/{tl[-1]['id']}")
        check(detail["id"] == tl[-1]["id"] and detail["entities"], "event detail endpoint")

    print("\nRESULT:", "PASS" if not FAILURES else f"{len(FAILURES)} FAILURE(S)")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
