-- Stripe owns payment state. This table stores only the minimum mapping and
-- lets the verified webhook grant/revoke the existing Pro entitlement.
begin;

create table public.stripe_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text not null unique,
  status text not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.stripe_subscriptions enable row level security;
revoke all on public.stripe_subscriptions from public, anon, authenticated;
grant all on public.stripe_subscriptions to service_role;

create table public.stripe_webhook_events (
  id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from public, anon, authenticated;
grant all on public.stripe_webhook_events to service_role;

commit;
