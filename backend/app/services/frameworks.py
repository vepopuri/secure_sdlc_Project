"""Framework catalogue: load YAML data files, validate them and seed the database."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Capability, Framework

FRAMEWORKS_DIR = Path(__file__).resolve().parents[2] / "frameworks"
FRAMEWORK_ORDER = ["nist_csf", "samm", "nist_ssdf", "bsimm", "owasp_asvs", "slsa", "iso_27034"]


@dataclass
class Practice:
    id: str
    name: str
    description: str
    domain_id: str
    capabilities: dict[str, float]
    levels: dict[int, str]


@dataclass
class Domain:
    id: str
    name: str
    practices: list[Practice] = field(default_factory=list)


@dataclass
class FrameworkDef:
    key: str
    name: str
    short_name: str
    version: str
    description: str
    scale_min: float
    scale_max: float
    scale_step: float
    default_target: float
    labels: dict[int, str]
    domains: list[Domain]
    license_note: str
    source_url: str
    raw: dict[str, Any]

    @property
    def practices(self) -> list[Practice]:
        return [p for d in self.domains for p in d.practices]

    def practice(self, practice_id: str) -> Practice | None:
        return next((p for p in self.practices if p.id == practice_id), None)

    def domain(self, domain_id: str) -> Domain | None:
        return next((d for d in self.domains if d.id == domain_id), None)

    def clamp(self, score: float) -> float:
        return max(self.scale_min, min(self.scale_max, float(score)))

    def summary(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "name": self.name,
            "short_name": self.short_name,
            "version": self.version,
            "description": self.description,
            "license_note": self.license_note,
            "source_url": self.source_url,
            "scale": {
                "min": self.scale_min,
                "max": self.scale_max,
                "step": self.scale_step,
                "default_target": self.default_target,
                "labels": {str(k): v for k, v in self.labels.items()},
            },
            "domains": [
                {
                    "id": d.id,
                    "name": d.name,
                    "practices": [
                        {
                            "id": p.id,
                            "name": p.name,
                            "description": p.description,
                            "capabilities": p.capabilities,
                            "levels": {str(k): v for k, v in p.levels.items()},
                        }
                        for p in d.practices
                    ],
                }
                for d in self.domains
            ],
        }


class FrameworkDataError(ValueError):
    pass


def parse_framework(data: dict[str, Any], capability_keys: set[str]) -> FrameworkDef:
    try:
        scale = data["scale"]
        generic_levels = {int(k): str(v) for k, v in (data.get("level_criteria") or {}).items()}
        domains: list[Domain] = []
        seen: set[str] = set()
        for d in data["domains"]:
            domain = Domain(id=str(d["id"]), name=str(d["name"]))
            for p in d["practices"]:
                pid = str(p["id"])
                if pid in seen:
                    raise FrameworkDataError(f"{data['key']}: duplicate practice id {pid}")
                seen.add(pid)
                caps = {str(k): float(v) for k, v in (p.get("capabilities") or {}).items()}
                if not caps:
                    raise FrameworkDataError(f"{data['key']}: practice {pid} maps to no capability")
                unknown = set(caps) - capability_keys
                if unknown:
                    raise FrameworkDataError(f"{data['key']}: practice {pid} unknown capabilities {sorted(unknown)}")
                levels = {int(k): str(v) for k, v in (p.get("levels") or {}).items()} or generic_levels
                domain.practices.append(
                    Practice(
                        id=pid,
                        name=str(p["name"]),
                        description=str(p.get("description", "")),
                        domain_id=domain.id,
                        capabilities=caps,
                        levels=levels,
                    )
                )
            if not domain.practices:
                raise FrameworkDataError(f"{data['key']}: domain {domain.id} has no practices")
            domains.append(domain)
        fw = FrameworkDef(
            key=str(data["key"]),
            name=str(data["name"]),
            short_name=str(data.get("short_name") or data["name"]),
            version=str(data["version"]),
            description=str(data.get("description", "")).strip(),
            scale_min=float(scale["min"]),
            scale_max=float(scale["max"]),
            scale_step=float(scale.get("step", 1)),
            default_target=float(scale.get("default_target", scale["max"])),
            labels={int(k): str(v) for k, v in (scale.get("labels") or {}).items()},
            domains=domains,
            license_note=str(data.get("license_note", "")).strip(),
            source_url=str(data.get("source_url", "")),
            raw=data,
        )
    except (KeyError, TypeError) as exc:
        raise FrameworkDataError(f"Invalid framework data: {exc!r}") from exc
    if fw.scale_max <= fw.scale_min:
        raise FrameworkDataError(f"{fw.key}: scale max must exceed min")
    if not fw.scale_min <= fw.default_target <= fw.scale_max:
        raise FrameworkDataError(f"{fw.key}: default_target outside scale")
    return fw


def load_capabilities_file() -> list[dict[str, Any]]:
    data = yaml.safe_load((FRAMEWORKS_DIR / "capabilities.yaml").read_text(encoding="utf-8"))
    caps = data["capabilities"]
    keys = [c["key"] for c in caps]
    if len(keys) != len(set(keys)):
        raise FrameworkDataError("Duplicate capability keys")
    return caps


def load_framework_files() -> list[dict[str, Any]]:
    out = []
    for path in sorted(FRAMEWORKS_DIR.glob("*.yaml")):
        if path.name == "capabilities.yaml":
            continue
        out.append(yaml.safe_load(path.read_text(encoding="utf-8")))
    return out


def _checksum(data: Any) -> str:
    return hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()


def seed_frameworks(db: Session) -> dict[str, int]:
    """Idempotently upsert capabilities and frameworks from the YAML data files."""
    caps = load_capabilities_file()
    cap_keys = {c["key"] for c in caps}
    for c in caps:
        row = db.get(Capability, c["key"])
        if row is None:
            db.add(Capability(key=c["key"], name=c["name"], data=c))
        else:
            row.name, row.data = c["name"], c
    count = 0
    for data in load_framework_files():
        fw = parse_framework(data, cap_keys)  # validates
        checksum = _checksum(data)
        row = db.get(Framework, fw.key)
        if row is None:
            db.add(Framework(key=fw.key, name=fw.name, version=fw.version, data=data, checksum=checksum))
        elif row.checksum != checksum:
            row.name, row.version, row.data, row.checksum = fw.name, fw.version, data, checksum
        count += 1
    db.commit()
    _cache.clear()
    return {"capabilities": len(caps), "frameworks": count}


# --- runtime access -------------------------------------------------------------------

_cache: dict[str, Any] = {}


def _catalogue(db: Session) -> tuple[dict[str, FrameworkDef], dict[str, dict[str, Any]]]:
    rows = db.scalars(select(Framework)).all()
    if not rows:
        seed_frameworks(db)
        rows = db.scalars(select(Framework)).all()
    key = "|".join(sorted(f"{r.key}:{r.checksum}" for r in rows))
    if _cache.get("key") != key:
        caps = {c.key: c.data for c in db.scalars(select(Capability)).all()}
        fws = {r.key: parse_framework(r.data, set(caps)) for r in rows}
        _cache.update(key=key, frameworks=fws, capabilities=caps)
    return _cache["frameworks"], _cache["capabilities"]


def get_frameworks(db: Session) -> list[FrameworkDef]:
    fws, _ = _catalogue(db)
    order = {k: i for i, k in enumerate(FRAMEWORK_ORDER)}
    return sorted(fws.values(), key=lambda f: order.get(f.key, 99))


def get_framework(db: Session, key: str) -> FrameworkDef | None:
    fws, _ = _catalogue(db)
    return fws.get(key)


def get_capabilities(db: Session) -> dict[str, dict[str, Any]]:
    _, caps = _catalogue(db)
    return caps
