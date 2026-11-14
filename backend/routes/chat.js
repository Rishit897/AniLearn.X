'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { generateText } = require('../services/llm');

const SYSTEM_INSTRUCTION = `You are ANI, a friendly and patient AI learning companion for AniLearn.X, an educational anime video platform.
Help students understand school topics (classes 1-12), explain difficult concepts, help with homework,
and explain textbook content. Use simple, clear language. Give examples and simple learning activities
when appropriate. Never make up facts. If you don't know something, say so. Do not generate videos
yourself — you can only suggest that the user turn an answer into an anime learning adventure via the
Create workspace.`;

// POST /api/chat — ANI companion
router.post('/', authenticate, rateLimit.generalLimiter, async (req, res) => {
  const { message, conversationId } = req.body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required.' });
  }
  try {
    const sb = require('../services/storage').getAdmin();

    let convId = conversationId;
    if (convId) {
      const { data: existing } = await sb.from('chat_conversations').select('id').eq('id', convId).eq('user_id', req.user.id).single();
      if (!existing) convId = null;
    }
    if (!convId) {
      const { data: newConv, error: ce } = await sb.from('chat_conversations').insert({ user_id: req.user.id, title: message.trim().slice(0, 60) }).select('id').single();
      if (ce) throw ce;
      convId = newConv.id;
    }

    await sb.from('chat_messages').insert({ conversation_id: convId, user_id: req.user.id, role: 'user', content: message.trim() });

    const { data: history } = await sb.from('chat_messages').select('role, content, created_at').eq('conversation_id', convId).order('created_at', { ascending: true }).limit(20);
    const transcript = (history || []).map(m => `${m.role === 'user' ? 'Student' : 'ANI'}: ${m.content}`).join('\n');

    const reply = await generateText(`${transcript}\nStudent: ${message.trim()}\nANI:`, {
      systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.7, maxOutputTokens: 1024
    });

    await sb.from('chat_messages').insert({ conversation_id: convId, user_id: req.user.id, role: 'assistant', content: reply });

    return res.json({ ok: true, reply, conversationId: convId });
  } catch (err) {
    if (err.name === 'NotConfiguredError') return res.status(503).json({ error: err.message });
    return res.status(500).json({ error: 'Chat failed.', message: err.message });
  }
});

// GET /api/chat/conversations
router.get('/conversations', authenticate, rateLimit.generalLimiter, async (req, res) => {
  try {
    const sb = require('../services/storage').getAdmin();
    const { data, error } = await sb.from('chat_conversations').select('id, title, created_at, updated_at').eq('user_id', req.user.id).order('updated_at', { ascending: false });
    if (error) throw error;
    return res.json({ ok: true, conversations: data || [] });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load conversations.', message: err.message });
  }
});

// GET /api/chat/conversations/:id/messages
router.get('/conversations/:id/messages', authenticate, rateLimit.generalLimiter, async (req, res) => {
  try {
    const sb = require('../services/storage').getAdmin();
    const { data, error } = await sb.from('chat_messages').select('role, content, created_at').eq('conversation_id', req.params.id).eq('user_id', req.user.id).order('created_at', { ascending: true });
    if (error) throw error;
    return res.json({ ok: true, messages: data || [] });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load messages.', message: err.message });
  }
});

module.exports = router;
