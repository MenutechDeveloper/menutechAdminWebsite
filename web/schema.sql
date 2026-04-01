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
