"""Ingestion + browsing: customers and orders.

Bulk endpoints exist because real brands load data in batches; the seed
script and any CSV import would use these same code paths.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Customer, Order
from ..schemas import CustomerIn, OrderIn

router = APIRouter(prefix="/api", tags=["ingest"])


@router.post("/customers", status_code=201)
def create_customer(body: CustomerIn, db: Session = Depends(get_db)):
    if db.scalar(select(Customer).where(Customer.email == body.email)):
        raise HTTPException(409, "customer with this email already exists")
    customer = Customer(**body.model_dump())
    db.add(customer)
    db.commit()
    return {"id": customer.id}


@router.post("/customers/bulk", status_code=201)
def bulk_customers(body: list[CustomerIn], db: Session = Depends(get_db)):
    existing = {
        e for (e,) in db.execute(
            select(Customer.email).where(
                Customer.email.in_([c.email for c in body])))
    }
    created = [Customer(**c.model_dump()) for c in body if c.email not in existing]
    db.add_all(created)
    db.commit()
    return {"created": len(created), "skipped_existing": len(body) - len(created)}


@router.get("/customers")
def list_customers(q: str = "", limit: int = 25, offset: int = 0,
                   sort: str = "recent", db: Session = Depends(get_db)):
    stmt = select(Customer)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(func.lower(Customer.name).like(like)
                          | func.lower(Customer.email).like(like))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))

    if sort == "top_spend":
        # Highest lifetime spend first — powers the high-value spotlight.
        spend_sq = (
            select(Order.customer_id,
                   func.sum(Order.amount).label("spend"))
            .group_by(Order.customer_id).subquery())
        stmt = (stmt.join(spend_sq, spend_sq.c.customer_id == Customer.id)
                .order_by(spend_sq.c.spend.desc()))
    else:
        stmt = stmt.order_by(Customer.created_at.desc())

    rows = db.execute(stmt.limit(limit).offset(offset)).scalars().all()
    return {
        "total": total,
        "customers": [_customer_summary(db, c) for c in rows],
    }


def _customer_summary(db: Session, c: Customer) -> dict:
    spend, count, last = db.execute(
        select(func.coalesce(func.sum(Order.amount), 0.0),
               func.count(Order.id),
               func.max(Order.created_at))
        .where(Order.customer_id == c.id)
    ).one()
    # Most-bought category ("what do they shop for") for the page of rows
    # shown; a per-customer rollup column at scale.
    top_category = db.execute(
        select(Order.category, func.count())
        .where(Order.customer_id == c.id, Order.category != "")
        .group_by(Order.category)
        .order_by(func.count().desc())
        .limit(1)
    ).first()
    return {
        "id": c.id, "name": c.name, "email": c.email, "phone": c.phone,
        "city": c.city, "created_at": c.created_at,
        "total_spend": round(spend, 2), "order_count": count,
        "last_order_at": last,
        "top_category": top_category[0] if top_category else None,
    }


@router.post("/orders", status_code=201)
def create_order(body: OrderIn, db: Session = Depends(get_db)):
    return _insert_orders([body], db)


@router.post("/orders/bulk", status_code=201)
def bulk_orders(body: list[OrderIn], db: Session = Depends(get_db)):
    return _insert_orders(body, db)


def _insert_orders(items: list[OrderIn], db: Session) -> dict:
    emails = {o.customer_email for o in items}
    id_by_email = dict(db.execute(
        select(Customer.email, Customer.id).where(Customer.email.in_(emails))))
    created, unknown = 0, 0
    for o in items:
        cid = id_by_email.get(o.customer_email)
        if not cid:
            unknown += 1
            continue
        order = Order(customer_id=cid, amount=o.amount, category=o.category)
        if o.created_at:
            order.created_at = o.created_at.replace(tzinfo=None)
        db.add(order)
        created += 1
    db.commit()
    return {"created": created, "unknown_customer": unknown}
