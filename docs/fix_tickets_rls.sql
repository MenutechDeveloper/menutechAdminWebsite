-- SQL Fix for Ticket Configuration RLS in Menutech
-- This script allows administrators to manage any restaurant's ticket design.
-- Run this in your Supabase SQL Editor.

-- 1. Enable RLS on the table if it's not already enabled
ALTER TABLE public.menutech_tickets ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing restrictive policies to replace them with management-aware ones
-- We use a DO block to safely handle existing policies
DO $$
BEGIN
    DROP POLICY IF EXISTS "Users can view their own ticket config" ON public.menutech_tickets;
    DROP POLICY IF EXISTS "Users can insert their own ticket config" ON public.menutech_tickets;
    DROP POLICY IF EXISTS "Users can update their own ticket config" ON public.menutech_tickets;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 3. Create Comprehensive Management Policy
-- Allows owners to see/edit their own, and admins to see/edit all.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'menutech_tickets'
        AND policyname = 'Ticket management access'
    ) THEN
        CREATE POLICY "Ticket management access" ON public.menutech_tickets
        FOR ALL
        TO authenticated
        USING (
            auth.uid() = user_id OR
            EXISTS (
                SELECT 1 FROM public.profiles
                WHERE profiles.id = auth.uid()
                AND (
                    UPPER(profiles.role) = 'ADMIN' OR
                    UPPER(profiles.role) = 'DEVELOPER' OR
                    UPPER(profiles.role) = 'ADMINCS' OR
                    UPPER(profiles.role) = 'CS'
                )
            )
        )
        WITH CHECK (
            auth.uid() = user_id OR
            EXISTS (
                SELECT 1 FROM public.profiles
                WHERE profiles.id = auth.uid()
                AND (
                    UPPER(profiles.role) = 'ADMIN' OR
                    UPPER(profiles.role) = 'DEVELOPER' OR
                    UPPER(profiles.role) = 'ADMINCS' OR
                    UPPER(profiles.role) = 'CS'
                )
            )
        );
    END IF;
END $$;

-- 4. Notify PostgREST to reload the schema
NOTIFY pgrst, 'reload schema';
