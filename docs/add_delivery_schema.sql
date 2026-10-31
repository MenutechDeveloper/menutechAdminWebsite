-- =========================================================
-- Menutech Delivery & Delivery Zones Database Schema
-- Multi-restaurant support with Row Level Security (RLS)
-- =========================================================

-- 1. Restaurant Locations Table
CREATE TABLE IF NOT EXISTS public.menutech_restaurant_locations (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    address TEXT,
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menutech_restaurant_locations_user ON public.menutech_restaurant_locations(user_id);

-- 2. Delivery Zones Table
CREATE TABLE IF NOT EXISTS public.menutech_delivery_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#ff9533',
    fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    is_active BOOLEAN DEFAULT TRUE,
    geojson JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menutech_delivery_zones_user ON public.menutech_delivery_zones(user_id);
CREATE INDEX IF NOT EXISTS idx_menutech_delivery_zones_active ON public.menutech_delivery_zones(is_active);

-- 3. Add delivery-specific columns to menutech_orders
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='delivery_fee') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN delivery_fee NUMERIC(10, 2) DEFAULT 0.00;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='delivery_zone_name') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN delivery_zone_name TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='subtotal') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN subtotal NUMERIC(10, 2);
    END IF;
END $$;

-- 4. Enable Row Level Security
ALTER TABLE public.menutech_restaurant_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menutech_delivery_zones ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for menutech_restaurant_locations
-- Public / customer menu can view locations to calculate delivery
DROP POLICY IF EXISTS "Public select restaurant locations" ON public.menutech_restaurant_locations;
CREATE POLICY "Public select restaurant locations" ON public.menutech_restaurant_locations
    FOR SELECT USING (true);

-- Owners can manage their own location, and privileged roles can manage all
DROP POLICY IF EXISTS "Manage restaurant locations" ON public.menutech_restaurant_locations;
CREATE POLICY "Manage restaurant locations" ON public.menutech_restaurant_locations
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

-- 6. RLS Policies for menutech_delivery_zones
-- Public / customer menu can view active zones to calculate delivery coverage & fee
DROP POLICY IF EXISTS "Public select delivery zones" ON public.menutech_delivery_zones;
CREATE POLICY "Public select delivery zones" ON public.menutech_delivery_zones
    FOR SELECT USING (true);

-- Owners can manage their own zones, and privileged roles can manage all
DROP POLICY IF EXISTS "Manage delivery zones" ON public.menutech_delivery_zones;
CREATE POLICY "Manage delivery zones" ON public.menutech_delivery_zones
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

-- 7. Realtime Publication
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'menutech_delivery_zones'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.menutech_delivery_zones;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'menutech_restaurant_locations'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.menutech_restaurant_locations;
    END IF;
END $$;
