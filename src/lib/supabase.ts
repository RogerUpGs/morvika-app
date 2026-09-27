import { createClient } from '@supabase/supabase-js';

// Den publiserbare nøkkelen er laget for å ligge i appen. Tilgangen styres
// av reglene i databasen (RLS), ikke av at nøkkelen er hemmelig.
// Kan overstyres med VITE_SUPABASE_URL og VITE_SUPABASE_PUBLISHABLE_KEY.
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://eumareoqjwhkgpbporpm.supabase.co';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_XUTOQE6Yk-mqTwvxFH0YYQ_BVGf6E0x';

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
