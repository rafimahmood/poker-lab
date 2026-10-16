# Poker Lab ♠♥♣♦

An AI poker coach for Texas Hold'em tournament players. It analyses your hands, builds personalised lessons and teaches preflop ranges, so the maths becomes automatic at the table.

**Live demo:** https://pokerlab12.netlify.app

## What it does

- **Preflop ranges:** which hands to play from each seat when it's folded to you, facing a raise, facing a 3-bet or facing an all-in, with a quiz mode.
- **Practice:** play hands against the table with an optional coach that suggests the right action.
- **Hand import and review:** paste PokerStars or GGPoker hand histories. The app parses them, compares your play to the ranges and flags leaks.
- **Personalised lessons:** builds 4–5 short lessons from your own mistakes, each with a rule and quiz questions.
- **Tools:** equity calculator, ICM calculator for final tables, and core game-theory explainers.
- **Results tracker:** log tournaments and home games, with profit by format.

## How it's built

- One self-contained HTML/CSS/JavaScript file with no build step.
- Built with Claude (Anthropic). The AI coaching, lesson building and saved data use the Claude Artifacts runtime (`window.claude`), so they run when the app is opened as a Claude artifact.
- On a normal web host the study tools, ranges, practice and calculators work fully. Saved data and AI features show a notice instead.

## Privacy

No personal hand histories or results are stored in this repo. Each user's data lives in their own browser or Claude workspace.

## Run it

Open `index.html` in a browser, or deploy the folder to any static host (this repo deploys to Netlify).
