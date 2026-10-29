-- =========================================================
-- Menutech Billing, Packages, Subscriptions & Payment Logs Schema Migration
-- =========================================================

-- 1. Stripe Connected Accounts Table (if not existing)
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

CREATE INDEX IF NOT EXISTS idx_menutech_stripe_user_id ON public.menutech_stripe_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_menutech_stripe_account_id ON public.menutech_stripe_accounts(stripe_account_id);

-- 2. Stripe Payment Audit Logs Table (if not existing)
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

CREATE INDEX IF NOT EXISTS idx_menutech_payment_logs_user_id ON public.menutech_payment_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_menutech_payment_logs_order_id ON public.menutech_payment_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_menutech_payment_logs_res_id ON public.menutech_payment_logs(reservation_id);
CREATE INDEX IF NOT EXISTS idx_menutech_payment_logs_event_id ON public.menutech_payment_logs(stripe_event_id);

-- 3. Packages Table
CREATE TABLE IF NOT EXISTS public.menutech_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    billing_period TEXT DEFAULT 'monthly',
    included_services JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menutech_packages_active ON public.menutech_packages(is_active);

-- 4. Subscriptions Table
CREATE TABLE IF NOT EXISTS public.menutech_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    package_id UUID REFERENCES public.menutech_packages(id) ON DELETE SET NULL,
    service_start_date TIMESTAMPTZ DEFAULT NOW(),
    last_payment_date TIMESTAMPTZ,
    next_due_date TIMESTAMPTZ,
    status TEXT DEFAULT 'active', -- 'active', 'due_soon', 'overdue', 'suspended'
    suspended_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menutech_subscriptions_user_id ON public.menutech_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_menutech_subscriptions_status ON public.menutech_subscriptions(status);

-- 5. Subscription Payments History Table
CREATE TABLE IF NOT EXISTS public.menutech_subscription_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID REFERENCES public.menutech_subscriptions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    payment_date TIMESTAMPTZ DEFAULT NOW(),
    payment_method TEXT DEFAULT 'manual',
    reference TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menutech_sub_payments_sub_id ON public.menutech_subscription_payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_menutech_sub_payments_user_id ON public.menutech_subscription_payments(user_id);

-- 6. Add Account Suspension Flag to Profiles
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='is_suspended') THEN
        ALTER TABLE public.profiles ADD COLUMN is_suspended BOOLEAN DEFAULT false;
    END IF;
END $$;

-- 7. Enable Row Level Security
ALTER TABLE public.menutech_stripe_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menutech_payment_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menutech_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menutech_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menutech_subscription_payments ENABLE ROW LEVEL SECURITY;

-- 8. RLS Policies for menutech_stripe_accounts & payment_logs
DROP POLICY IF EXISTS "Public select stripe account info" ON public.menutech_stripe_accounts;
CREATE POLICY "Public select stripe account info" ON public.menutech_stripe_accounts
    FOR SELECT USING (true);

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

-- 9. RLS Policies for menutech_packages
DROP POLICY IF EXISTS "Anyone can view active packages" ON public.menutech_packages;
CREATE POLICY "Anyone can view active packages" ON public.menutech_packages
    FOR SELECT USING (is_active = true OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
    ));

DROP POLICY IF EXISTS "Privileged roles manage packages" ON public.menutech_packages;
CREATE POLICY "Privileged roles manage packages" ON public.menutech_packages
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    );

-- 10. RLS Policies for menutech_subscriptions
DROP POLICY IF EXISTS "Users and Admins view subscriptions" ON public.menutech_subscriptions;
CREATE POLICY "Users and Admins view subscriptions" ON public.menutech_subscriptions
    FOR SELECT USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    );

DROP POLICY IF EXISTS "Privileged roles manage subscriptions" ON public.menutech_subscriptions;
CREATE POLICY "Privileged roles manage subscriptions" ON public.menutech_subscriptions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    );

-- 11. RLS Policies for menutech_subscription_payments
DROP POLICY IF EXISTS "Users and Admins view subscription payments" ON public.menutech_subscription_payments;
CREATE POLICY "Users and Admins view subscription payments" ON public.menutech_subscription_payments
    FOR SELECT USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    );

DROP POLICY IF EXISTS "Privileged roles manage subscription payments" ON public.menutech_subscription_payments;
CREATE POLICY "Privileged roles manage subscription payments" ON public.menutech_subscription_payments
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    );

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
