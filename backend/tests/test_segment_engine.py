"""Tests for the segment rule compiler — proves the DSL semantics the AI
relies on (especially NULL handling for customers with no orders)."""
from datetime import timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Customer, Order, utcnow
from app.schemas import RuleGroup
from app.services.segment_engine import audience_count, audience_customers


@pytest.fixture()
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()

    now = utcnow()

    def add_customer(name, city, orders):  # orders: [(days_ago, amount)]
        c = Customer(name=name, email=f"{name.lower()}@x.com", city=city)
        session.add(c)
        session.flush()
        for days_ago, amount in orders:
            session.add(Order(customer_id=c.id, amount=amount,
                              created_at=now - timedelta(days=days_ago)))
        return c

    add_customer("Vip", "Mumbai", [(5, 4000), (40, 3500), (90, 2500)])
    add_customer("Lapsed", "Delhi", [(120, 2000), (200, 1500)])
    add_customer("Fresh", "Mumbai", [(2, 600)])
    add_customer("Ghost", "Chennai", [])  # never ordered
    session.commit()
    yield session
    session.close()


def rules(*conds, op="and"):
    return RuleGroup.model_validate({"op": op, "conditions": list(conds)})


def names(db, r):
    return sorted(c.name for c in audience_customers(db, r))


def test_high_spender_segment(db):
    r = rules({"field": "total_spend", "cmp": ">=", "value": 5000})
    assert names(db, r) == ["Vip"]  # Vip=10000; Lapsed=3500 misses the bar


def test_lapsed_includes_never_ordered(db):
    # "Haven't ordered in 60 days" should include people who never ordered.
    r = rules({"field": "days_since_last_order", "cmp": ">", "value": 60})
    assert names(db, r) == ["Ghost", "Lapsed"]


def test_recent_buyers_excludes_never_ordered(db):
    r = rules({"field": "days_since_last_order", "cmp": "<", "value": 30})
    assert names(db, r) == ["Fresh", "Vip"]


def test_and_combination(db):
    r = rules(
        {"field": "total_spend", "cmp": ">=", "value": 3000},
        {"field": "days_since_last_order", "cmp": ">", "value": 60},
    )
    assert names(db, r) == ["Lapsed"]


def test_nested_or_group(db):
    r = rules(
        {"op": "or", "conditions": [
            {"field": "city", "cmp": "==", "value": "mumbai"},
            {"field": "order_count", "cmp": "==", "value": 0},
        ]},
    )
    assert names(db, r) == ["Fresh", "Ghost", "Vip"]


def test_city_in_list(db):
    r = rules({"field": "city", "cmp": "in", "value": ["Delhi", "Chennai"]})
    assert names(db, r) == ["Ghost", "Lapsed"]


def test_invalid_comparator_rejected(db):
    r = rules({"field": "city", "cmp": ">", "value": "Delhi"})
    with pytest.raises(ValueError):
        audience_count(db, r)
