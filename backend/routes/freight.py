# backend/routes/freight.py
from typing import Any

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db

# Single source of truth for the payload. This route used to carry its own copy
# of ROUTE_CONFIG and the query logic, and by 2026-09 it had frozen at the
# pre-August exporter: vn-ham flagged non-proxy, `date <` instead of `<=`, an
# 84-day history cap, and a chart hardcoded to FBX11 + FBX01. The page silently
# showed a different, older story depending on whether the backend was up.
from freight_payload import ROUTE_CONFIG, build_freight_payload  # noqa: F401  (re-exported)

router = APIRouter(prefix="/api/freight", tags=["freight"])


class FreightBasis(BaseModel):
    index: str
    multiplier: float


class FreightRouteResponse(BaseModel):
    id: str
    from_: str = Field(..., alias="from")
    to: str
    rate: int
    prev: int
    unit: str
    proxy: bool
    # Optional so an older cached payload still validates.
    prev_date: str | None = None
    basis: FreightBasis | None = None

    model_config = {"populate_by_name": True}


class FreightIndexResponse(BaseModel):
    code: str
    name: str
    rate: int
    date: str
    prev: int | None = None
    prev_date: str | None = None
    history: list[dict[str, Any]] = []


class FreightResponse(BaseModel):
    updated: str
    routes: list[FreightRouteResponse]
    # History rows have a fixed "date" plus per-route columns whose keys
    # vary (e.g. "vn-eu", "br-eu"). Keeping it as Any avoids over-specifying
    # — the frontend already types this as Record<string, number | string>.
    history: list[dict[str, Any]]
    # Every published FBX lane, unscaled. Defaulted so a client reading an
    # older response shape does not break.
    indices: list[FreightIndexResponse] = []


@router.get("", response_model=FreightResponse)
def get_freight(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=300"
    return build_freight_payload(db)
