/**
 * Project Store
 *
 * CRUD operations for project contexts + URL auto-matching.
 * Projects are persisted in Supabase for authenticated users.
 * Uses in-memory cache with 5-minute TTL.
 */

import { supabase } from './supabaseClient'
import { getUser } from './auth'

// ── Types ──────────────────────────────────────────────────────────

export interface Project {
    id: string
    name: string
    icon: string
    urlPatterns: string[]
    instructions: string
    isActive: boolean
    createdAt: number
    updatedAt: number
}

// ── Cache ──────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

let cachedProjects: Project[] | null = null
let cachedAt = 0

function invalidateCache() {
    cachedProjects = null
    cachedAt = 0
}

// ── CRUD ───────────────────────────────────────────────────────────

/**
 * Create a new project context.
 */
export async function createProject(
    name: string,
    urlPatterns: string[],
    instructions: string,
    icon = '📁'
): Promise<Project> {
    const user = await getUser()
    if (!user) throw new Error('Must be signed in to create projects')

    const { data, error } = await supabase
        .from('projects')
        .insert({
            user_id: user.id,
            name,
            icon,
            url_patterns: urlPatterns,
            instructions,
        })
        .select('id, name, icon, url_patterns, instructions, is_active, created_at, updated_at')
        .single()

    if (error) throw new Error(`Failed to create project: ${error.message}`)

    invalidateCache()
    return mapRow(data)
}

/**
 * Update an existing project.
 */
export async function updateProject(
    id: string,
    patch: Partial<Pick<Project, 'name' | 'icon' | 'urlPatterns' | 'instructions' | 'isActive'>>
): Promise<void> {
    const user = await getUser()
    if (!user) return

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (patch.name !== undefined) updates.name = patch.name
    if (patch.icon !== undefined) updates.icon = patch.icon
    if (patch.urlPatterns !== undefined) updates.url_patterns = patch.urlPatterns
    if (patch.instructions !== undefined) updates.instructions = patch.instructions
    if (patch.isActive !== undefined) updates.is_active = patch.isActive

    const { error } = await supabase
        .from('projects')
        .update(updates)
        .eq('id', id)

    if (error) console.warn('Failed to update project:', error.message)
    invalidateCache()
}

/**
 * Delete a project.
 */
export async function deleteProject(id: string): Promise<void> {
    const user = await getUser()
    if (!user) return

    const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id)

    if (error) console.warn('Failed to delete project:', error.message)
    invalidateCache()
}

/**
 * List all projects for the current user.
 */
export async function listProjects(): Promise<Project[]> {
    const user = await getUser()
    if (!user) return []

    // Return cache if fresh
    if (cachedProjects && Date.now() - cachedAt < CACHE_TTL_MS) {
        return cachedProjects
    }

    const { data, error } = await supabase
        .from('projects')
        .select('id, name, icon, url_patterns, instructions, is_active, created_at, updated_at')
        .order('updated_at', { ascending: false })

    if (error) {
        console.warn('Failed to list projects:', error.message)
        return cachedProjects || []
    }

    cachedProjects = (data || []).map(mapRow)
    cachedAt = Date.now()
    return cachedProjects
}

// ── URL Auto-Matching ──────────────────────────────────────────────

/**
 * Find the first active project whose URL patterns match the given URL.
 * Patterns use * as wildcards (e.g. "*github.com*", "*jira.*").
 */
export async function matchProject(url: string): Promise<Project | null> {
    if (!url) return null

    const projects = await listProjects()
    for (const project of projects) {
        if (!project.isActive) continue
        for (const pattern of project.urlPatterns) {
            try {
                const regex = new RegExp(pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'), 'i')
                if (regex.test(url)) return project
            } catch {
                // Invalid pattern — skip
            }
        }
    }
    return null
}

// ── Helpers ────────────────────────────────────────────────────────

function mapRow(row: any): Project {
    return {
        id: row.id,
        name: row.name,
        icon: row.icon || '📁',
        urlPatterns: row.url_patterns || [],
        instructions: row.instructions || '',
        isActive: row.is_active ?? true,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
    }
}
