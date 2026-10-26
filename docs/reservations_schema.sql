-- =========================================================
-- Menutech Reservations Database Schema
-- =========================================================

-- 1. Reservation Settings Table
CREATE TABLE IF NOT EXISTS public.menutech_reservation_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    domain TEXT,
    enabled BOOLEAN DEFAULT TRUE,
    min_guests INT DEFAULT 2,
    max_guests INT DEFAULT 8,
    min_lead_time_min INT DEFAULT 15,
    max_advance_days INT DEFAULT 8,
    hold_duration_min INT DEFAULT 15,
    allow_preorder BOOLEAN DEFAULT TRUE,
    custom_schedule JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for settings lookup by user_id and domain
CREATE INDEX IF NOT EXISTS idx_menutech_res_settings_user_id ON public.menutech_reservation_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_menutech_res_settings_domain ON public.menutech_reservation_settings(domain);

-- 2. Reservations Table
CREATE TABLE IF NOT EXISTS public.menutech_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    domain TEXT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT,
    guests_count INT NOT NULL DEFAULT 2,
    reservation_date DATE NOT NULL,
    reservation_time TEXT NOT NULL,
    comments TEXT,
    preorder_items JSONB DEFAULT '[]'::jsonb,
    status TEXT DEFAULT 'pending', -- 'pending', 'accepted', 'completed', 'rejected', 'cancelled'
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying & filtering
CREATE INDEX IF NOT EXISTS idx_menutech_reservations_user_id ON public.menutech_reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_menutech_reservations_domain ON public.menutech_reservations(domain);
CREATE INDEX IF NOT EXISTS idx_menutech_reservations_status ON public.menutech_reservations(status);
CREATE INDEX IF NOT EXISTS idx_menutech_reservations_date ON public.menutech_reservations(reservation_date);

-- Enable RLS
ALTER TABLE public.menutech_reservation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menutech_reservations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for menutech_reservation_settings
DROP POLICY IF EXISTS "Public select reservation settings" ON public.menutech_reservation_settings;
CREATE POLICY "Public select reservation settings" ON public.menutech_reservation_settings
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Owner manage reservation settings" ON public.menutech_reservation_settings;
CREATE POLICY "Owner manage reservation settings" ON public.menutech_reservation_settings
    FOR ALL
    USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND UPPER(role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    )
    WITH CHECK (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND UPPER(role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    );

-- RLS Policies for menutech_reservations
DROP POLICY IF EXISTS "Public insert reservations" ON public.menutech_reservations;
CREATE POLICY "Public insert reservations" ON public.menutech_reservations
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Public select own reservation by id" ON public.menutech_reservations;
CREATE POLICY "Public select own reservation by id" ON public.menutech_reservations
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Owner manage reservations" ON public.menutech_reservations;
CREATE POLICY "Owner manage reservations" ON public.menutech_reservations
    FOR ALL
    USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND UPPER(role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    )
    WITH CHECK (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND UPPER(role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    );

-- Realtime Publication for Reservations
ALTER PUBLICATION supabase_realtime ADD TABLE public.menutech_reservations;
