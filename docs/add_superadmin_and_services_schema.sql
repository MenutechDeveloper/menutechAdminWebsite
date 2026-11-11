-- ==============================================================================
-- Migration: Add Superadmin Role and Restaurant Services Controls
-- ==============================================================================

-- 1. Ensure `services_enabled` JSONB column exists on public.profiles
-- Default enables online_payment, promotions, reservations
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS services_enabled JSONB DEFAULT '{"online_payment": true, "promotions": true, "reservations": true}'::jsonb;

-- 2. Update RLS policies to recognize 'superadmin' alongside 'admin' and 'developer'

-- Helper condition check for privileged roles in policies:
-- (UPPER(role) IN ('ADMIN', 'SUPERADMIN', 'DEVELOPER', 'CS', 'ADMINCS'))

-- profiles table policies
DROP POLICY IF EXISTS "Superadmin and Admins can manage all profiles" ON public.profiles;
CREATE POLICY "Superadmin and Admins can manage all profiles"
ON public.profiles
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
        AND UPPER(p.role) IN ('ADMIN', 'SUPERADMIN', 'DEVELOPER')
    )
    OR auth.uid() = id
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
        AND UPPER(p.role) IN ('ADMIN', 'SUPERADMIN', 'DEVELOPER')
    )
    OR auth.uid() = id
);

-- menutech_payment_logs table policies
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'menutech_payment_logs') THEN
        DROP POLICY IF EXISTS "Admins and Superadmins can view all payment logs" ON public.menutech_payment_logs;
        CREATE POLICY "Admins and Superadmins can view all payment logs"
        ON public.menutech_payment_logs
        FOR ALL
        TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid()
                AND UPPER(p.role) IN ('ADMIN', 'SUPERADMIN', 'DEVELOPER')
            )
            OR auth.uid() = user_id
        )
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid()
                AND UPPER(p.role) IN ('ADMIN', 'SUPERADMIN', 'DEVELOPER')
            )
            OR auth.uid() = user_id
        );
    END IF;
END $$;

-- menutech_orders table policies
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'menutech_orders') THEN
        DROP POLICY IF EXISTS "Admins and Superadmins can view all orders" ON public.menutech_orders;
        CREATE POLICY "Admins and Superadmins can view all orders"
        ON public.menutech_orders
        FOR ALL
        TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid()
                AND UPPER(p.role) IN ('ADMIN', 'SUPERADMIN', 'DEVELOPER')
            )
            OR auth.uid() = user_id
        )
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid()
                AND UPPER(p.role) IN ('ADMIN', 'SUPERADMIN', 'DEVELOPER')
            )
            OR auth.uid() = user_id
        );
    END IF;
END $$;

-- menutech_reservations table policies
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'menutech_reservations') THEN
        DROP POLICY IF EXISTS "Admins and Superadmins can view all reservations" ON public.menutech_reservations;
        CREATE POLICY "Admins and Superadmins can view all reservations"
        ON public.menutech_reservations
        FOR ALL
        TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid()
                AND UPPER(p.role) IN ('ADMIN', 'SUPERADMIN', 'DEVELOPER')
            )
            OR auth.uid() = user_id
        )
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid()
                AND UPPER(p.role) IN ('ADMIN', 'SUPERADMIN', 'DEVELOPER')
            )
            OR auth.uid() = user_id
        );
    END IF;
END $$;

-- menutech_packages policies
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'menutech_packages') THEN
        DROP POLICY IF EXISTS "Admins and Superadmins can manage packages" ON public.menutech_packages;
        CREATE POLICY "Admins and Superadmins can manage packages"
        ON public.menutech_packages
        FOR ALL
        TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid()
                AND UPPER(p.role) IN ('ADMIN', 'SUPERADMIN', 'DEVELOPER')
            )
        )
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid()
                AND UPPER(p.role) IN ('ADMIN', 'SUPERADMIN', 'DEVELOPER')
            )
        );
    END IF;
END $$;

-- menutech_subscriptions policies
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'menutech_subscriptions') THEN
        DROP POLICY IF EXISTS "Admins and Superadmins can manage subscriptions" ON public.menutech_subscriptions;
        CREATE POLICY "Admins and Superadmins can manage subscriptions"
        ON public.menutech_subscriptions
        FOR ALL
        TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid()
                AND UPPER(p.role) IN ('ADMIN', 'SUPERADMIN', 'DEVELOPER')
            )
            OR auth.uid() = user_id
        )
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid()
                AND UPPER(p.role) IN ('ADMIN', 'SUPERADMIN', 'DEVELOPER')
            )
            OR auth.uid() = user_id
        );
    END IF;
END $$;

-- menutech_subscription_payments policies
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'menutech_subscription_payments') THEN
        DROP POLICY IF EXISTS "Admins and Superadmins can manage subscription payments" ON public.menutech_subscription_payments;
        CREATE POLICY "Admins and Superadmins can manage subscription payments"
        ON public.menutech_subscription_payments
        FOR ALL
        TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid()
                AND UPPER(p.role) IN ('ADMIN', 'SUPERADMIN', 'DEVELOPER')
            )
            OR auth.uid() = user_id
        )
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid()
                AND UPPER(p.role) IN ('ADMIN', 'SUPERADMIN', 'DEVELOPER')
            )
            OR auth.uid() = user_id
        );
    END IF;
END $$;

-- menutech_restaurant_payment_configs policies
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'menutech_restaurant_payment_configs') THEN
        DROP POLICY IF EXISTS "Admins and Superadmins can manage payment configs" ON public.menutech_restaurant_payment_configs;
        CREATE POLICY "Admins and Superadmins can manage payment configs"
        ON public.menutech_restaurant_payment_configs
        FOR ALL
        TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid()
                AND UPPER(p.role) IN ('ADMIN', 'SUPERADMIN', 'DEVELOPER')
            )
            OR auth.uid() = user_id
        )
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM public.profiles p
                WHERE p.id = auth.uid()
                AND UPPER(p.role) IN ('ADMIN', 'SUPERADMIN', 'DEVELOPER')
            )
            OR auth.uid() = user_id
        );
    END IF;
END $$;
