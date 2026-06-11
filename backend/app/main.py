import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select

from .database import Base, SessionLocal, engine
from .models import Campaign, Customer, Order
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
        return {
            "customers": customers,
            "orders": orders,
            "revenue": round(revenue, 2),
            "campaigns": campaigns_count,
        }
    finally:
        db.close()
