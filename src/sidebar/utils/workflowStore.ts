/**
 * Workflow Store
 *
 * Fetches pre-built workflow templates from Supabase.
 * Uses in-memory cache with 5-minute TTL.
 */

import { supabase } from './supabaseClient'

// ── Types ──────────────────────────────────────────────────────────

export interface Workflow {
    id: string
    category: string
    title: string
    description: string
    prompt: string
    icon: string
    sort_order: number
}

export interface WorkflowGroup {
    category: string
    workflows: Workflow[]
}

// ── Cache ──────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

let cachedGroups: WorkflowGroup[] | null = null
let cachedAt = 0

// ── Category icons (emoji fallback) ────────────────────────────────

const CATEGORY_EMOJI: Record<string, string> = {
    Shopping: '🛒',
    Productivity: '📋',
    Research: '🔍',
    Social: '📱',
    Media: '🎬',
}

export function getCategoryEmoji(category: string): string {
    return CATEGORY_EMOJI[category] || '⚡'
}

// ── Fetch ──────────────────────────────────────────────────────────

/**
 * Fetch all active workflows from Supabase, grouped by category.
 * Returns cached data if within TTL.
 */
export async function listWorkflows(): Promise<WorkflowGroup[]> {
    // Return cache if fresh
    if (cachedGroups && Date.now() - cachedAt < CACHE_TTL_MS) {
        return cachedGroups
    }

    try {
        const { data, error } = await supabase
            .from('workflows')
            .select('id, category, title, description, prompt, icon, sort_order')
            .eq('is_active', true)
            .order('sort_order', { ascending: true })

        if (error) {
            console.warn('Failed to fetch workflows:', error.message)
            return cachedGroups || []
        }

        // Group by category preserving insertion order
        const groupMap = new Map<string, Workflow[]>()
        for (const row of data || []) {
            const existing = groupMap.get(row.category)
            if (existing) {
                existing.push(row)
            } else {
                groupMap.set(row.category, [row])
            }
        }

        cachedGroups = Array.from(groupMap.entries()).map(([category, workflows]) => ({
            category,
            workflows,
        }))
        cachedAt = Date.now()

        return cachedGroups
    } catch (err) {
        console.warn('Workflow fetch error:', err)
        return cachedGroups || []
    }
}
