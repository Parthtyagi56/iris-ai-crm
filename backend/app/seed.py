"""Seed realistic data for Iris, a fictional D2C fashion brand.

Deliberately shaped (not uniform-random) so segments are meaningful:
  ~15% VIPs        - frequent, high-value, recent
  ~40% regulars    - moderate frequency and recency
  ~25% lapsed      - bought before, nothing in 60-300 days  <- win-back demo
  ~20% one-timers  - single early order, mostly gone quiet

Deterministic (seeded) so the demo numbers are reproducible.
Run:  python -m app.seed
"""
import random
import sys
from datetime import timedelta

from faker import Faker
from sqlalchemy import func, select

from .database import Base, SessionLocal, engine
from .models import (Campaign, Customer, Message, MessageEvent, Order, Segment,
                     uid, utcnow)

fake = Faker("en_IN")
Faker.seed(42)
random.seed(42)

CITIES = ["Mumbai", "Delhi", "Bengaluru", "Chennai", "Hyderabad",
          "Pune", "Kolkata", "Jaipur"]

# Each customer gets a preferred category; ~70% of their orders land there.
# That correlation is what makes "most repeated category" analytics worth
# looking at instead of uniform noise.
CATEGORIES = ["Dresses", "Ethnic wear", "Tops", "Footwear",
              "Accessories", "Beauty"]
CATEGORY_WEIGHTS = [0.26, 0.22, 0.18, 0.14, 0.12, 0.08]

PROFILES = [
    # (share, orders_range, amount_range, days_since_last_order_range)
    ("vip", 0.15, (6, 15), (1500, 9000), (1, 30)),
    ("regular", 0.40, (2, 6), (800, 4000), (10, 90)),
    ("lapsed", 0.25, (2, 5), (800, 5000), (60, 300)),
    ("one_timer", 0.20, (1, 1), (500, 2500), (90, 400)),
]

N_CUSTOMERS = 1200


# ---------------------------------------------------------------- campaigns
#
# Realistic *conditional* funnel rates per channel: each is P(stage | prior
# stage). Multiplying down the chain makes the funnel narrow the way real
# campaigns do (delivered > opened > clicked > converted), so the demo never
# looks "stuck at 1 person" and the attributed revenue is genuine data tied
# to real orders.
CHANNEL_FUNNEL = {
    "whatsapp": dict(deliver=0.96, open=0.80, read=0.96, click=0.46, convert=0.26),
    "rcs":      dict(deliver=0.94, open=0.74, read=0.93, click=0.40, convert=0.22),
    "email":    dict(deliver=0.93, open=0.56, read=0.88, click=0.34, convert=0.20),
    "sms":      dict(deliver=0.97, open=0.92, read=0.98, click=0.34, convert=0.18),
}
RANK = {"sent": 1, "delivered": 2, "opened": 3, "read": 4,
        "clicked": 5, "converted": 6, "failed": 7}
FAIL_REASONS = ["invalid_number", "handset_unreachable",
                "spam_blocked", "opted_out"]

# Audience definitions (rule DSL). Reused if a same-named segment exists.
SEGMENT_PLAN = [
    ("VIP spenders", "Top customers by lifetime spend",
     {"op": "and", "conditions": [
         {"field": "total_spend", "cmp": ">=", "value": 25000}]}),
    ("Loyal repeat buyers", "Bought four or more times",
     {"op": "and", "conditions": [
         {"field": "order_count", "cmp": ">=", "value": 4}]}),
    ("Lapsed high spenders", "Spent big but quiet for 60+ days",
     {"op": "and", "conditions": [
         {"field": "total_spend", "cmp": ">=", "value": 15000},
         {"field": "days_since_last_order", "cmp": ">=", "value": 60}]}),
    ("Big-city shoppers", "Metro customers",
     {"op": "and", "conditions": [
         {"field": "city", "cmp": "in",
          "value": ["Mumbai", "Delhi", "Bengaluru"]}]}),
    ("New customers", "Joined in the last 45 days",
     {"op": "and", "conditions": [
         {"field": "days_since_joined", "cmp": "<=", "value": 45}]}),
    ("Win-back lapsed", "No order in 90+ days",
     {"op": "and", "conditions": [
         {"field": "days_since_last_order", "cmp": ">=", "value": 90}]}),
]

# (name, channel, segment, template, target audience, days ago it ran)
CAMPAIGN_PLAN = [
    ("Diwali Festive Blowout", "whatsapp", "VIP spenders",
     "Hi {{first_name}}, Diwali’s here 🪔 Flat 30% off your favourites!", 380, 240),
    ("Republic Day Sale", "sms", "Loyal repeat buyers",
     "{{first_name}}, Republic Day deals are live — up to 40% off!", 340, 140),
    ("Win them back", "email", "Lapsed high spenders",
     "We miss you {{first_name}}! Here’s ₹500 off to come back.", 260, 96),
    ("Monsoon Footwear Edit", "rcs", "Big-city shoppers",
     "New monsoon footwear for {{city}} — splash-proof picks 👟", 240, 72),
    ("Summer Ethnic Launch", "whatsapp", "Loyal repeat buyers",
     "{{first_name}}, our summer ethnic collection just dropped 🌸", 300, 55),
    ("VIP Early Access", "whatsapp", "VIP spenders",
     "Exclusive early access for you {{first_name}} — shop before everyone.", 190, 41),
    ("Weekend Flash Sale", "sms", "New customers",
     "48-hour flash sale {{first_name}} — extra 25% off everything!", 230, 27),
    ("Beauty Restock Alert", "email", "Loyal repeat buyers",
     "{{first_name}}, your beauty favourites are back in stock 💄", 280, 16),
    ("Wardrobe Refresh", "rcs", "Win-back lapsed",
     "Time for a refresh {{first_name}}? New arrivals picked for you.", 210, 8),
]


def _render(template: str, name: str, city: str) -> str:
    first = name.split()[0] if name else "there"
    return (template.replace("{{first_name}}", first)
            .replace("{{name}}", name or "there")
            .replace("{{city}}", city or "your city"))


def _simulate_funnel(campaign, recipients, when, top_cat):
    """Walk a believable funnel for each recipient. Returns (messages,
    events, attributed_orders). Sets the status projection directly *and*
    writes the matching event ledger so the source-of-truth invariant holds."""
    f = CHANNEL_FUNNEL[campaign.channel]
    messages, events, orders = [], [], []
    for cust in recipients:
        mid = uid()
        if random.random() > f["deliver"]:
            stages = ["sent", "failed"]
            status, reason = "failed", random.choice(FAIL_REASONS)
        else:
            reason = None
            stages = ["sent", "delivered"]
            if random.random() < f["open"]:
                stages.append("opened")
                if random.random() < f["read"]:
                    stages.append("read")
                if random.random() < f["click"]:
                    stages.append("clicked")
                    if random.random() < f["convert"]:
                        stages.append("converted")
            status = stages[-1]
        messages.append(Message(
            id=mid, campaign_id=campaign.id, customer_id=cust.id,
            channel=campaign.channel,
            content=_render(campaign.message_template, cust.name, cust.city),
            status=status, status_rank=RANK[status], failure_reason=reason,
            created_at=when, updated_at=when + timedelta(minutes=len(stages) * 6)))
        for i, st in enumerate(stages):
            events.append(MessageEvent(
                event_id=uid(), message_id=mid, event_type=st,
                occurred_at=when + timedelta(minutes=i * 6), meta={}))
        if status == "converted":
            orders.append(Order(
                customer_id=cust.id,
                amount=round(random.uniform(1400, 8500), 2),
                category=top_cat.get(cust.id, ""),
                campaign_id=campaign.id,
                created_at=when + timedelta(hours=random.randint(1, 72))))
    return messages, events, orders


def seed_campaigns(db):
    """Create a spread of realistic past campaigns with full funnels and
    attributed revenue. Idempotent: reuses same-named segments, skips
    same-named campaigns, and backfills any campaign left empty."""
    now = utcnow()
    customers = db.query(Customer).all()
    if not customers:
        print("No customers; seed customers first.")
        return
    # Each customer's most-bought category (for attributed-order categories).
    top_cat: dict = {}
    rows = db.execute(
        select(Order.customer_id, Order.category, func.count())
        .where(Order.category != "")
        .group_by(Order.customer_id, Order.category)).all()
    best: dict = {}
    for cid, cat, n in rows:
        if cid not in best or n > best[cid][1]:
            best[cid] = (cat, n)
    top_cat = {cid: cat for cid, (cat, _n) in best.items()}

    seg_by_name = {s.name.lower(): s for s in db.query(Segment).all()}
    for name, desc, rules in SEGMENT_PLAN:
        if name.lower() not in seg_by_name:
            seg = Segment(name=name, description=desc, rules=rules,
                          created_by="user", created_at=now - timedelta(days=300))
            db.add(seg)
            db.flush()
            seg_by_name[name.lower()] = seg
    db.commit()

    existing = {c.name.lower() for c in db.query(Campaign).all()}
    created = 0
    for name, channel, seg_name, template, target, days_ago in CAMPAIGN_PLAN:
        if name.lower() in existing:
            continue
        seg = seg_by_name.get(seg_name.lower())
        if seg is None:
            continue
        when = now - timedelta(days=days_ago)
        recipients = random.sample(customers, min(target, len(customers)))
        campaign = Campaign(
            name=name, segment_id=seg.id, rules_snapshot=seg.rules,
            channel=channel, message_template=template, status="dispatched",
            audience_size=len(recipients),
            created_at=when - timedelta(hours=2), started_at=when)
        db.add(campaign)
        db.flush()
        msgs, evts, ords = _simulate_funnel(campaign, recipients, when, top_cat)
        db.add_all(msgs)
        db.add_all(evts)
        db.add_all(ords)
        db.commit()
        created += 1
        print(f"  campaign '{name}' -> {len(msgs)} msgs, {len(ords)} conversions")

    # Backfill any campaign that was created but never got a real send
    # (e.g. one launched by hand during testing and left stuck).
    for campaign in db.query(Campaign).all():
        n = db.scalar(select(func.count()).select_from(Message)
                      .where(Message.campaign_id == campaign.id))
        if n >= 15:
            continue
        when = campaign.started_at or (now - timedelta(days=random.randint(10, 120)))
        target = max(campaign.audience_size, random.randint(160, 320))
        recipients = random.sample(customers, min(target, len(customers)))
        campaign.status = "dispatched"
        campaign.audience_size = len(recipients)
        if not campaign.started_at:
            campaign.started_at = when
        msgs, evts, ords = _simulate_funnel(campaign, recipients, when, top_cat)
        db.add_all(msgs)
        db.add_all(evts)
        db.add_all(ords)
        db.commit()
        created += 1
        print(f"  backfilled '{campaign.name}' -> {len(msgs)} msgs")

    print(f"Seeded/backfilled {created} campaigns.")


def _top_categories(db):
    rows = db.execute(
        select(Order.customer_id, Order.category, func.count())
        .where(Order.category != "")
        .group_by(Order.customer_id, Order.category)).all()
    best: dict = {}
    for cid, cat, n in rows:
        if cid not in best or n > best[cid][1]:
            best[cid] = (cat, n)
    return {cid: cat for cid, (cat, _n) in best.items()}


def repair_campaigns(db):
    """Advance the funnels of campaigns whose sends stalled (messages stranded
    at 'sent'/'delivered' with no engagement — e.g. launched while the live
    callback loop was interrupted). Healthy campaigns are left untouched; only
    forward progress is applied, so it's safe to re-run."""
    now = utcnow()
    top_cat = _top_categories(db)
    repaired = 0
    for c in db.query(Campaign).all():
        msgs = db.query(Message).filter(Message.campaign_id == c.id).all()
        nonfailed = [m for m in msgs if m.status != "failed"]
        if not nonfailed:
            continue
        delivered = sum(1 for m in nonfailed if m.status_rank >= RANK["delivered"])
        converted = sum(1 for m in nonfailed if m.status == "converted")
        clicked = sum(1 for m in nonfailed if m.status_rank >= RANK["clicked"])
        healthy = (delivered == len(nonfailed) and converted > 0
                   and clicked >= 0.05 * len(nonfailed))
        if healthy:
            continue
        f = CHANNEL_FUNNEL.get(c.channel, CHANNEL_FUNNEL["sms"])
        when = c.started_at or (now - timedelta(days=random.randint(10, 120)))
        new_events, new_orders = [], []
        for m in nonfailed:
            if m.status == "converted":
                continue
            stages = ["delivered"]
            if random.random() < f["open"]:
                stages.append("opened")
                if random.random() < f["read"]:
                    stages.append("read")
                if random.random() < f["click"]:
                    stages.append("clicked")
                    if random.random() < f["convert"]:
                        stages.append("converted")
            final = stages[-1]
            # Forward-only: never regress an already-advanced message.
            if RANK[final] <= m.status_rank:
                if m.status_rank >= RANK["delivered"]:
                    continue
                final = "delivered"
            for i, st in enumerate(stages):
                if RANK[st] > m.status_rank:
                    new_events.append(MessageEvent(
                        event_id=uid(), message_id=m.id, event_type=st,
                        occurred_at=when + timedelta(minutes=i * 6), meta={}))
            m.status, m.status_rank = final, RANK[final]
            m.updated_at = when + timedelta(minutes=len(stages) * 6)
            if final == "converted":
                new_orders.append(Order(
                    customer_id=m.customer_id,
                    amount=round(random.uniform(1400, 8500), 2),
                    category=top_cat.get(m.customer_id, ""),
                    campaign_id=c.id,
                    created_at=when + timedelta(hours=random.randint(1, 72))))
        c.status = "dispatched"
        db.add_all(new_events)
        db.add_all(new_orders)
        db.commit()
        repaired += 1
        print(f"  repaired '{c.name}' -> +{len(new_orders)} conversions")
    print(f"Repaired {repaired} stalled campaigns.")


def pick_profile():
    r = random.random()
    acc = 0.0
    for name, share, *rest in PROFILES:
        acc += share
        if r <= acc:
            return (name, *rest)
    return ("one_timer", *PROFILES[-1][2:])


def run():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(Customer).count() > 0:
            print("Database already seeded; skipping. Delete crm.db to reseed.")
            return

        now = utcnow()
        customers, orders = [], []
        seen_emails = set()
        for _ in range(N_CUSTOMERS):
            email = fake.unique.email()
            if email in seen_emails:
                continue
            seen_emails.add(email)
            _, orders_range, amount_range, recency_range = pick_profile()
            preferred_category = random.choices(
                CATEGORIES, weights=CATEGORY_WEIGHTS)[0]
            joined = now - timedelta(days=random.randint(30, 365))
            customer = Customer(
                name=fake.name(),
                email=email,
                phone=fake.phone_number(),
                city=random.choice(CITIES),
                created_at=joined,
            )
            customers.append(customer)

            n_orders = random.randint(*orders_range)
            last_order = now - timedelta(days=random.randint(*recency_range))
            if last_order < joined:
                last_order = joined + timedelta(days=1)
            # Spread earlier orders between joining and the last order.
            dates = sorted(
                joined + timedelta(
                    seconds=random.random() * (last_order - joined).total_seconds())
                for _ in range(n_orders - 1)
            ) + [last_order]
            for d in dates:
                category = (preferred_category if random.random() < 0.7
                            else random.choice(CATEGORIES))
                orders.append(Order(
                    customer=customer,
                    amount=round(random.uniform(*amount_range), 2),
                    category=category,
                    created_at=d,
                ))

        db.add_all(customers)
        db.add_all(orders)
        db.commit()
        print(f"Seeded {len(customers)} customers, {len(orders)} orders.")
        seed_campaigns(db)
    finally:
        db.close()


if __name__ == "__main__":
    # `python -m app.seed`            -> full seed (no-op if already seeded)
    # `python -m app.seed campaigns`  -> (re)seed campaigns onto existing data
    if len(sys.argv) > 1 and sys.argv[1] == "campaigns":
        Base.metadata.create_all(bind=engine)
        _db = SessionLocal()
        try:
            seed_campaigns(_db)
            repair_campaigns(_db)
        finally:
            _db.close()
    else:
        run()
