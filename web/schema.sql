-- SQL Schema for Menutech Admin Website Module

-- 1. Profiles Table
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    username TEXT,
    domain TEXT,
    role TEXT DEFAULT 'owner',
    gallery_type TEXT DEFAULT 'grid',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Gallery Table
CREATE TABLE public.galeria (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    domain TEXT,
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Promotions Table
CREATE TABLE public.promos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    event_type TEXT NOT NULL, -- 'christmas', 'halloween', 'valentine', 'president'
    image_url TEXT,
    start_date DATE,
    end_date DATE,
    display_mode TEXT DEFAULT 'popup', -- 'popup' or 'section'
    is_active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, event_type)
);

-- 4. Developer Access Table (Optional: for admins to assign owners to developers)
CREATE TABLE public.developer_access (
    developer_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    PRIMARY KEY (developer_id, owner_id)
);

-- --- INDEXES ---
CREATE INDEX IF NOT EXISTS idx_profiles_domain ON public.profiles(domain);
CREATE INDEX IF NOT EXISTS idx_galeria_domain ON public.galeria(domain);
CREATE INDEX IF NOT EXISTS idx_galeria_user_id ON public.galeria (user_id);

-- --- RLS POLICIES ---

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.galeria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.developer_access ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Public read access for profiles by domain" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Admins can update roles" ON public.profiles FOR UPDATE TO authenticated USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin') WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- Galeria Policies
CREATE POLICY "Public read access for galeria" ON public.galeria FOR SELECT USING (true);
CREATE POLICY "Management access for galeria" ON public.galeria FOR ALL USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND (profiles.role = 'admin' OR profiles.role = 'developer')));

-- Promos Policies
CREATE POLICY "Public read access for promos" ON public.promos FOR SELECT USING (true);
CREATE POLICY "Promo management access" ON public.promos FOR ALL USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND (profiles.role = 'admin' OR profiles.role = 'developer')));

-- --- TRIGGERS ---

-- Automatic Synchronization Trigger for Profiles from Auth.Users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, username, domain, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', 'No Username'),
    NEW.raw_user_meta_data->>'domain',
    'owner'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    username = EXCLUDED.username,
    domain = EXCLUDED.domain;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-create the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5. Forms Table
CREATE TABLE public.menutech_forms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- 6. Form Responses Table
CREATE TABLE public.menutech_forms_respuestas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    form_id UUID REFERENCES public.menutech_forms(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    respuestas JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- --- INDEXES ---
CREATE INDEX IF NOT EXISTS idx_forms_domain ON public.menutech_forms(domain);
CREATE INDEX IF NOT EXISTS idx_responses_form_id ON public.menutech_forms_respuestas(form_id);

-- --- RLS POLICIES ---

ALTER TABLE public.menutech_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menutech_forms_respuestas ENABLE ROW LEVEL SECURITY;

-- Forms Policies
CREATE POLICY "Public read access for forms" ON public.menutech_forms FOR SELECT USING (true);
CREATE POLICY "Management access for forms" ON public.menutech_forms FOR ALL USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND (profiles.role = 'admin' OR profiles.role = 'developer')));

-- Responses Policies
CREATE POLICY "Public insert access for responses" ON public.menutech_forms_respuestas FOR INSERT WITH CHECK (true);
CREATE POLICY "Management access for responses" ON public.menutech_forms_respuestas FOR SELECT USING (EXISTS (SELECT 1 FROM public.menutech_forms WHERE menutech_forms.id = form_id AND (menutech_forms.user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND (profiles.role = 'admin' OR profiles.role = 'developer')))));
