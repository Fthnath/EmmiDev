/**
 * EmmiDev Weather — AI Weather Assistant
 * Uses Groq API (user provides key in Settings) OR WebLLM (in-browser, no key).
 */

import { CONFIG } from '../config.js';
import { Storage } from '../core/storage.js';
import { AppState } from '../core/state.js';
import { Toast } from '../ui/toast.js';
import { LocationManager } from './locations.js';

class AIModule {
    constructor() {
        this.engine = null;
        this.useWebLLM = false;
        this.history = [];
    }

    init() {
        this.bindUI();
        console.log('[AI] Ready');
    }

    bindUI() {
        const sendBtn = document.getElementById('aiSendBtn');
        const input = document.getElementById('aiInput');
        const voiceBtn = document.getElementById('aiVoiceBtn');

        if (sendBtn) sendBtn.addEventListener('click', () => this.handleSend());
        if (input) input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSend();
            }
        });
        if (voiceBtn) this.wireVoice(voiceBtn);

        // Suggestion chips
        document.querySelectorAll('.ai-suggest-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const q = btn.dataset.q;
                if (q && input) {
                    input.value = q;
                    this.handleSend();
                }
            });
        });
    }

    wireVoice(btn) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            btn.style.display = 'none';
            return;
        }
        const recog = new SpeechRecognition();
        recog.continuous = false;
        recog.interimResults = false;
        recog.lang = Storage.get(CONFIG.STORAGE_KEYS.LANGUAGE, 'en');

        btn.addEventListener('click', () => {
            try { recog.start(); btn.classList.add('listening'); }
            catch (err) { /* already started */ }
        });

        recog.onresult = (e) => {
            const text = e.results[0][0].transcript;
            const input = document.getElementById('aiInput');
            if (input) input.value = text;
            btn.classList.remove('listening');
            this.handleSend();
        };

        recog.onerror = () => btn.classList.remove('listening');
        recog.onend = () => btn.classList.remove('listening');
    }

    async handleSend() {
        const input = document.getElementById('aiInput');
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;

        input.value = '';
        this.addMessage('user', text);
        this.history.push({ role: 'user', content: text });

        const thinking = this.addMessage('bot', 'Thinking...', true);

        try {
            const reply = await this.query(text);
            thinking.remove();
            this.addMessage('bot', reply);
            this.history.push({ role: 'assistant', content: reply });
        } catch (err) {
            thinking.remove();
            console.error('[AI] Error:', err);
            this.addMessage('bot', `Sorry, I couldn't respond: ${err.message}`, false, true);
        }
    }

    async query(userText) {
        const storedKey = Storage.get(CONFIG.STORAGE_KEYS.GROQ_KEY);
        const apiKey = typeof storedKey === 'string' ? storedKey.trim() : '';
        if (!apiKey) {
            throw new Error('No Groq API key. Add one in Settings → Groq API Key.');
        }
        if (!/^[\x20-\x7E]+$/.test(apiKey)) {
            throw new Error('The saved Groq API key contains invalid characters (possibly a masked key). Open Settings, paste the original key, and save it again.');
        }

        const context = this.buildContext();
        const systemPrompt = `You are EmmiDev Weather Assistant, a helpful, friendly AI for African users. You answer questions about weather, farming, health, and travel based on real data provided below.

Current weather context:
${context}

Reply concisely (2-4 sentences) and be practical. If asked about farming, give specific crop advice. If asked about health, mention relevant risks. Never invent weather numbers.`;

        const messages = [
            { role: 'system', content: systemPrompt },
            ...this.history.slice(-8)
        ];

        const res = await fetch(`${CONFIG.GROQ_BASE}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: CONFIG.GROQ_MODEL,
                messages,
                temperature: 0.7,
                max_tokens: 300
            })
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Groq API ${res.status}: ${errText.substring(0, 120)}`);
        }

        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || 'No response.';
    }

    buildContext() {
        const w = AppState.get('currentWeather');
        const loc = LocationManager.getActive();
        if (!w) return 'No current weather data loaded.';

        const cur = w.current;
        const today = w.daily;
        const lines = [
            `Location: ${loc?.name || 'Unknown'}${loc?.country ? ', ' + loc.country : ''}`,
            `Temperature: ${Math.round(cur.temperature_2m)}°C (feels like ${Math.round(cur.apparent_temperature)}°C)`,
            `Condition: ${cur.weather_code} code`,
            `Humidity: ${Math.round(cur.relative_humidity_2m)}%`,
            `Wind: ${cur.wind_speed_10m} km/h`,
            `Cloud cover: ${cur.cloud_cover}%`,
            `Pressure: ${cur.pressure_msl} hPa`,
            `Today high: ${Math.round(today.temperature_2m_max[0])}°C, low: ${Math.round(today.temperature_2m_min[0])}°C`,
            `Rain today: ${today.precipitation_sum?.[0] ?? 0} mm`,
            `UV index: ${today.uv_index_max?.[0] ?? 'N/A'}`
        ];
        return lines.join('\n');
    }

    addMessage(role, text, isLoading = false, isError = false) {
        const container = document.getElementById('aiMessages');
        if (!container) return { remove: () => {} };

        const el = document.createElement('div');
        el.className = `ai-msg ai-msg-${role}${isError ? ' ai-msg-error' : ''}`;

        if (role === 'bot') {
            el.innerHTML = `
                <div class="ai-avatar"><i class="fas fa-robot"></i></div>
                <div class="ai-bubble">${this.esc(text)}${isLoading ? '<span class="ai-typing"><span></span><span></span><span></span></span>' : ''}</div>
            `;
        } else {
            el.innerHTML = `
                <div class="ai-bubble">${this.esc(text)}</div>
                <div class="ai-avatar"><i class="fas fa-user"></i></div>
            `;
        }

        container.appendChild(el);
        container.scrollTop = container.scrollHeight;

        return {
            remove: () => el.remove(),
            el
        };
    }

    esc(str) {
        return String(str || '').replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[m]);
    }
}

export const AI = new AIModule();
