import { MT_CONFIG } from "./config.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

export const supabase = createClient(
  MT_CONFIG.SUPABASE_URL,
  MT_CONFIG.SUPABASE_KEY
);
