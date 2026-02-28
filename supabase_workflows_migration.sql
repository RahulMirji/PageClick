-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Creates the workflows table and seeds initial data

-- ── Table ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workflows (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    prompt TEXT NOT NULL,
    icon TEXT DEFAULT 'zap',
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read active workflows"
    ON workflows FOR SELECT
    USING (is_active = true);

CREATE INDEX IF NOT EXISTS idx_workflows_category ON workflows(category, sort_order);

-- ── Seed Data ──────────────────────────────────────────────────────

INSERT INTO workflows (category, title, description, prompt, icon, sort_order) VALUES
-- Shopping
('Shopping', 'Compare prices', 'Find the best deal for this product', 'Compare prices for this product across different sellers on this page', 'tag', 1),
('Shopping', 'Summarize reviews', 'Get a quick overview of customer reviews', 'Summarize the customer reviews for this product highlighting pros and cons', 'star', 2),
('Shopping', 'Find coupon codes', 'Search for discounts and promotions', 'Search this page for any discount codes, promotions, or special offers', 'percent', 3),

-- Productivity
('Productivity', 'Summarize this page', 'Get a concise TL;DR of the page', 'Give me a concise summary of everything on this page', 'file-text', 1),
('Productivity', 'Extract all links', 'List every link on the page', 'Extract all links from this page and list them with their titles', 'link', 2),
('Productivity', 'Fill this form', 'Auto-fill the form on this page', 'Help me fill out the form on this page', 'edit', 3),

-- Research
('Research', 'Fact-check article', 'Verify the main claims', 'Fact-check the main claims in this article and note any that seem questionable', 'check-circle', 1),
('Research', 'Find original source', 'Trace back to the primary source', 'Find the original source or study referenced in this article', 'search', 2),
('Research', 'ELI5 this page', 'Explain it simply', 'Explain this page in simple terms a 5-year-old would understand', 'book-open', 3),

-- Social
('Social', 'Summarize thread', 'Get the gist of the discussion', 'Summarize this thread and highlight the most important points', 'message-circle', 1),
('Social', 'Draft a reply', 'Generate a thoughtful response', 'Draft a thoughtful and engaging reply to this post', 'send', 2),
('Social', 'Extract key points', 'Pull out main arguments', 'What are the key points and arguments being discussed here?', 'list', 3),

-- Media
('Media', 'Summarize video', 'What is this video about?', 'Summarize what this video is about based on the page content', 'play-circle', 1),
('Media', 'List key takeaways', 'Main lessons and insights', 'List the key takeaways from this content', 'award', 2),
('Media', 'Generate timestamps', 'Create a table of contents', 'Generate timestamps for the main topics covered in this video', 'clock', 3);
