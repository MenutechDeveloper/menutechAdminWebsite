-- ==============================================================================
-- Migration: Add Superadmin Role, Restaurant Services Controls, and Non-Recursive RLS
-- ==============================================================================

-- 1. Ensure `services_enabled` JSONB column exists on public.profiles
-- Default enables online_payment, promotions, reservations
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS services_enabled JSONB DEFAULT '{"online_payment": true, "promotions": true, "reservations": true}'::jsonb;

-- 2. SECURITY DEFINER Function to check administrative roles without triggering RLS recursion
-- This function runs with the privileges of the creator and bypasses RLS on public.profiles,
-- completely preventing "infinite recursion detected in policy for relation profiles".
CREATE OR REPLACE FUNCTION public.is_admin_or_superadmin(user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    user_role text;
BEGIN
    IF user_id IS NULL THEN
        RETURN false;
    END IF;

    SELECT role INTO user_role
    FROM public.profiles
    WHERE id = user_id;

    RETURN UPPER(COALESCE(user_role, '')) IN ('ADMIN', 'SUPERADMIN', 'DEVELOPER');
END;
$$;

-- Grant execution to authenticated and anon users
GRANT EXECUTE ON FUNCTION public.is_admin_or_superadmin(uuid) TO authenticated, anon;

-- 3. Update public.profiles RLS policies
-- Users can always read/write their own profile, while admins and superadmins can manage all profiles
DROP POLICY IF EXISTS "Superadmin and Admins can manage all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can read/update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view and update all profiles" ON public.profiles;

CREATE POLICY "Superadmin and Admins can manage all profiles"
ON public.profiles
FOR ALL
TO authenticated
USING (
    auth.uid() = id OR public.is_admin_or_superadmin(auth.uid())
)
WITH CHECK (
    auth.uid() = id OR public.is_admin_or_superadmin(auth.uid())
);

-- 4. menutech_payment_logs table policies
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'menutech_payment_logs') THEN
        DROP POLICY IF EXISTS "Admins and Superadmins can view all payment logs" ON public.menutech_payment_logs;
        CREATE POLICY "Admins and Superadmins can view all payment logs"
        ON public.menutech_payment_logs
        FOR ALL
        TO authenticated
        USING (
            auth.uid() = user_id OR public.is_admin_or_superadmin(auth.uid())
        )
        WITH CHECK (
            auth.uid() = user_id OR public.is_admin_or_superadmin(auth.uid())
        );
    END IF;
END $$;

-- 5. menutech_orders table policies
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'menutech_orders') THEN
        DROP POLICY IF EXISTS "Admins and Superadmins can view all orders" ON public.menutech_orders;
        CREATE POLICY "Admins and Superadmins can view all orders"
        ON public.menutech_orders
        FOR ALL
        TO authenticated
        USING (
            auth.uid() = user_id OR public.is_admin_or_superadmin(auth.uid())
        )
        WITH CHECK (
            auth.uid() = user_id OR public.is_admin_or_superadmin(auth.uid())
        );
    END IF;
END $$;

-- 6. menutech_reservations table policies
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'menutech_reservations') THEN
        DROP POLICY IF EXISTS "Admins and Superadmins can view all reservations" ON public.menutech_reservations;
        CREATE POLICY "Admins and Superadmins can view all reservations"
        ON public.menutech_reservations
        FOR ALL
        TO authenticated
        USING (
            auth.uid() = user_id OR public.is_admin_or_superadmin(auth.uid())
        )
        WITH CHECK (
            auth.uid() = user_id OR public.is_admin_or_superadmin(auth.uid())
        );
    END IF;
END $$;

-- 7. menutech_packages policies
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'menutech_packages') THEN
        DROP POLICY IF EXISTS "Admins and Superadmins can manage packages" ON public.menutech_packages;
        CREATE POLICY "Admins and Superadmins can manage packages"
        ON public.menutech_packages
        FOR ALL
        TO authenticated
        USING (
            public.is_admin_or_superadmin(auth.uid())
        )
        WITH CHECK (
            public.is_admin_or_superadmin(auth.uid())
        );
    END IF;
END $$;

-- 8. menutech_subscriptions policies
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'menutech_subscriptions') THEN
        DROP POLICY IF EXISTS "Admins and Superadmins can manage subscriptions" ON public.menutech_subscriptions;
        CREATE POLICY "Admins and Superadmins can manage subscriptions"
        ON public.menutech_subscriptions
        FOR ALL
        TO authenticated
        USING (
            auth.uid() = user_id OR public.is_admin_or_superadmin(auth.uid())
        )
        WITH CHECK (
            auth.uid() = user_id OR public.is_admin_or_superadmin(auth.uid())
        );
    END IF;
END $$;

-- 9. menutech_subscription_payments policies
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'menutech_subscription_payments') THEN
        DROP POLICY IF EXISTS "Admins and Superadmins can manage subscription payments" ON public.menutech_subscription_payments;
        CREATE POLICY "Admins and Superadmins can manage subscription payments"
        ON public.menutech_subscription_payments
        FOR ALL
        TO authenticated
        USING (
            auth.uid() = user_id OR public.is_admin_or_superadmin(auth.uid())
        )
        WITH CHECK (
            auth.uid() = user_id OR public.is_admin_or_superadmin(auth.uid())
        );
    END IF;
END $$;

-- 10. menutech_restaurant_payment_configs policies
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'menutech_restaurant_payment_configs') THEN
        DROP POLICY IF EXISTS "Admins and Superadmins can manage payment configs" ON public.menutech_restaurant_payment_configs;
        CREATE POLICY "Admins and Superadmins can manage payment configs"
        ON public.menutech_restaurant_payment_configs
        FOR ALL
        TO authenticated
        USING (
            auth.uid() = user_id OR public.is_admin_or_superadmin(auth.uid())
        )
        WITH CHECK (
            auth.uid() = user_id OR public.is_admin_or_superadmin(auth.uid())
        );
    END IF;
END $$;
