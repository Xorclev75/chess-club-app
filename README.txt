New Node project must be initialized:
npm init -y

If using Express, install that next:
npm install express

Start the server:
node server.js

Push to Github:
git status
git add .
git commit -m "update"
git push origin main


URL:
https://chess-club-app-6112.onrender.com

Check Health:
https://chess-club-app-6112.onrender.com/health

Next steps:
1. Time code is weird (2026-02-26T00:00:00.000Z, why do we have to enter it when editing a match?)

to_char(m.match_date, 'YYYY-MM-DD') AS "date"


2. Delete button not working (it works but there's a delay)
3. Cannot save changes to Players either (it works but there's a delay)
4. Separate HTML tables on print (by level)
5. Add back information icon when a match is updated
6. Score is weird: 0.00
7. No favicon


SQL Notes:

Install dependency:
npm install pg

Environment variable

Set: (done)

DATABASE_URL=postgres://user:pass@host:port/dbname

(When you host on Render/Railway/Supabase, they give you this.)

Add to program.json:  (where?)

"scripts": {
  "start": "node server.js",
  "dev": "nodemon server.js"
}








