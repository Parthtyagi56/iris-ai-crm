"""Seed realistic data for "Aurelia", a fictional D2C fashion brand.

Deliberately shaped (not uniform-random) so segments are meaningful:
  ~15% VIPs        - frequent, high-value, recent
  ~40% regulars    - moderate frequency and recency
  ~25% lapsed      - bought before, nothing in 60-300 days  <- win-back demo
  ~20% one-timers  - single early order, mostly gone quiet

Deterministic (seeded) so the demo numbers are reproducible.
Run:  python -m app.seed
"""
import random
from datetime import timedelta

from faker import Faker

from .database import Base, SessionLocal, engine
from .models import Customer, Order, utcnow

fake = Faker("en_IN")
Faker.seed(42)
random.seed(42)

CITIES = ["Mumbai", "Delhi", "Bengaluru", "Chennai", "Hyderabad",
          "Pune", "Kolkata", "Jaipur"]

PROFILES = [
    # (share, orders_range, amount_range, days_since_last_order_range)
    ("vip", 0.15, (6, 15), (1500, 9000), (1, 30)),
    ("regular", 0.40, (2, 6), (800, 4000), (10, 90)),
    ("lapsed", 0.25, (2, 5), (800, 5000), (60, 300)),
    ("one_timer", 0.20, (1, 1), (500, 2500), (90, 400)),
]

N_CUSTOMERS = 1200


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
            joined = now - timedelta(days=random.randint(30, 540))
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
                orders.append(Order(
                    customer=customer,
                    amount=round(random.uniform(*amount_range), 2),
                    created_at=d,
                ))

        db.add_all(customers)
        db.add_all(orders)
        db.commit()
        print(f"Seeded {len(customers)} customers, {len(orders)} orders.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
