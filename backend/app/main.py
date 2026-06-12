import logging
from datetime import timedelta

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select

from .database import Base, SessionLocal, engine
from .models import Campaign, Customer, Order, utcnow
from .routers import ai, campaigns, ingest, receipts, segments

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

app.include_router(ingest.router)
app.include_router(segments.router)
app.include_router(campaigns.router)
app.include_router(receipts.router)
app.include_router(ai.router)


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

        return {
            "customers": customers,
            "orders": orders,
            "revenue": round(revenue, 2),
            "campaigns": campaigns_count,
            "weekly_revenue": weekly_revenue,
            "customer_health": health,
        }
    finally:
        db.close()
