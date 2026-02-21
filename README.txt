New Node project must be initialized:
npm init -y

If using Express, install that next:
npm install express

Start the server:
node server.js

URL:
http://localhost:3001

Next steps:
1. Host on Railway or Render (via Github)
2. Use Postgres (SQL) as backend
3. Rewrite minimal code
4. Separate HTML tables on print (by level)
5. Add back information icon when a match is updated


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






