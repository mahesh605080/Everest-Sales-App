"""notification engine

Revision ID: 0006
Revises: 0005
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('notifications',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('title', sa.String(length=150), nullable=False),
    sa.Column('body', sa.String(length=500), nullable=True),
    sa.Column('category', sa.String(length=30), nullable=False),
    sa.Column('url', sa.String(length=300), nullable=True),
    sa.Column('icon', sa.String(length=300), nullable=True),
    sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
    sa.Column('audience', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('priority', sa.SmallInteger(), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('source', sa.String(length=12), nullable=False),
    sa.Column('idempotency_key', sa.String(length=120), nullable=True),
    sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_by', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('fanned_out_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('idempotency_key'),
    schema='platform'
    )
    op.create_index('notifications_status_due', 'notifications', ['status', 'scheduled_at'], unique=False, schema='platform')
    op.create_table('notify_prefs',
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('push_enabled', sa.Boolean(), nullable=False),
    sa.Column('muted_categories', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
    sa.Column('quiet_from', sa.Time(), nullable=True),
    sa.Column('quiet_to', sa.Time(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('user_id'),
    schema='platform'
    )
    op.create_table('push_subscriptions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('device_id', sa.UUID(), nullable=True),
    sa.Column('session_id', sa.UUID(), nullable=True),
    sa.Column('channel', sa.String(length=10), nullable=False),
    sa.Column('endpoint', sa.Text(), nullable=False),
    sa.Column('p256dh', sa.String(length=200), nullable=True),
    sa.Column('auth', sa.String(length=100), nullable=True),
    sa.Column('user_agent', sa.String(length=300), nullable=True),
    sa.Column('app_version', sa.String(length=40), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_success_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_failure_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('failures', sa.Integer(), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('revoked_reason', sa.String(length=60), nullable=True),
    sa.ForeignKeyConstraint(['device_id'], ['platform.devices.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['session_id'], ['platform.sessions.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('endpoint'),
    schema='platform'
    )
    op.create_index('push_subs_user', 'push_subscriptions', ['user_id', 'active'], unique=False, schema='platform')
    op.create_table('deliveries',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('notification_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('channel', sa.String(length=10), nullable=False),
    sa.Column('subscription_id', sa.Integer(), nullable=True),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('next_attempt_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('provider_status', sa.Integer(), nullable=True),
    sa.Column('last_error', sa.String(length=300), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('clicked_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['notification_id'], ['platform.notifications.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['subscription_id'], ['platform.push_subscriptions.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('notification_id', 'user_id', 'channel', 'subscription_id'),
    schema='platform'
    )
    op.create_index('deliveries_due', 'deliveries', ['status', 'next_attempt_at'], unique=False, schema='platform')
    op.create_index('deliveries_user', 'deliveries', ['user_id', 'created_at'], unique=False, schema='platform')
    op.create_index(op.f('ix_platform_deliveries_notification_id'), 'deliveries', ['notification_id'], unique=False, schema='platform')


def downgrade():
    op.drop_index(op.f('ix_platform_deliveries_notification_id'), table_name='deliveries', schema='platform')
    op.drop_index('deliveries_user', table_name='deliveries', schema='platform')
    op.drop_index('deliveries_due', table_name='deliveries', schema='platform')
    op.drop_table('deliveries', schema='platform')
    op.drop_index('push_subs_user', table_name='push_subscriptions', schema='platform')
    op.drop_table('push_subscriptions', schema='platform')
    op.drop_table('notify_prefs', schema='platform')
    op.drop_index('notifications_status_due', table_name='notifications', schema='platform')
    op.drop_table('notifications', schema='platform')
