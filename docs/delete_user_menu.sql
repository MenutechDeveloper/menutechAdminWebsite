-- SQL Script to safely delete a specific menu from public.menutech_menus
-- without affecting other menus in the database.

-- OPTION 1: Delete menu by User Email (e.g. 'francisco.menutech@gmail.com')
DELETE FROM public.menutech_menus
WHERE user_id IN (
    SELECT id FROM public.profiles WHERE email = 'francisco.menutech@gmail.com'
);

-- OPTION 2: Delete menu by Username (e.g. 'antonio')
DELETE FROM public.menutech_menus
WHERE user_id IN (
    SELECT id FROM public.profiles WHERE LOWER(username) = LOWER('antonio')
);

-- OPTION 3: Delete menu directly by its problematic Slug (e.g. 'restaurant')
DELETE FROM public.menutech_menus
WHERE slug = 'restaurant';
