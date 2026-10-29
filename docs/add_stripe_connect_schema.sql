-- =========================================================
-- Menutech Stripe Connect & Payments Database Schema
-- =========================================================

-- 1. Stripe Connected Accounts Table
CREATE TABLE IF NOT EXISTS public.menutech_stripe_accounts (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    stripe_account_id TEXT NOT NULL UNIQUE,
    details_submitted BOOLEAN DEFAULT FALSE,
    charges_enabled BOOLEAN DEFAULT FALSE,
    payouts_enabled BOOLEAN DEFAULT FALSE,
    country TEXT,
    currency TEXT DEFAULT 'usd',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for lookup by user_id and stripe_account_id
CREATE INDEX IF NOT EXISTS idx_menutech_stripe_user_id ON public.menutech_stripe_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_menutech_stripe_account_id ON public.menutech_stripe_accounts(stripe_account_id);

-- 2. Stripe Payment Audit Logs Table
CREATE TABLE IF NOT EXISTS public.menutech_payment_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    stripe_account_id TEXT,
    order_id UUID,
    reservation_id UUID,
    event_type TEXT NOT NULL,
    stripe_event_id TEXT UNIQUE,
    amount NUMERIC,
    currency TEXT,
    status TEXT,
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient query
CREATE INDEX IF NOT EXISTS idx_menutech_payment_logs_user_id ON public.menutech_payment_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_menutech_payment_logs_order_id ON public.menutech_payment_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_menutech_payment_logs_res_id ON public.menutech_payment_logs(reservation_id);
CREATE INDEX IF NOT EXISTS idx_menutech_payment_logs_event_id ON public.menutech_payment_logs(stripe_event_id);

-- 3. Add Payment Columns to menutech_orders
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='payment_status') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN payment_status TEXT DEFAULT 'unpaid';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='stripe_checkout_session_id') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN stripe_checkout_session_id TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='stripe_payment_intent_id') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN stripe_payment_intent_id TEXT;
    END IF;
END $$;

-- Index for payment_status on orders
CREATE INDEX IF NOT EXISTS idx_menutech_orders_payment_status ON public.menutech_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_menutech_orders_session_id ON public.menutech_orders(stripe_checkout_session_id);

-- 4. Add Payment Columns to menutech_reservations
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_reservations' AND column_name='payment_status') THEN
        ALTER TABLE public.menutech_reservations ADD COLUMN payment_status TEXT DEFAULT 'not_required';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_reservations' AND column_name='stripe_checkout_session_id') THEN
        ALTER TABLE public.menutech_reservations ADD COLUMN stripe_checkout_session_id TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_reservations' AND column_name='stripe_payment_intent_id') THEN
        ALTER TABLE public.menutech_reservations ADD COLUMN stripe_payment_intent_id TEXT;
    END IF;
END $$;

-- Index for payment_status on reservations
CREATE INDEX IF NOT EXISTS idx_menutech_res_payment_status ON public.menutech_reservations(payment_status);
CREATE INDEX IF NOT EXISTS idx_menutech_res_session_id ON public.menutech_reservations(stripe_checkout_session_id);

-- 5. Enable Row Level Security
ALTER TABLE public.menutech_stripe_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menutech_payment_logs ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies for menutech_stripe_accounts
-- Public select allowed so widgets can verify charges_enabled for a user_id
DROP POLICY IF EXISTS "Public select stripe account info" ON public.menutech_stripe_accounts;
CREATE POLICY "Public select stripe account info" ON public.menutech_stripe_accounts
    FOR SELECT USING (true);

-- Management access for owners and admins
DROP POLICY IF EXISTS "Management access for stripe accounts" ON public.menutech_stripe_accounts;
CREATE POLICY "Management access for stripe accounts" ON public.menutech_stripe_accounts
    FOR ALL USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    )
    WITH CHECK (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    );

-- 7. RLS Policies for menutech_payment_logs
DROP POLICY IF EXISTS "Management access for payment logs" ON public.menutech_payment_logs;
CREATE POLICY "Management access for payment logs" ON public.menutech_payment_logs
    FOR ALL USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    );

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
