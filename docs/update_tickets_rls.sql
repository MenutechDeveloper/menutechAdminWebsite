-- Update RLS policies for menutech_tickets to allow admins to manage all records
-- This allows the Restaurant Info module to sync data correctly when an admin is switching contexts.

DO $$
BEGIN
    -- Drop existing update policy if it exists to replace it with the unified admin-aware policy
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'menutech_tickets'
        AND policyname = 'Users can update their own ticket config'
    ) THEN
        DROP POLICY "Users can update their own ticket config" ON public.menutech_tickets;
    END IF;

    -- Create a unified policy for SELECT/INSERT/UPDATE that allows owners and admins
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'menutech_tickets'
        AND policyname = 'Admins can manage all ticket configs'
    ) THEN
        CREATE POLICY "Admins can manage all ticket configs"
        ON public.menutech_tickets
        FOR ALL
        USING (
            auth.uid() = user_id OR
            EXISTS (
                SELECT 1 FROM public.profiles
                WHERE id = auth.uid()
                AND role IN ('admin', 'developer', 'adminCS', 'CS')
            )
        )
        WITH CHECK (
            auth.uid() = user_id OR
            EXISTS (
                SELECT 1 FROM public.profiles
                WHERE id = auth.uid()
                AND role IN ('admin', 'developer', 'adminCS', 'CS')
            )
        );
    END IF;
END $$;
