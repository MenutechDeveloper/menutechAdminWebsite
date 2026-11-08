-- =========================================================
-- Menutech Online Payment Admin & Restaurant Configuration Schema
-- =========================================================

-- 1. Restaurant Online Payment Configurations Table
CREATE TABLE IF NOT EXISTS public.menutech_restaurant_payment_configs (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    service_status TEXT NOT NULL DEFAULT 'inactive', -- 'active', 'inactive', 'suspended', 'free_access', 'overdue'
    service_start_date TIMESTAMPTZ DEFAULT NOW(),
    next_due_date TIMESTAMPTZ,
    monthly_price NUMERIC(10,2) NOT NULL DEFAULT 29.00,
    is_free_access BOOLEAN DEFAULT FALSE,
    payment_mode TEXT NOT NULL DEFAULT 'none', -- 'none', 'own_stripe', 'menutech_commission'
    commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    commission_authorized_at TIMESTAMPTZ,
    commission_authorized_by TEXT,
    commission_revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menutech_res_pay_cfg_user_id ON public.menutech_restaurant_payment_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_menutech_res_pay_cfg_status ON public.menutech_restaurant_payment_configs(service_status);
CREATE INDEX IF NOT EXISTS idx_menutech_res_pay_cfg_mode ON public.menutech_restaurant_payment_configs(payment_mode);

-- 2. Global Online Payment Configuration Table (Default Pricing & Global Rules)
CREATE TABLE IF NOT EXISTS public.menutech_online_payment_global_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    monthly_price NUMERIC(10,2) NOT NULL DEFAULT 29.00,
    currency TEXT NOT NULL DEFAULT 'usd',
    service_title TEXT NOT NULL DEFAULT 'Online Payments Service',
    service_description TEXT NOT NULL DEFAULT 'Accept online credit and debit card payments directly for customer orders and reservations.',
    default_commission_rate NUMERIC(5,2) NOT NULL DEFAULT 5.00,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default global config if table is empty
INSERT INTO public.menutech_online_payment_global_config (monthly_price, currency, service_title, service_description, default_commission_rate)
SELECT 29.00, 'usd', 'Online Payments Service', 'Accept online credit and debit card payments directly for customer orders and reservations.', 5.00
WHERE NOT EXISTS (SELECT 1 FROM public.menutech_online_payment_global_config);

-- 3. Enable Row Level Security
ALTER TABLE public.menutech_restaurant_payment_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menutech_online_payment_global_config ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for menutech_online_payment_global_config
-- Everyone authenticated or public can read global service price and description
DROP POLICY IF EXISTS "Public select online payment global config" ON public.menutech_online_payment_global_config;
CREATE POLICY "Public select online payment global config" ON public.menutech_online_payment_global_config
    FOR SELECT USING (true);

-- Only privileged roles can modify global config
DROP POLICY IF EXISTS "Privileged roles manage online payment global config" ON public.menutech_online_payment_global_config;
CREATE POLICY "Privileged roles manage online payment global config" ON public.menutech_online_payment_global_config
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

-- 5. RLS Policies for menutech_restaurant_payment_configs
-- Restaurant owner can read their own config; Admins can read all
DROP POLICY IF EXISTS "Users and Admins view restaurant payment configs" ON public.menutech_restaurant_payment_configs;
CREATE POLICY "Users and Admins view restaurant payment configs" ON public.menutech_restaurant_payment_configs
    FOR SELECT USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    );

-- Only privileged roles can insert, update or delete restaurant payment configs
DROP POLICY IF EXISTS "Privileged roles manage restaurant payment configs" ON public.menutech_restaurant_payment_configs;
CREATE POLICY "Privileged roles manage restaurant payment configs" ON public.menutech_restaurant_payment_configs
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
