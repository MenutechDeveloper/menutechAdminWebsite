-- Enable extension for UUID generation if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table to store AI knowledge base items (FAQs, Documents, Sheets/Tables)
CREATE TABLE IF NOT EXISTS public.menutech_knowledge (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('faq', 'document', 'sheet')),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient querying by type or creation time
CREATE INDEX IF NOT EXISTS idx_menutech_knowledge_type ON public.menutech_knowledge (type);
CREATE INDEX IF NOT EXISTS idx_menutech_knowledge_created_at ON public.menutech_knowledge (created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.menutech_knowledge ENABLE ROW LEVEL SECURITY;

-- Safely drop existing policies before recreating
DO $$
BEGIN
    DROP POLICY IF EXISTS "Anyone can view knowledge base" ON public.menutech_knowledge;
    DROP POLICY IF EXISTS "Anyone can insert knowledge base" ON public.menutech_knowledge;
    DROP POLICY IF EXISTS "Anyone can update knowledge base" ON public.menutech_knowledge;
    DROP POLICY IF EXISTS "Anyone can delete knowledge base" ON public.menutech_knowledge;
END $$;

-- RLS Policies
CREATE POLICY "Anyone can view knowledge base"
    ON public.menutech_knowledge FOR SELECT
    USING (true);

CREATE POLICY "Anyone can insert knowledge base"
    ON public.menutech_knowledge FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Anyone can update knowledge base"
    ON public.menutech_knowledge FOR UPDATE
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Anyone can delete knowledge base"
    ON public.menutech_knowledge FOR DELETE
    USING (true);

-- Automatic updated_at trigger
CREATE OR REPLACE FUNCTION update_menutech_knowledge_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_menutech_knowledge_updated_at ON public.menutech_knowledge;

CREATE TRIGGER trigger_update_menutech_knowledge_updated_at
    BEFORE UPDATE ON public.menutech_knowledge
    FOR EACH ROW
    EXECUTE FUNCTION update_menutech_knowledge_updated_at();
