# 🌍🦊 WorldQuest

> A tiny planet that grows with your travels, tended by a fox who waits for the stories you bring back.

Built for **SuperAI NEXT Hackathon · Singapore 2026**.

## What it is

WorldQuest turns photos you take on the go into **3D models on a living planet**.
Snap a kaya toast or a Merlion → an AI fox identifies it, tells you the deep
local context, and adds a low-poly model to your planet's surface. Over time
the planet evolves, the fox writes Tabikaeru-style diary entries, and you can
share a 1080×1350 card of "today's finds" with one tap.

## The agent stack

Six specialized agents, orchestrated through a single planet context:

| Agent | Role |
|---|---|
| 🧠 Orchestrator | Routes user input (message / photo / task / landmark) |
| ✈️ Planner | SG local-guide brain — builds 30-90 min quests with depthAngle, time window, duration |
| 👁️ Vision | Qwen-VL-Max — identifies into 1 of 20 categories + structured details |
| 📖 Story | Generates Insight (deep historical / cultural / data context) in the fox's voice |
| 🎁 Sponsor | Opportunistically injects real sponsored quests when keywords match |
| 🦊 Fox Life | Tabikaeru-style autonomous loop — the fox picks an activity, writes a diary |

## Key features

- True 3D globe — quaternion trackball, 360° free rotation, momentum + idle drift
- Spherical non-overlap placement (great-circle spiral search)
- 20 hand-coded low-poly Three.js models (noodle bowl, fish, butterfly, temple dome, MBS triple-tower, kopi mug…)
- Context-aware Vision prompts with codex de-dupe + 3-stage resilient JSON parser
- Pure-Canvas 1080×1350 share card with planet ID, level, today's stats
- 100 % localStorage — no backend storage, no accounts

## Tech stack

- **Three.js r128** — 3D planet rendering
- **Qwen-VL-Max** — vision identification
- **Qwen-Max** — planner, story, sponsor, fox-life agents
- **Vanilla JS** — no framework
- **Express** — tiny proxy for the AI provider
- **localStorage** — per-browser persistence

## Run locally

```bash
git clone <this-repo>
cd HackathonDay1
npm install
cp .env.example .env       # then add your QWEN_API_KEY
npm start                  # http://localhost:3000
```

Get a key at <https://dashscope.console.aliyun.com>.

## Submission

- **Live demo**: _(to be deployed)_
- **Slides**: `slides.html` (HTML) — final PowerPoint generated for stage
- **Hackathon**: [SuperAI NEXT Hackathon · DoraHacks](https://dorahacks.io/hackathon/next-hackathon/detail)
