from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import SCHEMA, Base


class Setting(Base):
    """Platform configuration that the Super Admin can change without a redeploy. Secrets never go here."""
    __tablename__ = "settings"
    __table_args__ = {"schema": SCHEMA}
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    label: Mapped[str] = mapped_column(String(200))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[int | None] = mapped_column()
