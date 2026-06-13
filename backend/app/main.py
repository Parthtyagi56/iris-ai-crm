import logging
from datetime import timedelta
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select

from .database import Base, SessionLocal, engine
from .models import Campaign, Customer, Order, utcnow
from .routers import ai, campaigns, ingest, profile, receipts, segments
from .services.auth import ensure_default_user

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Xeno Mini CRM",
    description="AI-native mini CRM for reaching shoppers.",
)

# Frontend is served from a different origin (Vercel) in deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# For this scope, create-on-boot replaces migrations; with more time/scale
# this becomes Alembic.
Base.metadata.create_all(bind=engine)
ensure_default_user()

app.include_router(ingest.router)
app.include_router(segments.router)
app.include_router(campaigns.router)
app.include_router(receipts.router)
app.include_router(ai.router)
app.include_router(profile.router)

# Avatar images. Local disk is fine for a single-instance demo; at scale
# this is S3/GCS with the same avatar_url contract.
_uploads = Path(__file__).resolve().parent.parent / "uploads"
_uploads.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_uploads), name="uploads")


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/api/dashboard")
def dashboard():
    db = SessionLocal()
    try:
        customers = db.scalar(select(func.count()).select_from(Customer))
        orders = db.scalar(select(func.count()).select_from(Order))
        revenue = db.scalar(
            select(func.coalesce(func.sum(Order.amount), 0.0)))
        campaigns_count = db.scalar(
            select(func.count()).select_from(Campaign))

        # Last 12 ISO weeks of revenue, bucketed in Python so it works
        # identically on SQLite and Postgres (~5k rows; trivial at this
        # scale, becomes a date_trunc GROUP BY when volume demands it).
        cutoff = utcnow() - timedelta(weeks=12)
        recent = db.execute(
            select(Order.created_at, Order.amount)
            .where(Order.created_at >= cutoff)).all()
        buckets: dict = {}
        for created_at, amount in recent:
            monday = (created_at - timedelta(days=created_at.weekday())).date()
            buckets[monday] = buckets.get(monday, 0.0) + amount
        weekly_revenue = [
            {"week": str(week), "revenue": round(total, 2)}
            for week, total in sorted(buckets.items())
        ]

        # Customer health by recency of last order. Same thresholds the
        # frontend uses for per-row tiers; one outer-join GROUP BY at this
        # volume, a materialised rollup at scale.
        last_orders = db.execute(
            select(Customer.id, func.max(Order.created_at))
            .outerjoin(Order, Order.customer_id == Customer.id)
            .group_by(Customer.id)).all()
        now = utcnow()
        health = {"active": 0, "cooling": 0, "lapsed": 0}
        for _, last in last_orders:
            days = (now - last).days if last is not None else None
            if days is None or days > 120:
                health["lapsed"] += 1
            elif days > 45:
                health["cooling"] += 1
            else:
                health["active"] += 1

        # Category demand: volume, revenue, and how *sticky* each category is
        # (share of its buyers who came back for it). Repeat rate is the
        # double-down signal; low-volume categories are the focus list.
        cat_rows = db.execute(
            select(Order.category, Order.customer_id, func.count(),
                   func.sum(Order.amount))
            .where(Order.category != "")
            .group_by(Order.category, Order.customer_id)).all()
        cats: dict = {}
        for category, _cust, n, amt in cat_rows:
            c = cats.setdefault(category, {
                "orders": 0, "revenue": 0.0, "buyers": 0, "repeat_buyers": 0})
            c["orders"] += n
            c["revenue"] += amt
            c["buyers"] += 1
            if n >= 2:
                c["repeat_buyers"] += 1
        # Best campaign per category, by attributed revenue. Closed-loop:
        # a converted order carries both its campaign and the buyer's top
        # category, so we can say which message drove each category's sales.
        attr_rows = db.execute(
            select(Order.category, Campaign.name, func.sum(Order.amount))
            .join(Campaign, Campaign.id == Order.campaign_id)
            .where(Order.category != "")
            .group_by(Order.category, Campaign.id, Campaign.name)).all()
        best_by_cat: dict = {}
        for category, camp_name, rev in attr_rows:
            cur = best_by_cat.get(category)
            if cur is None or rev > cur["revenue"]:
                best_by_cat[category] = {"name": camp_name,
                                         "revenue": round(rev, 2)}

        categories = sorted(
            ({"name": k,
              "orders": v["orders"],
              "revenue": round(v["revenue"], 2),
              "buyers": v["buyers"],
              "repeat_rate": round(v["repeat_buyers"] / v["buyers"], 4)
              if v["buyers"] else 0,
              "best_campaign": best_by_cat.get(k)}
             for k, v in cats.items()),
            key=lambda c: c["revenue"], reverse=True)

        return {
            "customers": customers,
            "orders": orders,
            "revenue": round(revenue, 2),
            "campaigns": campaigns_count,
            "weekly_revenue": weekly_revenue,
            "customer_health": health,
            "categories": categories,
        }
    finally:
        db.close()
