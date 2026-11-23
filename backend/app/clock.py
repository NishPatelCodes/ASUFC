"""Business dates follow the Food Cupboard's local calendar, not the server clock."""
import os
from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "America/Halifax"


def today() -> date:
    try:
        zone = ZoneInfo(os.environ.get("ASUFC_TIMEZONE", DEFAULT_TIMEZONE))
    except (ZoneInfoNotFoundError, ValueError):
        # A host without time zone data falls back to its own calendar date.
        return date.today()
    return datetime.now(zone).date()
