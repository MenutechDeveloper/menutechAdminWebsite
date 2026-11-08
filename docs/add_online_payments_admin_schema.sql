-- =========================================================
-- Menutech Centralized Online Payments Admin Schema Migration
-- =========================================================

-- 1. Global Online Payment Configuration
CREATE TABLE IF NOT EXISTS public.menutech_online_payment_config (
    id TEXT PRIMARY KEY DEFAULT 'default',
    monthly_price NUMERIC(10, 2) NOT NULL DEFAULT 29.00,
    is_commercialized BOOLEAN NOT NULL DEFAULT true,
    global_commission_percent NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
    currency TEXT NOT NULL DEFAULT 'usd',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default global config if missing
INSERT INTO public.menutech_online_payment_config (id, monthly_price, is_commercialized, global_commission_percent, currency)
VALUES ('default', 29.00, true, 5.00, 'usd')
ON CONFLICT (id) DO NOTHING;

-- 2. Service Pricing History
CREATE TABLE IF NOT EXISTS public.menutech_online_payment_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    price NUMERIC(10, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    reason TEXT,
    is_commercialized BOOLEAN DEFAULT true,
    notes TEXT,
    changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    effective_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_online_payment_price_history_date
ON public.menutech_online_payment_price_history(effective_at DESC);

-- 3. Restaurant Payment Configuration (Subscriptions, Payment Modes & Commissions)
-- payment_mode: 'own_stripe' OR 'menutech_commission'
-- status: 'active', 'suspended', 'cancelled', 'pending'
CREATE TABLE IF NOT EXISTS public.menutech_restaurant_payment_configs (
    restaurant_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT false,
    free_access BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'pending',
    payment_mode TEXT NOT NULL DEFAULT 'own_stripe',
    commission_percent NUMERIC(5, 2) DEFAULT NULL, -- NULL uses global config percent
    custom_commission_percent NUMERIC(5, 2) DEFAULT NULL,
    subscription_due_date DATE,
    due_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_payment_configs_status
ON public.menutech_restaurant_payment_configs(status);

-- 4. Online Payments History & Renewals
CREATE TABLE IF NOT EXISTS public.menutech_online_payment_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL DEFAULT 'renewal', -- 'activation', 'renewal', 'suspension', 'cancellation', 'mode_change', 'commission_update'
    payment_type TEXT DEFAULT 'monthly_subscription',
    amount NUMERIC(10, 2) DEFAULT 0.00,
    currency TEXT DEFAULT 'usd',
    period_start DATE,
    period_end DATE,
    payment_method TEXT DEFAULT 'manual',
    details TEXT,
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_online_payment_hist_restaurant
ON public.menutech_online_payment_history(restaurant_id, created_at DESC);

-- Enable RLS on all tables
ALTER TABLE public.menutech_online_payment_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menutech_online_payment_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menutech_restaurant_payment_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menutech_online_payment_history ENABLE ROW LEVEL SECURITY;

-- Global Config Policies
-- All authenticated users can read global pricing & commercialization status
DROP POLICY IF EXISTS "Anyone can view online payment config" ON public.menutech_online_payment_config;
CREATE POLICY "Anyone can view online payment config"
ON public.menutech_online_payment_config FOR SELECT
TO authenticated
USING (true);

-- Only admins/developers/cs can modify global online payment config
DROP POLICY IF EXISTS "Admins can update online payment config" ON public.menutech_online_payment_config;
CREATE POLICY "Admins can update online payment config"
ON public.menutech_online_payment_config FOR ALL
TO authenticated
USING (
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

-- Price History Policies
DROP POLICY IF EXISTS "Admins can read price history" ON public.menutech_online_payment_price_history;
CREATE POLICY "Admins can read price history"
ON public.menutech_online_payment_price_history FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
    )
);

DROP POLICY IF EXISTS "Admins can insert price history" ON public.menutech_online_payment_price_history;
CREATE POLICY "Admins can insert price history"
ON public.menutech_online_payment_price_history FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
    )
);

-- Restaurant Payment Configs Policies
DROP POLICY IF EXISTS "Admins full access to restaurant payment configs" ON public.menutech_restaurant_payment_configs;
CREATE POLICY "Admins full access to restaurant payment configs"
ON public.menutech_restaurant_payment_configs FOR ALL
TO authenticated
USING (
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

-- Restaurant owners can view their own payment configuration
DROP POLICY IF EXISTS "Owners can view own payment config" ON public.menutech_restaurant_payment_configs;
CREATE POLICY "Owners can view own payment config"
ON public.menutech_restaurant_payment_configs FOR SELECT
TO authenticated
USING (restaurant_id = auth.uid());

-- Restaurant owners can insert a pending request for activation
DROP POLICY IF EXISTS "Owners can request activation" ON public.menutech_restaurant_payment_configs;
CREATE POLICY "Owners can request activation"
ON public.menutech_restaurant_payment_configs FOR INSERT
TO authenticated
WITH CHECK (restaurant_id = auth.uid() AND status = 'pending' AND is_active = false);

-- Online Payment History Policies
DROP POLICY IF EXISTS "Admins full access to payment history" ON public.menutech_online_payment_history;
CREATE POLICY "Admins full access to payment history"
ON public.menutech_online_payment_history FOR ALL
TO authenticated
USING (
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

DROP POLICY IF EXISTS "Owners can view own payment history" ON public.menutech_online_payment_history;
CREATE POLICY "Owners can view own payment history"
ON public.menutech_online_payment_history FOR SELECT
TO authenticated
USING (restaurant_id = auth.uid());
