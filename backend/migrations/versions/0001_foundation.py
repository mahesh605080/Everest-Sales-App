"""foundation: the platform schema and its settings table

Revision ID: 0001
Revises:
"""
import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "settings",
        sa.Column("key", sa.String(80), primary_key=True), sa.Column("value", sa.Text, nullable=False), sa.Column("label", sa.String(200), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False), sa.Column("updated_by", sa.Integer),
        schema="platform",
    )


def downgrade():
    op.drop_table("settings", schema="platform")
