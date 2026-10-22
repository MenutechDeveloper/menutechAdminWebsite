-- SQL Schema Migration: Ensure updated_at column on menutech_menus table
ALTER TABLE public.menutech_menus
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Function to handle updated_at automatic update
CREATE OR REPLACE FUNCTION public.handle_menus_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on UPDATE
DROP TRIGGER IF EXISTS tr_menutech_menus_updated_at ON public.menutech_menus;
CREATE TRIGGER tr_menutech_menus_updated_at
BEFORE UPDATE ON public.menutech_menus
FOR EACH ROW
EXECUTE FUNCTION public.handle_menus_updated_at();
