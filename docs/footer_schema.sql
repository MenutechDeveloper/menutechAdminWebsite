-- Create the menutech_footers table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.menutech_footers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    domain TEXT NOT NULL,
    config JSONB DEFAULT '{
        "brand": "",
        "logo": "",
        "address": "",
        "phone": "",
        "fb": "",
        "ig": "",
        "ctaText": "online order",
        "ctaLink": "",
        "bgImage": "",
        "darkBg": true,
        "schedules": "",
        "legal": ""
    }'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.menutech_footers ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view all footers" ON public.menutech_footers FOR SELECT USING (true);
CREATE POLICY "Users can manage their own footer" ON public.menutech_footers FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "CS and adminCS can manage all footers" ON public.menutech_footers FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND UPPER(role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
  )
);
