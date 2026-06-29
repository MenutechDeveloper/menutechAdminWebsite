-- Table to store restaurant information
CREATE TABLE IF NOT EXISTS public.menutech_restaurants (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT,
    owner_name TEXT,
    logo_url TEXT,
    phone TEXT,
    address TEXT,
    social_media JSONB DEFAULT '[]'::jsonb,
    schedule JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id)
);

-- Enable RLS
ALTER TABLE public.menutech_restaurants ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own restaurant info"
ON public.menutech_restaurants FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own restaurant info"
ON public.menutech_restaurants FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own restaurant info"
ON public.menutech_restaurants FOR UPDATE
USING (auth.uid() = user_id);

-- Admins and CS roles can manage everything
CREATE POLICY "Privileged roles can manage all restaurants"
ON public.menutech_restaurants FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
    )
);
