-- Table to store ticket design configuration for each user
CREATE TABLE IF NOT EXISTS public.menutech_tickets (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    domain TEXT,
    config JSONB NOT NULL DEFAULT '{
        "header_text": "MENUTECH",
        "footer_text": "Thank you for your order!\nPowered by Menutech",
        "show_logo": true
    }'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id)
);

-- Enable RLS
ALTER TABLE public.menutech_tickets ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own ticket config"
ON public.menutech_tickets FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own ticket config"
ON public.menutech_tickets FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ticket config"
ON public.menutech_tickets FOR UPDATE
USING (auth.uid() = user_id);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.menutech_tickets;
