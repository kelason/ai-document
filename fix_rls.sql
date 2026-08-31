-- Run this in your Supabase SQL Editor (https://app.supabase.com)
-- Project: tqbeneuvjeomwymjjjen → SQL Editor

-- Step 1: Disable Row Level Security on both tables
ALTER TABLE documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE document_history DISABLE ROW LEVEL SECURITY;
