"""PostgreSQL-backed integration and API tests (uses TEST_DATABASE_URL)."""
import gzip

from sqlalchemy import func, select, text

from app.models import Event, EventEntity, Relationship
from app.schemas.investigation import FIXED_THRESHOLD
from app.services.ingestion.ingest_service import REDTEAM_LABEL, SYNTHETIC_LABEL, ingest_file
from tests.conftest import DATA_DIR


# ----- persistence ------------------------------------------------------------
def test_ingestion_persists_all_rows(ingested, db_session):
    assert sum(r.inserted for r in ingested) == 12 + 244 + 260 + 192 + 216
    counts = dict(db_session.execute(select(Event.source_type, func.count()).group_by(Event.source_type)).all())
    assert counts == {"redteam": 12, "auth": 244, "proc": 260, "dns": 192, "flow": 216}
    labels = dict(db_session.execute(select(Event.source_type, Event.dataset_label).distinct()).all())
    assert labels["auth"] == SYNTHETIC_LABEL and labels["redteam"] == REDTEAM_LABEL
    assert db_session.scalar(select(func.count()).select_from(EventEntity)) > 0


def test_reingestion_inserts_no_duplicates(pg_engine, ingested, db_session):
    before = db_session.scalar(select(func.count()).select_from(Event))
    again = ingest_file(pg_engine, DATA_DIR / "synthetic" / "auth.txt.gz", SYNTHETIC_LABEL)
    assert again.inserted == 0 and again.duplicates == 244
    assert db_session.scalar(select(func.count()).select_from(Event)) == before


def test_stored_rows_match_source_files(db_session):
    with gzip.open(DATA_DIR / "synthetic" / "flows.txt.gz", "rt") as fh:
        first = fh.readline().strip()
    row = db_session.scalar(select(Event).where(Event.source_file == "flows.txt.gz", Event.line_no == 1))
    assert row.raw_line == first
    parts = first.split(",")
    assert row.ts == int(parts[0]) and row.src_computer == parts[2] and row.dst_computer == parts[4]


def test_indexes_exist(db_session):
    names = {r[0] for r in db_session.execute(text("SELECT indexname FROM pg_indexes WHERE schemaname='public'"))}
    assert {"ix_events_ts", "ix_events_source_ts", "ix_event_entities_entity"} <= names


# ----- API --------------------------------------------------------------------
def _start(client, seed_id, **params):
    r = client.post("/api/investigations/start", json={"seed_event_id": seed_id, **params})
    assert r.status_code == 201, r.text
    return r.json()


def _seeds(client):
    r = client.get("/api/investigations/seeds")
    assert r.status_code == 200
    return r.json()


def test_seeds_endpoint(client):
    seeds = _seeds(client)
    assert len(seeds) == 12
    assert all(s["source_type"] == "redteam" for s in seeds)
    assert seeds[0]["ts"] == 150885 and seeds[0]["user_name"] == "U620@DOM1"


def test_start_investigation_returns_db_evidence(client, db_session):
    seed = _seeds(client)[0]
    inv = _start(client, seed["id"])
    assert inv["seed"]["id"] == seed["id"] and inv["metrics"]["accepted_events"] > 0
    assert inv["top_evidence"] and inv["paths"] and "causality" in inv["disclaimer"]

    timeline = client.get(f"/api/investigations/{inv['id']}/events").json()
    assert timeline[0]["ts"] <= timeline[-1]["ts"]
    assert [t["ts"] for t in timeline] == sorted(t["ts"] for t in timeline)
    assert sum(t["is_seed"] for t in timeline) == 1
    for item in timeline:                                    # every item is a real stored row
        row = db_session.get(Event, item["id"])
        assert row is not None and row.raw_line == item["raw_line"]

    rels = client.get(f"/api/investigations/{inv['id']}/relationships").json()
    assert rels and all(r["status"] == "accepted" for r in rels)
    assert [r["final_score"] for r in rels] == sorted((r["final_score"] for r in rels), reverse=True)
    for r in rels:
        assert r["final_score"] >= inv["params"]["threshold"]
        assert r["kind"] == ("direct" if r["hop"] == 1 else "multi-hop")
        assert r["explanation"] and isinstance(r["shared_entities"], list)
    rules = {r["matched_rule_code"] for r in rels}
    assert {"R02", "R03", "R04"} <= rules                    # logon→process, process→DNS, DNS→flow


def test_chain_is_reconstructed_for_first_seed(client):
    seed = _seeds(client)[0]
    inv = _start(client, seed["id"])
    timeline = {t["id"]: t for t in client.get(f"/api/investigations/{inv['id']}/events").json()}
    types = {t["event_type"] for t in timeline.values()}
    assert {"AUTH_LOGON", "PROC_START", "DNS_RESOLVE", "NET_FLOW"} <= types
    flows = [t for t in timeline.values() if t["event_type"] == "NET_FLOW"]
    assert all(timeline[f["parent_event_id"]]["event_type"] == "DNS_RESOLVE" for f in flows)


def test_threshold_is_a_fixed_system_setting(client):
    seed = _seeds(client)[0]
    inv = _start(client, seed["id"])
    assert inv["params"]["threshold"] == FIXED_THRESHOLD
    assert _start(client, seed["id"], threshold=FIXED_THRESHOLD)["params"]["threshold"] == FIXED_THRESHOLD
    for thr in (0.45, 0.8):
        assert client.post("/api/investigations/start",
                           json={"seed_event_id": seed["id"], "threshold": thr}).status_code == 422
        assert client.post(f"/api/investigations/{inv['id']}/rerun", json={"threshold": thr}).status_code == 422
    r = client.post(f"/api/investigations/{inv['id']}/rerun", json={"window_after": 600})
    assert r.status_code == 200 and r.json()["params"]["threshold"] == FIXED_THRESHOLD


def test_rerun_window_narrowing(client):
    seed = _seeds(client)[0]
    inv = _start(client, seed["id"], window_after=1800)
    wide = client.get(f"/api/investigations/{inv['id']}/events").json()
    r = client.post(f"/api/investigations/{inv['id']}/rerun", json={"window_before": 0, "window_after": 20})
    assert r.status_code == 200 and r.json()["run_count"] == 2
    narrow = client.get(f"/api/investigations/{inv['id']}/events").json()
    for t in narrow:
        assert seed["ts"] <= t["ts"] <= seed["ts"] + 20
    assert len(narrow) < len(wide)


def test_rerun_replaces_relationships(client, db_session):
    seed = _seeds(client)[1]
    inv = _start(client, seed["id"])
    client.post(f"/api/investigations/{inv['id']}/rerun", json={"window_before": 0, "window_after": 60})
    db_session.expire_all()
    stored = db_session.scalars(select(Relationship).where(Relationship.investigation_id == inv["id"])).all()
    assert all(abs(r.time_delta_seconds) <= 60 for r in stored if r.hop == 1)
    assert all(float(r.final_score) >= FIXED_THRESHOLD for r in stored if r.status == "accepted")


def test_multiple_seeds_produce_distinct_results(client):
    seeds = _seeds(client)
    results = {}
    for s in (seeds[0], seeds[4], seeds[10]):
        inv = _start(client, s["id"])
        results[s["id"]] = {t["id"] for t in client.get(f"/api/investigations/{inv['id']}/events").json()}
        assert len(results[s["id"]]) > 1
    a, b, c = results.values()
    assert a != b and b != c


def test_include_rejected_and_status_filters(client):
    seed = _seeds(client)[0]
    inv = _start(client, seed["id"])
    with_rej = client.get(f"/api/investigations/{inv['id']}/events?include_rejected=true").json()
    assert any(t["status"] == "rejected" for t in with_rej)
    rejected = client.get(f"/api/investigations/{inv['id']}/relationships?status=rejected").json()
    assert rejected and all(r["final_score"] < inv["params"]["threshold"] for r in rejected)


def test_event_detail(client):
    seed = _seeds(client)[0]
    r = client.get(f"/api/events/{seed['id']}")
    assert r.status_code == 200
    body = r.json()
    assert {e["value"] for e in body["entities"]} >= {"U620@DOM1", "C17693", "C1003"}


def test_validation_and_not_found(client):
    seed = _seeds(client)[0]
    bad = client.post("/api/investigations/start",
                      json={"seed_event_id": seed["id"], "weights": {"entity": 0.5, "temporal": 0.5, "rule": 0.5}})
    assert bad.status_code == 422
    assert client.post("/api/investigations/start", json={"seed_event_id": seed["id"], "threshold": 2}).status_code == 422
    assert client.post("/api/investigations/start", json={"seed_event_id": seed["id"],
                                                          "source_types": ["redteam"]}).status_code == 422
    assert client.post("/api/investigations/start", json={"seed_event_id": 99999999}).status_code == 404
    assert client.get("/api/investigations/99999999").status_code == 404
    assert client.get("/api/events/99999999").status_code == 404
    assert client.post("/api/investigations/99999999/rerun", json={}).status_code == 404


def test_rules_dataset_health(client):
    assert len(client.get("/api/rules").json()) == 12
    assert {d["source_type"] for d in client.get("/api/dataset").json()} == {"auth", "proc", "dns", "flow", "redteam"}
    assert client.get("/api/health").json()["status"] == "ok"
    assert client.get("/openapi.json").status_code == 200
