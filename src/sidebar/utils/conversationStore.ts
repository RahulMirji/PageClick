/**
 * Conversation Store
 *
 * CRUD operations for conversations and messages.
 * - Authenticated users: stored in Supabase (conversations + messages tables)
 * - Unauthenticated users: stored in chrome.storage.local as fallback
 */

import { supabase } from './supabaseClient'
import { getUser } from './auth'
import type { Message } from '../components/ChatView'

// ── Types ──────────────────────────────────────────────────────────

export interface Conversation {
    id: string
    title: string
    createdAt: number
    updatedAt: number
    preview?: string // First user message for display
}

// ── Local Storage Keys ─────────────────────────────────────────────

const LOCAL_CONVERSATIONS_KEY = '__pc_conversations'
const LOCAL_MESSAGES_PREFIX = '__pc_msgs_'

// ── Conversation CRUD ──────────────────────────────────────────────

/**
 * Create a new conversation.
 */
export async function createConversation(title: string): Promise<Conversation> {
    const user = await getUser()

    if (user) {
        // Supabase
        const { data, error } = await supabase
            .from('conversations')
            .insert({ user_id: user.id, title })
            .select('id, title, created_at, updated_at')
            .single()

        if (error) throw new Error(`Failed to create conversation: ${error.message}`)
        return {
            id: data.id,
            title: data.title,
            createdAt: new Date(data.created_at).getTime(),
            updatedAt: new Date(data.updated_at).getTime(),
        }
    }

    // Local fallback
    const conv: Conversation = {
        id: crypto.randomUUID(),
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    }
    const convs = await getLocalConversations()
    convs.unshift(conv)
    await chrome.storage.local.set({ [LOCAL_CONVERSATIONS_KEY]: convs })
    return conv
}

/**
 * List all conversations, newest first.
 */
export async function listConversations(): Promise<Conversation[]> {
    const user = await getUser()

    if (user) {
        const { data, error } = await supabase
            .from('conversations')
            .select('id, title, created_at, updated_at')
            .order('updated_at', { ascending: false })
            .limit(50)

        if (error) {
            console.warn('Failed to list conversations:', error.message)
            return []
        }

        return (data || []).map(c => ({
            id: c.id,
            title: c.title,
            createdAt: new Date(c.created_at).getTime(),
            updatedAt: new Date(c.updated_at).getTime(),
        }))
    }

    return getLocalConversations()
}

/**
 * Delete a conversation and all its messages.
 */
export async function deleteConversation(conversationId: string): Promise<void> {
    const user = await getUser()

    if (user) {
        const { error } = await supabase
            .from('conversations')
            .delete()
            .eq('id', conversationId)
        if (error) console.warn('Failed to delete conversation:', error.message)
        return
    }

    // Local fallback
    const convs = await getLocalConversations()
    const filtered = convs.filter(c => c.id !== conversationId)
    await chrome.storage.local.set({ [LOCAL_CONVERSATIONS_KEY]: filtered })
    await chrome.storage.local.remove(LOCAL_MESSAGES_PREFIX + conversationId)
}

// ── Metadata Encoding ──────────────────────────────────────────────
// We encode planConfirm and taskProgress data into the content field
// using a special prefix so it can be reconstructed on load.

const META_PREFIX = '__PC_META__:'

interface MessageMeta {
    text?: string
    planConfirm?: { summary: string; status: string }
    taskProgress?: { explanation: string; steps: Array<{ description: string; status: string }> }
}

/** Encode message metadata into a storable content string */
export function encodeMessageContent(msg: Message): string {
    const meta: MessageMeta = {}
    let hasExtra = false

    if (msg.planConfirm) {
        meta.planConfirm = { summary: msg.planConfirm.summary, status: msg.planConfirm.status }
        hasExtra = true
    }
    if (msg.taskProgress && msg.taskProgress.steps.length > 0) {
        meta.taskProgress = {
            explanation: msg.taskProgress.explanation,
            steps: msg.taskProgress.steps.map(s => ({ description: s.description, status: s.status })),
        }
        hasExtra = true
    }

    if (!hasExtra) return msg.content

    meta.text = msg.content
    return META_PREFIX + JSON.stringify(meta)
}

/** Decode stored content back into a Message with metadata */
function decodeMessageContent(role: 'user' | 'assistant', content: string, images?: string[]): Message {
    if (!content.startsWith(META_PREFIX)) {
        return { role, content, images }
    }

    try {
        const meta: MessageMeta = JSON.parse(content.slice(META_PREFIX.length))
        const msg: Message = { role, content: meta.text || '', images }

        if (meta.planConfirm) {
            msg.planConfirm = {
                summary: meta.planConfirm.summary,
                status: meta.planConfirm.status as 'approved' | 'rejected' | 'pending',
                onProceed: () => { },
                onReject: () => { },
            }
        }
        if (meta.taskProgress) {
            msg.taskProgress = {
                explanation: meta.taskProgress.explanation,
                steps: meta.taskProgress.steps.map(s => ({
                    description: s.description,
                    status: s.status as 'completed' | 'running' | 'pending' | 'failed',
                })),
            }
        }

        return msg
    } catch {
        return { role, content, images }
    }
}

// ── Message CRUD ───────────────────────────────────────────────────

/**
 * Load all messages for a conversation.
 */
export async function loadMessages(conversationId: string): Promise<Message[]> {
    const user = await getUser()

    if (user) {
        const { data, error } = await supabase
            .from('messages')
            .select('role, content, images, created_at')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true })

        if (error) {
            console.warn('Failed to load messages:', error.message)
            return []
        }

        return (data || []).map(m => decodeMessageContent(
            m.role as 'user' | 'assistant',
            m.content,
            m.images || undefined,
        ))
    }

    // Local fallback
    const raw = await getLocalMessages(conversationId)
    return raw.map(m => decodeMessageContent(m.role, m.content, m.images))
}

/**
 * Save a message to a conversation.
 */
export async function saveMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    images?: string[]
): Promise<void> {
    const user = await getUser()

    if (user) {
        const { error: msgError } = await supabase
            .from('messages')
            .insert({
                conversation_id: conversationId,
                role,
                content,
                images: images || null,
            })
        if (msgError) console.warn('Failed to save message:', msgError.message)

        // Update conversation timestamp + title (use first user msg as title)
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (role === 'user') {
            // Check if this is the first message (update title)
            const { data: existing } = await supabase
                .from('messages')
                .select('id')
                .eq('conversation_id', conversationId)
                .eq('role', 'user')
                .limit(2)

            if (existing && existing.length <= 1) {
                updates.title = content.slice(0, 100)
            }
        }

        await supabase
            .from('conversations')
            .update(updates)
            .eq('id', conversationId)

        return
    }

    // Local fallback
    const msgs = await getLocalMessages(conversationId)
    msgs.push({ role, content, images })
    await chrome.storage.local.set({ [LOCAL_MESSAGES_PREFIX + conversationId]: msgs })

    // Update local conversation
    const convs = await getLocalConversations()
    const conv = convs.find(c => c.id === conversationId)
    if (conv) {
        conv.updatedAt = Date.now()
        if (role === 'user' && conv.title === 'New chat') {
            conv.title = content.slice(0, 100)
        }
        await chrome.storage.local.set({ [LOCAL_CONVERSATIONS_KEY]: convs })
    }
}

// ── Local Storage Helpers ──────────────────────────────────────────

async function getLocalConversations(): Promise<Conversation[]> {
    try {
        const result = await chrome.storage.local.get(LOCAL_CONVERSATIONS_KEY)
        return result[LOCAL_CONVERSATIONS_KEY] || []
    } catch {
        return []
    }
}

async function getLocalMessages(conversationId: string): Promise<Message[]> {
    try {
        const key = LOCAL_MESSAGES_PREFIX + conversationId
        const result = await chrome.storage.local.get(key)
        return result[key] || []
    } catch {
        return []
    }
}
