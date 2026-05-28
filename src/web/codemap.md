# src/web/

## Responsibility
Single-page web application (Memory Explorer) for browsing, searching, editing, and managing memories and user profiles via the server API.

## Design
- Vanilla JavaScript SPA — no framework. `app.js` is the main application (~1800 lines).
- Uses CDN dependencies: Lucide icons, Marked.js (markdown rendering), DOMPurify (sanitization), jsonrepair
- `i18n.js` provides internationalization with auto-detection from browser language
- State managed in a global `state` object
- All API calls go through `fetchAPI()` which adds auth headers

## Key Features
- Memory browsing with pagination, tag filtering, full-text search
- Combined card view pairing prompts with their generated memories
- Bulk selection and delete operations
- Memory pinning/unpinning
- User profile dashboard (preferences, patterns, workflows) with confidence visualization
- Profile changelog history
- Settings panel for API key configuration and profile selection
- Migration status bar for tag migration progress
- Auto-refresh every 30 seconds
- Maintenance actions: cleanup (old memories), deduplication

## Flow
1. `DOMContentLoaded` → check auth → `loadTags()` + `loadMemories()` + `loadStats()`
2. User interactions → API calls → re-render affected DOM sections
3. Profile sheet: slide-in panel → `loadUserProfile()` → render preferences/patterns/workflows

## Integration
- Served by: `src/services/web-server.ts` (static file serving)
- Communicates with: All `/api/*` endpoints on the server
