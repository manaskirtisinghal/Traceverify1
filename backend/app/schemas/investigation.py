"""Request/response schemas for the TRACEVERIFY API."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.config import settings
from app.services.scoring import WEIGHT_TOLERANCE

SourceType = Literal["auth", "proc", "dns", "flow"]

DISCLAIMER = ("Reconstructed paths are candidate evidence relationships produced by entity, temporal and "
              "rule-based correlation. They support analyst investigation and do not prove attacker intent "
              "or causality.")


# The correlation threshold is a fixed, validated system setting (config: DEFAULT_THRESHOLD). It is no longer
# adjustable per investigation; requests may omit it or repeat the fixed value, anything else is rejected.
FIXED_THRESHOLD: float = settings.default_threshold


def _fixed_threshold(v: float | None) -> float | None:
    if v is not None and abs(v - FIXED_THRESHOLD) > 1e-9:
        raise ValueError(f"threshold is a fixed system setting ({FIXED_THRESHOLD:.2f}) and cannot be changed "
                         "per investigation")
    return v


class Weights(BaseModel):
    entity: float = Field(settings.default_weight_entity, ge=0, le=1)
    temporal: float = Field(settings.default_weight_temporal, ge=0, le=1)
    rule: float = Field(settings.default_weight_rule, ge=0, le=1)

    @model_validator(mode="after")
    def _sum_to_one(self) -> "Weights":
        total = self.entity + self.temporal + self.rule
        if abs(total - 1.0) > WEIGHT_TOLERANCE:
            raise ValueError(f"weights must sum to 1.0 (got {total:.4f})")
        return self


class InvestigationParamsIn(BaseModel):
    window_before: int = Field(settings.default_window_before, ge=0, le=86_400,
                               description="seconds before the seed included in the investigation window")
    window_after: int = Field(settings.default_window_after, ge=0, le=86_400,
                              description="seconds after the seed included in the investigation window")
    threshold: float = Field(FIXED_THRESHOLD, ge=0, le=1,
                             description="minimum FinalScore to accept; fixed system setting, not adjustable")
    weights: Weights = Field(default_factory=Weights)
    temporal_decay: float = Field(settings.default_temporal_decay, gt=0, le=86_400,
                                  description="τ in TemporalScore = exp(-|Δt|/τ)")
    max_hops: int = Field(settings.default_max_hops, ge=1, le=6)
    max_nodes: int = Field(settings.default_max_nodes, ge=1, le=500)
    source_types: list[SourceType] = Field(default_factory=lambda: ["auth", "proc", "dns", "flow"], min_length=1)

    @field_validator("threshold")
    @classmethod
    def _threshold_is_fixed(cls, v: float | None) -> float | None:
        return _fixed_threshold(v)


class StartInvestigationIn(InvestigationParamsIn):
    seed_event_id: int = Field(..., ge=1)


class RerunInvestigationIn(BaseModel):
    """Any omitted field keeps the investigation's previous value; the threshold is always the fixed one."""
    window_before: int | None = Field(None, ge=0, le=86_400)
    window_after: int | None = Field(None, ge=0, le=86_400)
    threshold: float | None = Field(None, ge=0, le=1)
    weights: Weights | None = None
    temporal_decay: float | None = Field(None, gt=0, le=86_400)
    max_hops: int | None = Field(None, ge=1, le=6)
    max_nodes: int | None = Field(None, ge=1, le=500)
    source_types: list[SourceType] | None = Field(None, min_length=1)

    @field_validator("threshold")
    @classmethod
    def _threshold_is_fixed(cls, v: float | None) -> float | None:
        return _fixed_threshold(v)


class EventOut(BaseModel):
    id: int
    ts: int
    source_type: str
    event_type: str
    event_label: str
    summary: str
    user_name: str | None
    src_computer: str | None
    dst_computer: str | None
    attributes: dict
    dataset_label: str
    source_file: str
    line_no: int
    raw_line: str


class SeedOut(EventOut):
    nearby_evidence: int = Field(description="non-red-team events within ±30 min of the seed")


class EntityContextOut(BaseModel):
    entity_type: str
    value: str
    role: str
    correlatable: bool
    events_with_entity: int


class EventDetailOut(EventOut):
    entities: list[EntityContextOut]
    process_rarity: dict | None = Field(None, description="frequency context only; not used in scoring")


class RelationshipOut(BaseModel):
    id: int
    source_event_id: int
    target_event_id: int
    status: str
    is_primary: bool
    hop: int
    kind: Literal["direct", "multi-hop"]
    direction: str
    time_delta_seconds: int
    shared_entities: list[dict]
    entity_score: float
    temporal_score: float
    rule_score: float
    final_score: float
    matched_rule_code: str | None
    matched_rule_name: str | None
    rule_match: str | None
    explanation: str


class TimelineEventOut(EventOut):
    is_seed: bool
    status: Literal["seed", "accepted", "rejected"]
    hop: int
    score: float | None
    rank: int | None = Field(None, description="rank by FinalScore among accepted evidence (1 = highest)")
    parent_event_id: int | None
    relationship_id: int | None
    seconds_from_seed: int


class TopEvidenceOut(BaseModel):
    event: EventOut
    final_score: float
    hop: int
    matched_rule_code: str | None
    relationship_id: int


class PathOut(BaseModel):
    event_ids: list[int]
    weakest_link: float


class InvestigationOut(BaseModel):
    id: int
    status: str
    run_count: int
    created_at: datetime
    updated_at: datetime
    params: dict
    metrics: dict
    seed: EventOut
    top_evidence: list[TopEvidenceOut]
    paths: list[PathOut]
    disclaimer: str = DISCLAIMER


class InvestigationListItem(BaseModel):
    id: int
    seed_event_id: int
    seed_summary: str
    threshold: float
    accepted_events: int
    run_count: int
    updated_at: datetime


class RuleOut(BaseModel):
    code: str
    name: str
    from_types: list[str]
    to_types: list[str]
    condition_text: str
    full_score: float
    partial_score: float
    enabled: bool
