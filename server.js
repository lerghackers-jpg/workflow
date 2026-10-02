require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(express.static('public'));

// SQL database (SQLite file). Swap for MySQL/Postgres later if needed.
const db = new Database('business.db');
db.exec(`CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  company TEXT, interest TEXT, message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
const insert = db.prepare(
  'INSERT INTO leads (name,email,company,interest,message) VALUES (?,?,?,?,?)'
);

// Email (optional: works if SMTP vars are set)
const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: +process.env.SMTP_PORT || 587,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
}) : null;

const recent = new Map(); // simple rate limit per IP
app.post('/api/signup', async (req, res) => {
  const ip = req.ip, now = Date.now();
  if (now - (recent.get(ip) || 0) < 5000) return res.sendStatus(429);
  recent.set(ip, now);

  const { name, email, company, interest, message, website } = req.body || {};
  if (website) return res.sendStatus(200); // honeypot: bots fill this
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) return res.sendStatus(400);

  try {
    insert.run(name, email, company || '', interest || '', message || '');
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.sendStatus(200); // already signed up
    console.error(e); return res.sendStatus(500);
  }

  // Discord webhook (URL stays on the server, never in the page)
  if (process.env.DISCORD_WEBHOOK_URL) {
    fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [{ title: 'New lead', color: 0x6c8cff, fields: [
        { name: 'Name', value: String(name).slice(0, 100) },
        { name: 'Email', value: String(email).slice(0, 200) },
        { name: 'Company', value: String(company || '-').slice(0, 100) },
        { name: 'Interest', value: String(interest || '-').slice(0, 50) },
        { name: 'Message', value: String(message || '-').slice(0, 900) }
      ] }] })
    }).catch(console.error);
  }

  if (mailer) mailer.sendMail({
    from: process.env.MAIL_FROM, to: email, subject: "You're on the list!",
    text: `Hi ${name}, thanks for joining. We'll be in touch soon.`
  }).catch(console.error);

  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () => console.log('Running on port 3000'));
