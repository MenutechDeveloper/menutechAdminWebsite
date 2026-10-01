-- Schema for Apify Scraped Restaurants (Menutech Extractor)
-- Enable uuid-ossp extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: public.menutech_scraped_restaurants
CREATE TABLE IF NOT EXISTS public.menutech_scraped_restaurants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    address TEXT DEFAULT '',
    city TEXT DEFAULT 'Desconocida',
    zipcode TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    hours TEXT DEFAULT '',
    website TEXT DEFAULT '',
    is_called BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'crap')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_scraped_restaurant_title_city UNIQUE (title, city)
);

-- Index for fast queries by status and city
CREATE INDEX IF NOT EXISTS idx_scraped_restaurants_status ON public.menutech_scraped_restaurants(status);
CREATE INDEX IF NOT EXISTS idx_scraped_restaurants_city ON public.menutech_scraped_restaurants(city);
CREATE INDEX IF NOT EXISTS idx_scraped_restaurants_is_called ON public.menutech_scraped_restaurants(is_called);

-- Enable RLS
ALTER TABLE public.menutech_scraped_restaurants ENABLE ROW LEVEL SECURITY;

-- Policy: Allow full read and write access for all users
DROP POLICY IF EXISTS "Allow full access for menutech_scraped_restaurants" ON public.menutech_scraped_restaurants;
CREATE POLICY "Allow full access for menutech_scraped_restaurants" ON public.menutech_scraped_restaurants
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_scraped_restaurants_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_scraped_restaurants_updated_at ON public.menutech_scraped_restaurants;
CREATE TRIGGER tr_scraped_restaurants_updated_at
    BEFORE UPDATE ON public.menutech_scraped_restaurants
    FOR EACH ROW
    EXECUTE FUNCTION update_scraped_restaurants_timestamp();
