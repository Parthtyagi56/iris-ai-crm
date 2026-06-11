"""Compile the segment rule DSL into a SQLAlchemy query.

Strategy: build a per-customer stats subquery (total_spend, order_count,
last_order_at) and LEFT JOIN it onto customers, so customers with zero
orders are still addressable (coalesced to 0 / NULL).

"days_since_*" comparisons are rewritten into datetime-cutoff comparisons at
compile time, which keeps the SQL portable across SQLite and Postgres.

Semantics decision worth stating out loud: for `days_since_last_order > N`,
customers who have NEVER ordered are INCLUDED (their recency is effectively
infinite). For `< N` they are excluded. That matches marketer intuition for
win-back style segments.
"""
from datetime import timedelta

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.orm import Session

from ..models import Customer, Order, utcnow
from ..schemas import Condition, RuleGroup


def _stats_subquery():
    return (
        select(
            Order.customer_id.label("customer_id"),
            func.sum(Order.amount).label("total_spend"),
            func.count(Order.id).label("order_count"),
            func.max(Order.created_at).label("last_order_at"),
        )
        .group_by(Order.customer_id)
        .subquery()
    )


def _numeric_clause(col, cmp: str, value):
    ops = {
        ">": col > value, ">=": col >= value,
        "<": col < value, "<=": col <= value,
        "==": col == value, "!=": col != value,
    }
    if cmp not in ops:
        raise ValueError(f"comparator {cmp!r} not valid for numeric field")
    return ops[cmp]


def _days_ago_clause(col, cmp: str, days):
    """Rewrite `days_since_x CMP days` into a cutoff comparison on the
    underlying datetime column. NULL (never happened) counts as infinitely
    long ago."""
    cutoff = utcnow() - timedelta(days=float(days))
    if cmp in (">", ">="):
        older = col < cutoff if cmp == ">" else col <= cutoff
        return or_(col.is_(None), older)
    if cmp in ("<", "<="):
        newer = col > cutoff if cmp == "<" else col >= cutoff
        return and_(col.is_not(None), newer)
    raise ValueError(f"comparator {cmp!r} not valid for days_since fields")


def _string_clause(col, cmp: str, value):
    if cmp == "==":
        return func.lower(col) == str(value).lower()
    if cmp == "!=":
        return func.lower(col) != str(value).lower()
    if cmp == "in":
        values = value if isinstance(value, list) else [value]
        return func.lower(col).in_([str(v).lower() for v in values])
    raise ValueError(f"comparator {cmp!r} not valid for string field")


def _compile_node(node, cols) -> object:
    if isinstance(node, RuleGroup):
        clauses = [_compile_node(c, cols) for c in node.conditions]
        return and_(*clauses) if node.op == "and" else or_(*clauses)

    cond: Condition = node
    if cond.field == "total_spend":
        return _numeric_clause(cols["total_spend"], cond.cmp, cond.value)
    if cond.field == "order_count":
        return _numeric_clause(cols["order_count"], cond.cmp, cond.value)
    if cond.field == "avg_order_value":
        return _numeric_clause(cols["avg_order_value"], cond.cmp, cond.value)
    if cond.field == "days_since_last_order":
        return _days_ago_clause(cols["last_order_at"], cond.cmp, cond.value)
    if cond.field == "days_since_joined":
        return _days_ago_clause(cols["created_at"], cond.cmp, cond.value)
    if cond.field == "city":
        return _string_clause(cols["city"], cond.cmp, cond.value)
    raise ValueError(f"unknown field {cond.field!r}")


def build_audience_query(rules: RuleGroup) -> Select:
    stats = _stats_subquery()
    total_spend = func.coalesce(stats.c.total_spend, 0.0)
    order_count = func.coalesce(stats.c.order_count, 0)
    avg_order_value = func.coalesce(
        stats.c.total_spend / func.nullif(stats.c.order_count, 0), 0.0)

    cols = {
        "total_spend": total_spend,
        "order_count": order_count,
        "avg_order_value": avg_order_value,
        "last_order_at": stats.c.last_order_at,
        "created_at": Customer.created_at,
        "city": Customer.city,
    }
    where = _compile_node(rules, cols)
    return (
        select(Customer)
        .outerjoin(stats, stats.c.customer_id == Customer.id)
        .where(where)
    )


def audience_count(db: Session, rules: RuleGroup) -> int:
    q = build_audience_query(rules).subquery()
    return db.execute(select(func.count()).select_from(q)).scalar_one()


def audience_customers(db: Session, rules: RuleGroup,
                       limit: int | None = None) -> list[Customer]:
    q = build_audience_query(rules)
    if limit:
        q = q.limit(limit)
    return list(db.execute(q).scalars())
