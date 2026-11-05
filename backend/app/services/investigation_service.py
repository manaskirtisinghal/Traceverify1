"""Investigation orchestration: run the correlation engine against PostgreSQL, persist the
evidence relationships and build timelines / paths from the stored records."""
from __future__ import annotations

import time

from sqlalchemy.orm import Session

from app.models import Event, Investigation, Relationship
from app.repositories.event_repository import DbCandidateProvider, EventRepository
from app.repositories.investigation_repository import InvestigationRepository
from app.repositories.rule_repository import RuleRepository
from app.rules.definitions import RULES_BY_CODE
from app.rules.event_types import EVENT_TYPE_LABELS
from app.schemas.investigation import (
    FIXED_THRESHOLD, EventOut, InvestigationOut, InvestigationParamsIn, PathOut, RelationshipOut, RerunInvestigationIn,
    TimelineEventOut, TopEvidenceOut,
)
from app.services.correlation_engine import InvestigationParams, correlate
from app.services.evidence import EvidenceEvent


class NotFoundError(LookupError):
    pass


def params_to_dict(p: InvestigationParamsIn) -> dict:
    return p.model_dump()


def engine_params(d: dict) -> InvestigationParams:
    w = d["weights"]
    return InvestigationParams(
        window_before=d["window_before"], window_after=d["window_after"], threshold=d["threshold"],
        w_entity=w["entity"], w_temporal=w["temporal"], w_rule=w["rule"], temporal_decay=d["temporal_decay"],
        max_hops=d["max_hops"], max_nodes=d["max_nodes"], source_types=tuple(d["source_types"]))


def event_out(e: Event) -> EventOut:
    ev = EvidenceEvent(e.id, e.ts, e.source_type, e.event_type, e.user_name, e.src_computer, e.dst_computer,
                       dict(e.attributes or {}))
    return EventOut(id=e.id, ts=e.ts, source_type=e.source_type, event_type=e.event_type,
                    event_label=EVENT_TYPE_LABELS.get(e.event_type, e.event_type), summary=ev.describe(),
                    user_name=e.user_name, src_computer=e.src_computer, dst_computer=e.dst_computer,
                    attributes=dict(e.attributes or {}), dataset_label=e.dataset_label,
                    source_file=e.source_file, line_no=e.line_no, raw_line=e.raw_line)


def relationship_out(r: Relationship) -> RelationshipOut:
    rule = RULES_BY_CODE.get(r.matched_rule_code) if r.matched_rule_code else None
    return RelationshipOut(
        id=r.id, source_event_id=r.source_event_id, target_event_id=r.target_event_id, status=r.status,
        is_primary=r.is_primary, hop=r.hop, kind="direct" if r.hop == 1 else "multi-hop", direction=r.direction,
        time_delta_seconds=r.time_delta_seconds, shared_entities=r.shared_entities,
        entity_score=float(r.entity_score), temporal_score=float(r.temporal_score),
        rule_score=float(r.rule_score), final_score=float(r.final_score), matched_rule_code=r.matched_rule_code,
        matched_rule_name=rule.name if rule else None, rule_match=r.rule_match, explanation=r.explanation)


class InvestigationService:
    def __init__(self, db: Session):
        self.db = db
        self.events = EventRepository(db)
        self.investigations = InvestigationRepository(db)
        self.rules = RuleRepository(db)

    # ----- commands ----------------------------------------------------------
    def start(self, seed_event_id: int, params: InvestigationParamsIn) -> Investigation:
        if self.events.get(seed_event_id) is None:
            raise NotFoundError(f"seed event {seed_event_id} not found")
        inv = self.investigations.create(seed_event_id, params_to_dict(params))
        return self._run(inv)

    def rerun(self, investigation_id: int, overrides: RerunInvestigationIn) -> Investigation:
        inv = self.get(investigation_id)
        merged = dict(inv.params)
        merged.update({k: v for k, v in overrides.model_dump(exclude_none=True).items()})
        merged["threshold"] = FIXED_THRESHOLD  # older runs may have stored another value; every run uses the fixed one
        inv.params = InvestigationParamsIn(**merged).model_dump()  # re-validate the merged parameters
        return self._run(inv)

    def _run(self, inv: Investigation) -> Investigation:
        seed_row = self.events.get(inv.seed_event_id)
        seed = self.events.to_evidence([seed_row])[0]
        started = time.perf_counter()
        result = correlate(seed, DbCandidateProvider(self.db), engine_params(inv.params),
                           self.rules.load_ruleset())
        latency_ms = round((time.perf_counter() - started) * 1000, 2)
        self.investigations.replace_relationships(inv, result.accepted + result.rejected)
        inv.metrics = {**result.metrics, "latency_ms": latency_ms}
        inv.status, inv.error = "completed", None
        inv.run_count += 1
        self.investigations.touch(inv)
        self.db.commit()
        self.db.refresh(inv)
        return inv

    # ----- queries -----------------------------------------------------------
    def get(self, investigation_id: int) -> Investigation:
        inv = self.investigations.get(investigation_id)
        if inv is None:
            raise NotFoundError(f"investigation {investigation_id} not found")
        return inv

    def relationships(self, investigation_id: int, status: str | None) -> list[RelationshipOut]:
        self.get(investigation_id)
        return [relationship_out(r) for r in self.investigations.relationships(investigation_id, status)]

    def timeline(self, investigation_id: int, include_rejected: bool = False) -> list[TimelineEventOut]:
        inv = self.get(investigation_id)
        rels = self.investigations.relationships(inv.id, None if include_rejected else "accepted")
        chosen = {r.target_event_id: r for r in rels if r.status == "rejected" or r.is_primary}
        accepted_ranked = sorted((r for r in chosen.values() if r.status == "accepted"),
                                 key=lambda r: (-float(r.final_score), r.target_event_id))
        rank = {r.target_event_id: i + 1 for i, r in enumerate(accepted_ranked)}
        rows = self.events.get_many([inv.seed_event_id, *chosen])
        seed = rows[inv.seed_event_id]
        items = [TimelineEventOut(**event_out(seed).model_dump(), is_seed=True, status="seed", hop=0, score=None,
                                  parent_event_id=None, relationship_id=None, seconds_from_seed=0)]
        for eid, r in chosen.items():
            items.append(TimelineEventOut(
                **event_out(rows[eid]).model_dump(), is_seed=False, status=r.status, hop=r.hop,
                score=float(r.final_score), rank=rank.get(eid), parent_event_id=r.source_event_id,
                relationship_id=r.id, seconds_from_seed=rows[eid].ts - seed.ts))
        items.sort(key=lambda t: (t.ts, t.id))
        return items

    def detail(self, inv: Investigation) -> InvestigationOut:
        rels = self.investigations.relationships(inv.id, "accepted")
        primary = {r.target_event_id: r for r in rels if r.is_primary}
        rows = self.events.get_many(list(primary))
        top = sorted(primary.values(), key=lambda r: (-float(r.final_score), r.target_event_id))[:5]
        return InvestigationOut(
            id=inv.id, status=inv.status, run_count=inv.run_count, created_at=inv.created_at,
            updated_at=inv.updated_at, params=inv.params, metrics=inv.metrics, seed=event_out(inv.seed_event),
            top_evidence=[TopEvidenceOut(event=event_out(rows[r.target_event_id]), final_score=float(r.final_score),
                                         hop=r.hop, matched_rule_code=r.matched_rule_code, relationship_id=r.id)
                          for r in top],
            paths=self._paths(inv.seed_event_id, primary))

    @staticmethod
    def _paths(seed_id: int, primary: dict[int, Relationship]) -> list[PathOut]:
        """Candidate incident paths: primary-parent chains from each leaf back to the seed."""
        parents = {t: r.source_event_id for t, r in primary.items()}
        has_child = set(parents.values())
        paths = []
        for leaf in (n for n in parents if n not in has_child):
            chain, scores, node = [leaf], [], leaf
            while node != seed_id and node in parents:
                scores.append(float(primary[node].final_score))
                node = parents[node]
                chain.append(node)
            paths.append(PathOut(event_ids=list(reversed(chain)), weakest_link=min(scores) if scores else 1.0))
        paths.sort(key=lambda p: (-len(p.event_ids), -p.weakest_link, p.event_ids))
        return paths[:25]
