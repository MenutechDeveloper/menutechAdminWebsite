-- Enable extension for UUID generation if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table to store AI Automations configurations and generated code
CREATE TABLE IF NOT EXISTS public.menutech_automations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'invalid_config')),
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    generated_code TEXT DEFAULT '',
    schedule_type TEXT DEFAULT 'interval',
    schedule_interval_minutes INT DEFAULT 60,
    gemini_enabled BOOLEAN DEFAULT true,
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient querying by status and scheduling
CREATE INDEX IF NOT EXISTS idx_menutech_automations_status ON public.menutech_automations (status);
CREATE INDEX IF NOT EXISTS idx_menutech_automations_next_run ON public.menutech_automations (next_run_at);

-- Table to store automation execution logs and prevent duplicate events
CREATE TABLE IF NOT EXISTS public.menutech_automation_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    automation_id UUID REFERENCES public.menutech_automations(id) ON DELETE CASCADE,
    event_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('success', 'error', 'skipped')),
    records_processed INT DEFAULT 0,
    events_generated INT DEFAULT 0,
    gemini_called BOOLEAN DEFAULT false,
    details JSONB DEFAULT '{}'::jsonb,
    error_message TEXT,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menutech_auto_logs_automation_id ON public.menutech_automation_logs (automation_id);
CREATE INDEX IF NOT EXISTS idx_menutech_auto_logs_event_id ON public.menutech_automation_logs (event_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.menutech_automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menutech_automation_logs ENABLE ROW LEVEL SECURITY;

-- Safely drop existing policies before recreating
DO $$
BEGIN
    DROP POLICY IF EXISTS "Anyone can view automations" ON public.menutech_automations;
    DROP POLICY IF EXISTS "Anyone can insert automations" ON public.menutech_automations;
    DROP POLICY IF EXISTS "Anyone can update automations" ON public.menutech_automations;
    DROP POLICY IF EXISTS "Anyone can delete automations" ON public.menutech_automations;

    DROP POLICY IF EXISTS "Anyone can view automation logs" ON public.menutech_automation_logs;
    DROP POLICY IF EXISTS "Anyone can insert automation logs" ON public.menutech_automation_logs;
END $$;

-- RLS Policies
CREATE POLICY "Anyone can view automations"
    ON public.menutech_automations FOR SELECT USING (true);

CREATE POLICY "Anyone can insert automations"
    ON public.menutech_automations FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update automations"
    ON public.menutech_automations FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can delete automations"
    ON public.menutech_automations FOR DELETE USING (true);

CREATE POLICY "Anyone can view automation logs"
    ON public.menutech_automation_logs FOR SELECT USING (true);

CREATE POLICY "Anyone can insert automation logs"
    ON public.menutech_automation_logs FOR INSERT WITH CHECK (true);

-- Automatic updated_at trigger for automations
CREATE OR REPLACE FUNCTION update_menutech_automations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_menutech_automations_updated_at ON public.menutech_automations;

CREATE TRIGGER trigger_update_menutech_automations_updated_at
    BEFORE UPDATE ON public.menutech_automations
    FOR EACH ROW
    EXECUTE FUNCTION update_menutech_automations_updated_at();
