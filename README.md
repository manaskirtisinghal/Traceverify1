# TRACEVERIFY — Evidence Correlation & Cyber-Incident Verification Platform

TRACEVERIFY correlates heterogeneous security events (authentication, process, DNS and
network-flow records) and reconstructs an **explainable candidate incident timeline** from a
selected investigation seed. It uses a transparent **Hybrid Entity–Temporal–Rule** correlation
engine. There is no machine-learning model. Every link it draws comes with the shared entities,
the time difference, the matched transition rule and a component-by-component score breakdown.

> **Correlation is not causation.** TRACEVERIFY outputs *candidate evidence relationships* for
> analyst review. It never claims that a relationship proves attacker intent or causality.

Third-year B.Tech (CCE) Information Security Lab mini-project. The methodology follows the
project synopsis, whose base literature is Kotenko, Gaifulina & Zelichenok (2022): a *mixed*
approach that combines similarity-based and step-based correlation.

---

## 1. Architecture

```
 data/ (LANL-format .txt / .txt.gz)
        │  scripts/ingest.py
        ▼
 ┌─────────────── backend (Python · FastAPI · SQLAlchemy) ───────────────┐
 │ services/ingestion   parsers → normalizer → batched idempotent insert  │
 │ rules/               event-type vocabulary + 12 transition rules       │
 │ services/scoring     EntityScore · TemporalScore · RuleScore · Final   │
 │ services/correlation_engine   bounded expansion + path reconstruction  │
 │ services/investigation_service  persist runs, timeline, paths          │
 │ repositories/        SQL (indexed entity + time-window retrieval)      │
 │ controllers/         REST API  (/api/…, Swagger at /docs)              │
 └───────────────────────────────┬────────────────────────────────────────┘
                                 │  PostgreSQL 17
                                 ▼
 events · entities · event_entities · correlation_rules · investigations · relationships
                                 ▲
                                 │  JSON over HTTP (Vite dev proxy /api → :8000)
 ┌──────────────── frontend (React 18 · Vite) ─────────────────┐
 │ New investigation: starting event, search window,           │
 │   Advanced settings (weights, sources, bounds) → Run        │
 │ Results: Simple story (default) | Technical view: graph ·   │
 │   timeline · details · Adjust and re-run drawer             │
 └─────────────────────────────────────────────────────────────┘
```

| Layer | Technology |
|---|---|
| Database | PostgreSQL 17 (JSONB for source-specific attributes, B-tree indexes) |
| Backend | Python 3.12+ (tested on 3.14), FastAPI, SQLAlchemy 2, psycopg 3, Pydantic 2 |
| Frontend | React 18, Vite 5, hand-built SVG evidence graph (no graph library), IBM Plex Sans (UI) + JetBrains Mono (identifiers, timestamps, raw data) |
| Tests | pytest (unit + PostgreSQL integration), vitest, Playwright-core driving system Microsoft Edge |

Directory layout:

```
TRACEVERIFY/
├── backend/
│   ├── app/{models,schemas,controllers,services,repositories,rules,database}
│   ├── scripts/        init_db.py · ingest.py · audit_api.py
│   └── tests/          unit + integration tests
├── frontend/src/{components,pages,services,utils,styles} · e2e/smoke.mjs
├── data/{raw,processed,synthetic}
├── database/schema.sql (+ database/migrations/ for later changes)
├── .env.example · README.md · VIVA_GUIDE.md · IMPLEMENTATION_PLAN.md
```

---

## 2. Dataset and provenance

| File | Rows | Provenance |
|---|---|---|
| `data/raw/redteam_seed_subset.txt.gz` | 12 | According to the bundled dataset README, these are the **first 12 rows of the real LANL `redteam.txt.gz`** (they match the published file's first row `150885,U620@DOM1,C17693,C1003`). The full red-team file is not included. Labelled `LANL RED-TEAM SEED`. |
| `data/synthetic/auth.txt.gz` | 244 | **SYNTHETIC / LANL-FORMAT-COMPATIBLE DATA** |
| `data/synthetic/proc.txt.gz` | 260 | **SYNTHETIC / LANL-FORMAT-COMPATIBLE DATA** |
| `data/synthetic/dns.txt.gz` | 192 | **SYNTHETIC / LANL-FORMAT-COMPATIBLE DATA** |
| `data/synthetic/flows.txt.gz` | 216 | **SYNTHETIC / LANL-FORMAT-COMPATIBLE DATA** |

> ⚠ **Synthetic-data disclaimer.** The auth/proc/dns/flow rows were constructed for this project
> around the red-team seed timestamps and entities. They are **not** LANL observations. The UI
> header and every event record show this label, which is stored per row in `events.dataset_label`.

The synthetic rows follow the exact LANL Cyber1 schemas:

```
AUTH    time,srcUser,dstUser,srcComputer,dstComputer,authType,logonType,authOrient,outcome
PROC    time,user,computer,processName,eventType
FLOWS   time,duration,srcComputer,srcPort,dstComputer,dstPort,protocol,packets,bytes
DNS     time,srcComputer,resolvedComputer
REDTEAM time,user,srcComputer,dstComputer
```

Each seed has a coherent chain around it: matching logon → `powershell/cmd/rundll32` on the target
→ DNS from the target → flows to the resolved host. The data also contains background activity,
temporal distractors (e.g. `chrome.exe` on unrelated hosts a few seconds away), events that share
entities but match no rule, and later chains that are only weakly linked.

**Red-team rows are seeds, not detections.** They are never returned as candidate evidence, so
the ground-truth labels cannot leak into the correlation results.

**Real LANL windows.** The same parsers ingest real LANL files. Extract a bounded window instead
of loading 1.6 billion events:

```powershell
.\.venv\Scripts\python -m scripts.ingest --evidence-dir ..\data\raw\lanl_window --label lanl `
    --redteam ..\data\raw\redteam.txt.gz --around-redteam 3600
```

`--around-redteam S` keeps only rows within ±S seconds of a red-team event. `--t-min` and
`--t-max` select an absolute range. Files are streamed line by line, so `.gz` files never need
to be decompressed to disk.

---

## 3. Database schema (`database/schema.sql`)

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `events` | One normalized row per source record | `ts`, `source_type`, `event_type`, `user_name`, `src_computer`, `dst_computer`, `attributes JSONB`, `raw_line`, `source_file`, `line_no`, `dataset_label`; **unique `dedup_key`** |
| `entities` | Users, computers, process names | unique `(entity_type, value)`; `correlatable` = false for machine accounts (`C123$@DOM1`), built-in principals and process names |
| `event_entities` | Event ↔ entity links with role | PK `(event_id, entity_id, role)`; roles such as `src_user`, `dst_computer`, `resolved_computer` |
| `correlation_rules` | Rule registry (code, types, condition, full/partial score, enabled) | scores can be tuned in SQL without code changes |
| `investigations` | Seed, parameters (JSONB), metrics, run count | FK → `events` |
| `relationships` | Scored evidence edges per investigation | `entity/temporal/rule/final_score` ∈ [0,1], `time_delta_seconds`, `shared_entities JSONB`, `matched_rule_code`, `rule_match`, `explanation`, `status` (accepted/rejected), `is_primary`, `hop`; unique `(investigation_id, source, target)`; no self-loops |

Indexes: `events(ts)`, `events(source_type, ts)`, `events(user_name|src_computer|dst_computer)`,
`event_entities(entity_id, event_id)`, `relationships(investigation_id, status)`.

**Idempotent ingestion.** `dedup_key = sha1(source | raw line | occurrence-within-file)`, combined
with `ON CONFLICT DO NOTHING`. Re-running ingestion inserts nothing new, but legitimate identical
LANL rows are still kept. (The hash is used only as a duplicate key, not for security.)

**Migrations.** `scripts/init_db.py` applies `schema.sql` (baseline, idempotent) and then any
`database/migrations/NNN_*.sql` that has not been applied yet, recording each in `schema_migrations`.

---

## 4. Correlation methodology

### 4.1 Pipeline for one investigation

1. **Seed and window.** The analyst picks a seed `s` and a window `[tₛ − before, tₛ + after]`.
2. **Candidate retrieval (SQL).** Fetch events inside the window that share at least one
   *correlatable* entity (user or computer) with the current frontier. Red-team rows and
   deselected sources are excluded.
3. **Pair scoring.** Score every (frontier event, candidate) pair that actually shares an entity.
4. **Threshold.** Each candidate keeps its best pair. It is **accepted** if `FinalScore ≥ threshold`
   (a fixed, validated system setting: `DEFAULT_THRESHOLD`, 0.60, applied to every run and re-run);
   otherwise its best edge is stored as **rejected**, so the analyst can see why it was excluded.
5. **Bounded expansion.** Accepted events become the next frontier. This repeats for up to
   `max_hops` expansion rounds, capped at `max_nodes` events.
6. **Path reconstruction (step-based).** Each accepted event is attached to its best-scoring
   *earlier* accepted event (or the seed), with a cycle check at every step. This is what
   produces chains such as *logon → process → DNS → flow*. One extra *supporting* edge per event
   is kept for context.
7. **Timeline and paths.** The seed plus accepted events, ordered chronologically. Paths are the
   primary-parent chains from each leaf back to the seed, scored by their weakest link.

Edges only point from already-accepted events to new events. The graph is therefore acyclic,
has no duplicate edges and is bounded in size. Direct seed relationships have `hop = 1`;
multi-hop relationships have `hop > 1`.

### 4.2 Scores (each in [0, 1])

```
FinalScore = w₁·EntityScore + w₂·TemporalScore + w₃·RuleScore      (wᵢ ≥ 0, Σwᵢ = 1; default 0.4 / 0.3 / 0.3)
```

**EntityScore** compares the correlatable entities of the two events:

| Evidence | Contribution |
|---|---|
| ≥ 1 shared user | +0.45 |
| each shared computer (max 2) | +0.30 |
| host continuity: the later event originates on the host where the earlier event landed (e.g. logon to C1003 → DNS lookup *from* C1003) | +0.25 |

The total is capped at 1.0.

**TemporalScore** = `exp(−|Δt| / τ)` × ordering factor (1.0 if the event follows its parent,
0.85 if it precedes it, as with precursor evidence). τ defaults to 300 s.

**RuleScore** comes from the best transition rule that matches the *chronologically ordered*
pair. Rules test real fields (hosts, users, logon outcome) and never look at time:

| Code | Transition | Full condition (score) | Partial (score) |
|---|---|---|---|
| R01 | Seed ↔ same-path authentication | same user + same src→dst (1.0) | same user + dst (0.6) |
| R02 | Logon → process start on destination host | process host = logon dst + same user (1.0) | host only (0.5) |
| R03 | Process → DNS lookup from same host | DNS src = process host (1.0) | — |
| R04 | DNS resolution → flow to resolved host | flow src = DNS src and flow dst = resolved (1.0) | src only (0.4) |
| R05 | Logon → flow from destination host | flow src = logon dst (0.8) | flow between the same two hosts (0.4) |
| R06 | Process → outbound flow from same host | flow src = process host (0.8) | — |
| R07 | Logon → DNS from destination host | DNS src = logon dst (0.7) | — |
| R08 | Onward logon from compromised host | 2nd logon src = 1st logon dst + same user (1.0) | different user / same-user fan-out (0.5) |
| R09 | Process sequence on same host | same host + user (0.8) | same host (0.3) |
| R10 | Process → outbound logon from same host | logon src = process host + same user (0.7) | — |
| R11 | Repeated flow between same host pair | same src and dst (0.6) | — |
| R12 | Logon → logoff of the same session | same user + path (0.5) | — |

Logon rules require `outcome = Success`. If no rule matches, RuleScore = 0 and the explanation
says which rule was closest and why it failed. With the default weights, an event that only
shares a computer and happens very close in time scores at most 0.3·0.4 + 0.25·0.4 + 0.3 = 0.52,
which is below the default threshold of 0.60. **Temporal proximity alone cannot get an event
accepted.** An event with *strong* entity overlap (same user and both hosts) that is close in
time can still pass without a rule. That is deliberate: the explanation then says "no
transition rule matched", so the analyst can see that the link rests on entities and time only.

### 4.3 How the graph presents relationships

The engine stores each relationship in the direction it was *found*: source = the event the
search expanded from, target = the newly linked event. That can point backwards in time. For
example, the logon 8 s before seed 01 is stored as `seed → logon` with
`direction = backward, Δt = −8 s`. The UI does not draw that as "seed then logon":

* every arrow runs from the **earlier** to the **later** event (chronological order of
  correlated evidence, not cause and not search direction);
* columns count **links from the starting event**, and events that happened *before* the start
  sit in the start column, above it, labelled "… s before start";
* the details panel phrases the link chronologically ("Linked event: the starting event,
  8 s after this event").

This is purely presentational. The backend representation was verified correct and is unchanged.

### 4.4 Supporting context (not scored)

The event detail panel shows how often each entity occurs, and how frequently a process name
appears among all process events. This is the "lightweight statistical signal" from the synopsis,
kept strictly as context: it never changes a score.

---

## 5. API (FastAPI — Swagger UI at **http://127.0.0.1:8000/docs**)

| Method | Path | Description |
|---|---|---|
| GET | `/api/investigations/seeds` | Red-team seeds with nearby-evidence counts |
| POST | `/api/investigations/start` | Run a new investigation (body below) → 201 + summary |
| GET | `/api/investigations/{id}` | Parameters, metrics, seed, top-5 evidence, candidate paths |
| GET | `/api/investigations/{id}/events?include_rejected=false` | Chronological timeline (seed, accepted and optionally rejected events, with hop, score, rank, parent) |
| GET | `/api/investigations/{id}/relationships?status=accepted\|rejected\|all` | Relationships ranked by FinalScore, with all score components and the explanation |
| GET | `/api/events/{event_id}` | Event record, raw source line, entity context |
| POST | `/api/investigations/{id}/rerun` | Re-run with changed parameters (omitted fields keep previous values) |
| GET | `/api/investigations` | Recent investigations |
| GET | `/api/rules` · `/api/dataset` · `/api/health` | Rule registry, store contents by provenance, health |

`POST /api/investigations/start` body (all fields optional except `seed_event_id`):

```json
{
  "seed_event_id": 1,
  "window_before": 300, "window_after": 1800,
  "weights": {"entity": 0.4, "temporal": 0.3, "rule": 0.3},
  "temporal_decay": 300, "max_hops": 3, "max_nodes": 60,
  "source_types": ["auth", "proc", "dns", "flow"]
}
```

The threshold is not a request parameter: every run uses the fixed system value (0.60), and a
request that sends a different `threshold` is rejected with **422**.

Validation returns **422** for weights that are negative or do not sum to 1, a non-default threshold,
unknown source types or out-of-range windows. Unknown IDs return **404**. If the database
is unreachable the API returns **503**.

---

## 6. Local setup on Windows

### 6.1 Prerequisites
* Python 3.12+ (`py --version`), Node.js 18+ (`node --version`)
* PostgreSQL 15+ — either the EDB installer from postgresql.org, or the portable cluster
  already set up on this machine at `D:\TraceVerifyPG` (see 6.2)

### 6.2 PostgreSQL

**This machine (portable PostgreSQL 17.6 at `D:\TraceVerifyPG`, port 5432).** Start it after each reboot:

```powershell
D:\TraceVerifyPG\pgsql\bin\pg_ctl.exe -D D:\TraceVerifyPG\data -l D:\TraceVerifyPG\postgres.log start
D:\TraceVerifyPG\pgsql\bin\pg_isready.exe -h localhost -p 5432     # → accepting connections
# stop:  D:\TraceVerifyPG\pgsql\bin\pg_ctl.exe -D D:\TraceVerifyPG\data stop
```

The role `traceverify` and the databases `traceverify` and `traceverify_test` already exist, and
`.env` is already filled in. The `postgres` superuser password is stored in
`D:\TraceVerifyPG\secrets\postgres_superuser.pw`.

**A fresh machine.** Install PostgreSQL, then run as the superuser:

```powershell
psql -U postgres -c "CREATE ROLE traceverify LOGIN PASSWORD 'choose-a-password';"
psql -U postgres -c "CREATE DATABASE traceverify OWNER traceverify;"
psql -U postgres -c "CREATE DATABASE traceverify_test OWNER traceverify;"
copy .env.example .env      # then put the same password into both URLs in .env
```

### 6.3 Backend

```powershell
cd D:\ISLAB\TRACEVERIFY\backend
py -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt

# schema + migrations + rule registry
.\.venv\Scripts\python -m scripts.init_db

# ingest the demo dataset (safe to repeat — duplicates are skipped)
.\.venv\Scripts\python -m scripts.ingest --evidence-dir ..\data\synthetic --redteam ..\data\raw\redteam_seed_subset.txt.gz

# start the API  →  http://127.0.0.1:8000   (Swagger: http://127.0.0.1:8000/docs)
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

To start over with an empty database: `.\.venv\Scripts\python -m scripts.init_db --reset`, then ingest again.

### 6.4 Frontend

```powershell
cd D:\ISLAB\TRACEVERIFY\frontend
npm install
npm run dev          # → http://127.0.0.1:5173  (proxies /api to :8000)
```

Open **http://127.0.0.1:5173**. Use `127.0.0.1` rather than `localhost`: on this machine another
application already listens on `[::1]:5173`. If 5173 is busy, Vite picks the next free port and
prints it.

Production build: `npm run build` (output in `frontend/dist`), preview with `npm run preview`
(→ http://127.0.0.1:4173).

> Low disk space on C: — if `npm install` fails with ENOSPC, point npm's cache and temp files
> at D: first: `$env:npm_config_cache="D:\TraceVerifyPG\npm-cache"; $env:TEMP="D:\TraceVerifyPG\tmp"; $env:TMP=$env:TEMP`.

---

## 7. Hosting (Render backend + Vercel frontend)

The repository is prepared for both platforms. Both deploy from a GitHub repository, so first
push this `TRACEVERIFY` folder to GitHub (`.env`, `.venv`, `node_modules` and `dist` are
git-ignored; the dataset files in `data/` are committed and needed by the backend).

| Piece | Platform | Config file |
|---|---|---|
| FastAPI API | Render web service (`traceverify-api`) | `render.yaml` |
| PostgreSQL | Render PostgreSQL (`traceverify-db`) | `render.yaml` |
| React UI | Vercel (root directory `frontend`) | `frontend/vercel.json` |

**1 · Render (API + database)**
1. In Render: **New → Blueprint**, pick the repository. Render reads `render.yaml` and creates
   the database and the web service. `DATABASE_URL` is wired in automatically. The backend
   converts Render's `postgres://` URL to the psycopg driver itself.
2. On every start, the service runs `init_db` (schema + rules), then `ingest` (the demo dataset;
   idempotent, so restarts insert nothing), then `uvicorn` on `$PORT`.
3. When it is live, note the URL (e.g. `https://traceverify-api.onrender.com`) and open
   `/api/health` and `/docs` to check it.

**2 · Vercel (frontend)**
1. In Vercel: **Add New → Project**, import the same repository.
2. Set **Root Directory** to `frontend`. Vite is detected and `vercel.json` sets the build.
3. Add the environment variable `VITE_API_BASE_URL` = your Render URL (no trailing slash
   needed). It is baked in at build time, so **redeploy** after changing it.
4. Deploy and note the site URL (e.g. `https://traceverify.vercel.app`).

**3 · Connect them (CORS)**
In Render → `traceverify-api` → Environment:
* set `CORS_ORIGINS` to the Vercel URL (comma-separate several);
* `CORS_ORIGIN_REGEX` already allows `https://traceverify*.vercel.app` preview deployments.
  If your Vercel project has a different name, edit the regex to match it.

Save; Render redeploys. Then open the Vercel URL.

**Free-tier behaviour to expect**
* A free Render web service sleeps after a period of inactivity, so the first request after
  that can take about a minute. The UI shows a "try again" message if it times out.
* Free Render PostgreSQL databases expire after a limited period (check Render's current
  free-tier terms). The service re-creates the schema and reloads the demo data on start, so
  a new database only needs its `DATABASE_URL` connected.

This setup was rehearsed locally: the Render start command against an empty database, a
`postgresql://` URL, `$PORT`, origin-restricted CORS, and the production frontend build with an
absolute API URL. The full browser test passed (51/51 at the time), and a second start inserted nothing.
It has not been run on Render or Vercel themselves.

---

## 8. Demo walkthrough

The numbers below are what the supplied dataset actually produces with the default weights
(they were observed during verification).

The UI has two screens: **New investigation** (setup) and the **Results** workspace.

1. **New investigation.** Select the first starting event, **U620@DOM1 · C17693 → C1003 ·
   Day 2, 17:54:45**. The chevron on each row reveals the event ID, raw LANL time and source line.
2. Keep the time window *5 min before · 30 min after* (the threshold is fixed at **0.60**). Scoring weights,
   evidence sources and engine bounds are under **Advanced settings**. Click **Run investigation**.
3. The **Results** page opens in the **Simple story** view: a short *Possible story — not confirmed*
   in plain words ("User 1", "Computer 1"), a reminder that correlation does not prove cause or
   intent, and every linked step with a plain reason. Click **Technical view** (or *Show the
   technical evidence for this step*) for the full evidence; the selection is kept. There the summary shows **8 related events**, 15 evidence links and
   14 of 38 events checked in the window.
   * **Evidence graph**: start → cmd.exe → DNS resolution → network flow (rules R02 → R03 → R04,
     longest chain 3 hops). Hover a node to trace its path to the start. Tick *Supporting links*
     to show secondary edges.
   * **Timeline**: chronological, or sorted *By score*. Selecting a row highlights the matching
     graph node (and the reverse).
   * **Evidence details** for the DNS resolution: Entities 0.55 (shared C1003 + same host
     continues), Time 0.99 (+4 s), Rule 1.00 (R03), final **0.816 ≥ 0.60**. The raw record and
     entity frequencies are under *Raw record and context*.
4. Tick **Show excluded events**. For example, the logon U748@DOM1 C17693 → C305 scores 0.568
   (R08 partial, 2 min later), and `powershell.exe` on C728 scores 0.217 (no rule).
5. Select a link in the graph: its *relationship strength* (0–1, not a probability) is labelled,
   the score breakdown opens, and its connected path is highlighted in the graph and timeline.
6. Re-run with a custom window of **0 s before / 20 s after**. Only **4 events** remain.
7. Go back with **← New investigation**, pick the event at **Day 3, 10:21:26**, deselect
   *Network flow* under Advanced settings and run at 0.80. No flows appear in the result.

---

## 9. Tests

```powershell
# backend: unit + PostgreSQL integration (uses TEST_DATABASE_URL, which is wiped)
cd backend;  .\.venv\Scripts\python -m pytest

# live audit against the running API (3 seeds at the fixed threshold + narrowed window,
# every returned event checked against PostgreSQL and the original source file line)
.\.venv\Scripts\python -m scripts.audit_api

# frontend unit tests and production build
cd ..\frontend;  npm test;  npm run build

# end-to-end UI test in Microsoft Edge (backend + `npm run dev` must be running)
node e2e/smoke.mjs http://127.0.0.1:5173 ..\e2e-shots
```

| Suite | What it covers |
|---|---|
| `test_ingestion.py` | file-type detection, `?`/null handling, malformed rows, `.gz`, normalization, machine-account exclusion, row counts of the supplied files |
| `test_scoring.py` | each score component, ordering, rule full/partial/none, failed logons, disabled rules, weighted sum, weight validation, "temporal proximity alone cannot pass" |
| `test_engine.py` | chain reconstruction, distractor exclusion, step parentage, no cycles or duplicate edges, threshold monotonicity, window bounds, source filter, node budget, determinism |
| `test_integration_api.py` | persistence, duplicate prevention, stored rows = source lines, indexes, every endpoint, fixed threshold (non-default rejected), window narrowing, reruns replace relationships, multiple seeds, 404/422 |
| `audit_api.py` | live HTTP audit with provenance checks |
| `utils.test.js` | time/score formatting, weight normalization, graph layout |
| `e2e/smoke.mjs` | 61 UI checks: "How it works" guide (show, dismiss, remembered, restore), 1366×768 setup fit, event search/scroll/tooltip, selection and raw details, Advanced settings, default evidence selection, chronological graph placement of pre-start events, graph fits its panel, untruncated node text, graph↔timeline sync across the view switch, sorting, excluded events, expandable score/raw details, re-run, three seeds, no console errors |

---

## 10. Known limitations

* **Synthetic evidence.** The auth/proc/dns/flow rows are synthetic and were constructed around
  the seeds, so results show that the method works. They do not measure detection performance on
  real traffic.
* **No complete attack-chain ground truth.** The LANL red-team labels identify compromise events,
  not full chains, so no precision or recall is claimed.
* **Hand-set parameters.** Weights, τ, rule scores and entity contributions are reasoned defaults.
  They are not learned or calibrated.
* **Bounded expansion.** `max_hops` and `max_nodes` cap the graph. If the node budget truncates
  results, changing the window can swap which events fit; the run's metrics report this
  (`truncated_by_node_budget`).
* **Hub entities.** A heavily shared host such as `C17693` links many events. Rules and the
  temporal score limit the damage, but there is no IDF-style down-weighting.
* **Single investigation context.** No user accounts or case management, and reruns overwrite the
  previous relationships for that investigation (the run count is kept).
* LANL timestamps are relative seconds; the UI shows them as `D<day> HH:MM:SS`.

## 11. Future scope

* Ingest real LANL windows around all ~700 red-team events and report candidate reduction and
  latency at scale.
* Entity-specificity (IDF) weighting and per-rule temporal windows.
* Analyst feedback (confirm / dismiss) stored per relationship, used to compare parameter settings.
* Exportable investigation reports (timeline + explanations) and rule editing from the UI.

---

## 12. Verification status (this machine)

Every item below was executed, not just implemented:

* PostgreSQL 17.6 running; schema applied; 924 rows ingested; re-ingestion inserted 0 duplicates.
* Backend pytest: all tests pass (unit + PostgreSQL integration, none skipped).
* `audit_api.py` against the live server: PASS (seeds 01, 05, 11 at the fixed 0.60 threshold + window narrowing).
* Frontend: vitest pass; `vite build` succeeds; Playwright E2E in Edge: PASS (61 checks, no console errors).
* Swagger UI at `/docs` returns 200.
