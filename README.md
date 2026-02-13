# PageClick ✨

AI-powered Chrome extension with a sleek sidebar UI. Ask questions, get instant answers — powered by multiple AI models.

![Dark Theme](https://img.shields.io/badge/theme-dark-1a1b1e?style=flat-square)
![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react)
![Vite](https://img.shields.io/badge/Vite-6-646cff?style=flat-square&logo=vite)
![Supabase](https://img.shields.io/badge/Supabase-Edge_Functions-3ecf8e?style=flat-square&logo=supabase)

## Features

- 🧠 **Dual AI Models** — Switch between **Kimi K2.5** (NVIDIA) and **GPT-OSS-20B** (Groq) via dropdown
- 💬 **Streaming Chat** — Real-time token-by-token responses with SSE
- 🎨 **Dark Sidebar UI** — Perplexity-inspired design with smooth animations
- ⚡ **Fast** — Groq LPU inference for sub-second TTFB

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite |
| Styling | Vanilla CSS (Inter font, glassmorphism) |
| Backend | Supabase Edge Functions (Deno) |
| AI Models | NVIDIA API (Kimi K2.5), Groq API (GPT-OSS-20B) |
| Extension | Chrome Manifest V3, Side Panel API |

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project with `KIMI_API_KEY` and `GROQ_API_KEY` in Edge Function secrets

### Install & Dev

```bash
git clone https://github.com/RahulMirji/PageClick.git
cd PageClick
npm install
npm run dev
```

### Build for Chrome

```bash
npm run build
```

Then load `dist/` as an unpacked extension in `chrome://extensions`.

## Project Structure

```
PageClick/
├── public/
│   └── manifest.json          # Chrome extension manifest
├── src/
│   ├── background.ts          # Service worker (side panel)
│   └── sidebar/
│       ├── App.tsx             # Main app with chat logic
│       ├── components/
│       │   ├── SearchBox.tsx   # Input + model selector dropdown
│       │   ├── ChatView.tsx    # Message bubbles + streaming
│       │   ├── Header.tsx      # Top bar with search
│       │   ├── Logo.tsx        # Centered PageClick logo
│       │   └── BottomNav.tsx   # Navigation tabs
│       └── styles/
│           └── index.css       # Full dark theme stylesheet
├── sidebar.html                # Extension side panel entry
└── vite.config.ts              # Build config
```

## Architecture

```
User ──▶ SearchBox (model selector) ──▶ App.tsx
                                          │
                                    fetch POST /chat
                                    { model, messages }
                                          │
                              Supabase Edge Function
                                          │
                        ┌─────────────────┼─────────────────┐
                        ▼                                   ▼
                  NVIDIA API                           Groq API
               (Kimi K2.5)                         (GPT-OSS-20B)
                        │                                   │
                        └──────── SSE Stream ───────────────┘
                                      │
                                 ChatView.tsx
                            (token-by-token render)
```

## License

MIT
