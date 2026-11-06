-- Migration: Add Menutech Promotions System
-- Table: public.menutech_promotions
CREATE TABLE IF NOT EXISTS public.menutech_promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    domain TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN (
        'cart_percent',
        'items_percent',
        'free_delivery',
        'bogo',
        'cart_fixed',
        'payment_method',
        'free_item'
    )),
    headline TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    config JSONB DEFAULT '{}'::jsonb,
    conditions JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Ensure menutech_orders has discount and applied_promo tracking columns
ALTER TABLE public.menutech_orders
ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS applied_promo JSONB DEFAULT NULL;

-- Enable Row Level Security
ALTER TABLE public.menutech_promotions ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist
DROP POLICY IF EXISTS "Users can read own promotions" ON public.menutech_promotions;
DROP POLICY IF EXISTS "Public can read active promotions" ON public.menutech_promotions;
DROP POLICY IF EXISTS "Users can insert own promotions" ON public.menutech_promotions;
DROP POLICY IF EXISTS "Users can update own promotions" ON public.menutech_promotions;
DROP POLICY IF EXISTS "Users can delete own promotions" ON public.menutech_promotions;

-- RLS Policies
CREATE POLICY "Users can read own promotions" ON public.menutech_promotions
    FOR SELECT USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    );

CREATE POLICY "Public can read active promotions" ON public.menutech_promotions
    FOR SELECT USING (is_active = true);

CREATE POLICY "Users can insert own promotions" ON public.menutech_promotions
    FOR INSERT WITH CHECK (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    );

CREATE POLICY "Users can update own promotions" ON public.menutech_promotions
    FOR UPDATE USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    );

CREATE POLICY "Users can delete own promotions" ON public.menutech_promotions
    FOR DELETE USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    );

-- Add to supabase_realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.menutech_promotions;
