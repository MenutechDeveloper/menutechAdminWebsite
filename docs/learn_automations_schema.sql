-- Schema for Menutech Automations / Algorithms
-- Enable uuid-ossp extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: menutech_automations
CREATE TABLE IF NOT EXISTS public.menutech_automations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'draft', 'invalid')),
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    generated_code TEXT DEFAULT '',
    schedule_interval_minutes INTEGER DEFAULT 0,
    gemini_enabled BOOLEAN DEFAULT true,
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: menutech_automation_logs
CREATE TABLE IF NOT EXISTS public.menutech_automation_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    automation_id UUID REFERENCES public.menutech_automations(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'ERROR', 'WARNING')),
    duration_ms INTEGER DEFAULT 0,
    records_processed INTEGER DEFAULT 0,
    events_generated INTEGER DEFAULT 0,
    details JSONB DEFAULT '{}'::jsonb,
    error_message TEXT,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_automations_status ON public.menutech_automations(status);
CREATE INDEX IF NOT EXISTS idx_automation_logs_auto_id ON public.menutech_automation_logs(automation_id);

-- Enable RLS
ALTER TABLE public.menutech_automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menutech_automation_logs ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND LOWER(TRIM(role)) = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS Policies for menutech_automations (Admin full access, anon/service role fallback for edge function)
DROP POLICY IF EXISTS "Admin Full Access Automations" ON public.menutech_automations;
CREATE POLICY "Admin Full Access Automations" ON public.menutech_automations
    FOR ALL
    USING (
        public.is_admin_user() OR auth.role() = 'service_role'
    )
    WITH CHECK (
        public.is_admin_user() OR auth.role() = 'service_role'
    );

-- RLS Policies for menutech_automation_logs
DROP POLICY IF EXISTS "Admin Full Access Automation Logs" ON public.menutech_automation_logs;
CREATE POLICY "Admin Full Access Automation Logs" ON public.menutech_automation_logs
    FOR ALL
    USING (
        public.is_admin_user() OR auth.role() = 'service_role'
    )
    WITH CHECK (
        public.is_admin_user() OR auth.role() = 'service_role'
    );

-- Trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_menutech_automations_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_menutech_automations_updated_at ON public.menutech_automations;
CREATE TRIGGER tr_menutech_automations_updated_at
    BEFORE UPDATE ON public.menutech_automations
    FOR EACH ROW
    EXECUTE FUNCTION update_menutech_automations_timestamp();
