# Noita Quest Helper

An AI-powered spoiler-free hint system for Noita quests.

## Setup

1.  Install dependencies:
    ```bash
    npm install
    ```

2.  Create a `.env` file in this directory with your Gemini API key:
    ```env
    GEMINI_API_KEY=your_actual_api_key_here
    PORT=3000
    ```

3.  Run the server:
    ```bash
    npm start
    ```

4.  Open http://localhost:3000 in your browser.

## Development

To run with hot-reloading:
```bash
npm run dev
```

## Structure

- `server.js`: Express backend handling AI requests
- `public/`: Frontend assets
- `data/`: Quest data and context for the AI

