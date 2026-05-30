-- SQL Schema for Menutech Footer Module

-- 1. Footers Table
CREATE TABLE IF NOT EXISTS public.menutech_footers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- --- INDEXES ---
CREATE INDEX IF NOT EXISTS idx_footers_domain ON public.menutech_footers(domain);

-- --- RLS POLICIES ---

ALTER TABLE public.menutech_footers ENABLE ROW LEVEL SECURITY;

-- Footers Policies
DO $$ BEGIN
    DROP POLICY IF EXISTS "Public read access for footers" ON public.menutech_footers;
    CREATE POLICY "Public read access for footers" ON public.menutech_footers FOR SELECT USING (true);
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
    DROP POLICY IF EXISTS "Management access for footers" ON public.menutech_footers;
    CREATE POLICY "Management access for footers" ON public.menutech_footers FOR ALL USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND (profiles.role = 'admin' OR profiles.role = 'developer' OR profiles.role = 'CS' OR profiles.role = 'adminCS')));
EXCEPTION WHEN others THEN NULL; END $$;
