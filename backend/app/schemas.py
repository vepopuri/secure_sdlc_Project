from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Status = Literal["draft", "in_progress", "review", "final"]
Role = Literal["admin", "assessor", "viewer"]


class FrameworkSelection(BaseModel):
    key: str = Field(min_length=1, max_length=40)
    target: float | None = None


class EngagementCreate(BaseModel):
    client_name: str = Field(min_length=1, max_length=200)
    app_name: str = Field(min_length=1, max_length=200)
    business_unit: str | None = Field(default=None, max_length=200)
    scope: str = Field(default="", max_length=10000)
    status: Status = "draft"
    frameworks: list[FrameworkSelection] = Field(default_factory=list, max_length=20)

    @field_validator("client_name", "app_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v


class EngagementUpdate(BaseModel):
    client_name: str | None = Field(default=None, min_length=1, max_length=200)
    app_name: str | None = Field(default=None, min_length=1, max_length=200)
    business_unit: str | None = Field(default=None, max_length=200)
    scope: str | None = Field(default=None, max_length=10000)
    status: Status | None = None
    frameworks: list[FrameworkSelection] | None = Field(default=None, max_length=20)


class EngagementFrameworkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    framework_key: str
    target_level: float


class EngagementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    client_name: str
    app_name: str
    business_unit: str | None
    scope: str
    status: str
    created_at: datetime
    updated_at: datetime
    frameworks: list[EngagementFrameworkOut]
    document_count: int = 0
    interview_count: int = 0


class InterviewIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    interviewee_role: str = Field(default="", max_length=200)
    interview_date: date | None = None
    notes: str = Field(min_length=1, max_length=500_000)


class BlobIngest(BaseModel):
    url: str = Field(min_length=10, max_length=2000)
    filename: str = Field(min_length=1, max_length=300)


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    kind: str
    title: str
    filename: str | None
    content_type: str | None
    size_bytes: int
    interviewee_role: str | None
    interview_date: date | None
    redactions: int
    created_at: datetime
    chunk_count: int = 0


class RunCreate(BaseModel):
    framework_key: str = Field(min_length=1, max_length=40)


class OverrideIn(BaseModel):
    score: float
    reason: str = Field(min_length=3, max_length=4000)


class InvitationIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: Role = "assessor"


class RoleUpdate(BaseModel):
    role: Role
