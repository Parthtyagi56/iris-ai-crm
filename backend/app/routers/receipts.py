"""The receipt webhook the channel service calls back into.

Security: callbacks carry an HMAC-SHA256 signature of the raw body computed
with a shared secret (X-Channel-Signature). We verify against the raw bytes
*before* parsing, exactly like real providers (Twilio/Meta) do, so a forged
or tampered callback can't move money-shaped numbers on the insights page.
"""
import hashlib
import hmac

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..schemas import ReceiptBatch
from ..services.receipt_processor import process_batch

router = APIRouter(prefix="/api", tags=["receipts"])


def _verify_signature(raw_body: bytes, signature: str | None) -> None:
    expected = hmac.new(settings.webhook_secret.encode(),
                        raw_body, hashlib.sha256).hexdigest()
    if not signature or not hmac.compare_digest(expected, signature):
        raise HTTPException(401, "invalid webhook signature")


@router.post("/receipts")
async def ingest_receipts(request: Request, db: Session = Depends(get_db)):
    raw = await request.body()
    _verify_signature(raw, request.headers.get("X-Channel-Signature"))
    batch = ReceiptBatch.model_validate_json(raw)
    results = process_batch(db, batch.events)
    # Always 200 for processed batches — including duplicates — so the
    # channel's retry loop terminates. Non-2xx means "please retry".
    return {"results": results}
