import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://xikissitwexetetaurnm.supabase.co';
const DEFAULT_SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhpa2lzc2l0d2V4ZXRldGF1cm5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExMjE3MDksImV4cCI6MjA4NjY5NzcwOX0.RaoUV5pYIYZjQRHiFIOQd_8jaM3oAgzqtJkNgRlFczY';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? DEFAULT_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? DEFAULT_SUPABASE_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
