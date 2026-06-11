from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Segment
from ..schemas import SegmentCreate, SegmentPreviewRequest
from ..services.segment_engine import audience_count, audience_customers

router = APIRouter(prefix="/api/segments", tags=["segments"])


@router.post("/preview")
def preview(body: SegmentPreviewRequest, db: Session = Depends(get_db)):
    """Live audience preview — the thing that makes AI-generated rules
    trustworthy: the marketer always sees who they're about to reach."""
    try:
        count = audience_count(db, body.rules)
        sample = audience_customers(db, body.rules, limit=5)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return {
        "count": count,
        "sample": [
            {"id": c.id, "name": c.name, "email": c.email, "city": c.city}
            for c in sample
        ],
    }


@router.post("", status_code=201)
def create_segment(body: SegmentCreate, db: Session = Depends(get_db)):
    try:
        count = audience_count(db, body.rules)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    seg = Segment(
        name=body.name,
        description=body.description,
        rules=body.rules.model_dump(),
        created_by=body.created_by,
    )
    db.add(seg)
    db.commit()
    return {"id": seg.id, "audience_count": count}


@router.get("")
def list_segments(db: Session = Depends(get_db)):
    segments = db.execute(
        select(Segment).order_by(Segment.created_at.desc())).scalars().all()
    return {
        "segments": [
            {
                "id": s.id, "name": s.name, "description": s.description,
                "rules": s.rules, "created_by": s.created_by,
                "created_at": s.created_at,
            }
            for s in segments
        ]
    }
