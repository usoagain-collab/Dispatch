# Island Dispatch

A web app for dispatching HVAC technicians across islands. It has a separate board for each island, tracks technician travel and time off, stores skills with levels, and has day, week and month views.

## Features

- **A board per island.** Each island has its own tab. A dispatcher only sees the islands their account has access to (admins see all of them).
- **Travel.** Add a trip with a technician, a destination island and a date range. For those dates the tech shows up on the destination island's board and is greyed out ("✈ On Maui") on their home island's board. You can add travel from the board (**✈ Travel / Off**), the tech's profile or the Travel page.
- **Time off.** Marks a tech unavailable. Assigning a job on a day off asks for confirmation.
- **Skills.** Each skill has a level (Trainee, Qualified, Expert) and a category. Jobs list the skills they need. The job form shows which techs on the island that day have the skills and which are missing some, and the board has a filter to show only techs with certain skills.
- **Day, week and month views.**
  - *Day:* a timeline for each tech. Click an empty slot to create a job at that time, or drag a job to change its time or tech. Times snap to 30 minutes.
  - *Week:* a grid of techs by days. Drag a job to another day or tech; it keeps its time of day.
  - *Month:* a calendar showing how many techs are working each day, who arrives or leaves, who is off, and the jobs. Click a day to open it.
- **Unscheduled queue.** Drag a job from the sidebar onto the board to schedule it. Drop a scheduled job on the sidebar to unschedule it.
- **Conflict checks:**
  - The app blocks assigning a tech to a job on an island they aren't on that day.
  - It warns about double-booking and missing skills.
  - If travel changes or is deleted and a job no longer matches where the tech is, the job is flagged in a **⚠ Needs attention** list.
- **Keyboard shortcuts:** `D`/`W`/`M` switch views, `←`/`→` move through dates, `T` jumps to today, `N` creates a job, and `1`–`9` switch islands.
- **Roles.** Admins manage users, islands and skills. Dispatchers can edit jobs, techs and travel on their islands. Viewers are read-only.

## Getting started

Requires Node.js 22.13 or newer. The app uses the SQLite built into Node, so there is no separate database to install.

```bash
npm install
npm run seed      # optional: load demo islands, techs, travel and jobs
npm run dev       # API on :3001 + UI on http://localhost:5173
```

Demo logins (after `npm run seed`):

| User       | Password      | Sees                    |
|------------|---------------|-------------------------|
| `admin`    | `changeme123` | All islands + Settings  |
| `oahu`     | `dispatch123` | Oahu only               |
| `neighbor` | `dispatch123` | Maui, Big Island, Kauai |

The first time the server starts on an empty database, it creates an `admin` user. The password comes from `ADMIN_PASSWORD`, or is `changeme123` if that isn't set. Change it after signing in.

## Production

```bash
npm run build
npm start         # serves the API and the built UI on $PORT (default 3001)
```

Or with Docker:

```bash
docker build -t island-dispatch .
docker run -p 3001:3001 -v dispatch-data:/data -e ADMIN_PASSWORD=... island-dispatch
```

| Variable         | Default            | Purpose                                       |
|------------------|--------------------|-----------------------------------------------|
| `PORT`           | `3001`             | HTTP port                                     |
| `DB_FILE`        | `data/dispatch.db` | SQLite database file                          |
| `ADMIN_PASSWORD` | `changeme123`      | Password for the first admin (first run only) |
| `COOKIE_SECURE`  | unset              | Set to `1` when served over HTTPS             |

Back up the database by copying `DB_FILE`. The server uses WAL mode, so copy the `-wal` file along with it, or run `sqlite3 dispatch.db ".backup backup.db"`.

## Development

```bash
npm test          # API + scheduling logic tests
npm run typecheck # TypeScript check of the UI
```

- `server/`: the Express API. `location.js` has the rule for where a tech is working on a given day, and `app.js` has the routes and validation.
- `client/src/`: the React UI. `pages/Board.tsx` is the dispatch board, and the three views are in `components/`.
