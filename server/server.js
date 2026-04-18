/**
 * Kitty's Next Move — Telegram Mini App Backend
 * ================================================
 * Monthly competition — highest game score wins
 * Prize: 1,000,000,000,000 UNITY tokens (ETH mainnet)
 * Owner payout address: 0xFd0bb211d479710dFa01d3d98751767F51edb2d9
 * Payout: MANUAL by owner at end of each month
 */

require('dotenv').config();
const express  = require('express');
const Database = require('better-sqlite3');
const crypto   = require('crypto');
const path     = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const BOT_TOKEN    = process.env.BOT_TOKEN;
const CHANNEL_ID   = process.env.CHANNEL_ID || '@unityoneth';
const PORT         = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change_this_secret';

const OWNER_ADDRESS = '0xFd0bb211d479710dFa01d3d98751767F51edb2d9';
const PRIZE_TOKENS  = '1,000,000,000,000';
const PRIZE_LABEL   = '1 Trillion UNITY';

/* ── Database ── */
const db = new Database('unity_game.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS scores (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    playerId    TEXT NOT NULL,
    playerName  TEXT NOT NULL,
    score       INTEGER NOT NULL DEFAULT 0,
    wave        INTEGER DEFAULT 1,
    uCount      INTEGER DEFAULT 0,
    walletAddr  TEXT DEFAULT NULL,
    period      TEXT NOT NULL,
    updatedAt   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(playerId, period)
  );
  CREATE TABLE IF NOT EXISTS competitions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    period       TEXT NOT NULL UNIQUE,
    startDate    TEXT NOT NULL,
    endDate      TEXT NOT NULL,
    winnerId     TEXT DEFAULT NULL,
    winnerName   TEXT DEFAULT NULL,
    winnerScore  INTEGER DEFAULT NULL,
    winnerWallet TEXT DEFAULT NULL,
    announced    INTEGER DEFAULT 0,
    paid         INTEGER DEFAULT 0,
    paidTxHash   TEXT DEFAULT NULL
  );
  CREATE TABLE IF NOT EXISTS wallets (
    playerId   TEXT PRIMARY KEY,
    playerName TEXT NOT NULL,
    walletAddr TEXT NOT NULL,
    updatedAt  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_period_score ON scores(period, score DESC);
`);

/* ── Helpers ── */
function currentPeriod() {
  const n = new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth()+1).padStart(2,'0')}`;
}

function ensureCompetition(period) {
  if (db.prepare('SELECT id FROM competitions WHERE period=?').get(period)) return;
  const [year, month] = period.split('-').map(Number);
  const start = new Date(Date.UTC(year, month-1, 1));
  const end   = new Date(Date.UTC(year, month,   1));
  end.setUTCDate(end.getUTCDate()-1);
  db.prepare('INSERT INTO competitions (period,startDate,endDate) VALUES(?,?,?)')
    .run(period, start.toISOString().slice(0,10), end.toISOString().slice(0,10));
}

function daysLeft(period) {
  const comp = db.prepare('SELECT endDate FROM competitions WHERE period=?').get(period);
  if (!comp) return 30;
  return Math.max(0, Math.ceil((new Date(comp.endDate) - new Date()) / 86400000));
}

function verifyTg(initData) {
  if (!BOT_TOKEN || !initData) return true;
  try {
    const p = new URLSearchParams(initData);
    const h = p.get('hash'); p.delete('hash');
    const s = [...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
    return crypto.createHmac('sha256',secret).update(s).digest('hex') === h;
  } catch { return false; }
}

async function tgSend(chatId, text, extra={}) {
  if (!BOT_TOKEN) { console.log('[TG]', text.slice(0,80)); return; }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id:chatId, text, parse_mode:'HTML', disable_web_page_preview:true, ...extra })
  });
}

async function tgChannel(text, extra={}) {
  return tgSend(CHANNEL_ID, text, extra);
}

/* ══════════════════════════════════════
   API ROUTES
══════════════════════════════════════ */

// POST /api/score
app.post('/api/score', (req, res) => {
  const { playerId, playerName, score, wave, uCount, initData } = req.body;
  if (!playerId || !playerName || typeof score !== 'number')
    return res.status(400).json({ error: 'Invalid payload' });
  if (score > 9_999_999)
    return res.status(400).json({ error: 'Score rejected' });
  if (initData && !verifyTg(initData))
    return res.status(403).json({ error: 'Auth failed' });

  const period = currentPeriod();
  ensureCompetition(period);

  const existing = db.prepare('SELECT id,score FROM scores WHERE playerId=? AND period=?').get(playerId, period);
  let isNewBest = false;

  if (existing) {
    if (score > existing.score) {
      db.prepare('UPDATE scores SET score=?,wave=?,uCount=?,playerName=?,updatedAt=CURRENT_TIMESTAMP WHERE id=?')
        .run(score, wave||1, uCount||0, playerName, existing.id);
      isNewBest = true;
    }
  } else {
    const w = db.prepare('SELECT walletAddr FROM wallets WHERE playerId=?').get(playerId);
    db.prepare('INSERT INTO scores (playerId,playerName,score,wave,uCount,walletAddr,period) VALUES(?,?,?,?,?,?,?)')
      .run(playerId, playerName, score, wave||1, uCount||0, w?.walletAddr||null, period);
    isNewBest = true;
  }

  const ranked = db.prepare('SELECT playerId FROM scores WHERE period=? ORDER BY score DESC').all(period);
  const rank   = ranked.findIndex(r => r.playerId === playerId) + 1;

  res.json({ rank, total: ranked.length, period, isNewBest, daysLeft: daysLeft(period) });
});

// POST /api/wallet
app.post('/api/wallet', (req, res) => {
  const { playerId, playerName, walletAddr, initData } = req.body;
  if (!playerId || !walletAddr) return res.status(400).json({ error: 'Missing fields' });
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddr)) return res.status(400).json({ error: 'Invalid ETH address' });
  if (initData && !verifyTg(initData)) return res.status(403).json({ error: 'Auth failed' });

  db.prepare('INSERT INTO wallets (playerId,playerName,walletAddr) VALUES(?,?,?) ON CONFLICT(playerId) DO UPDATE SET walletAddr=excluded.walletAddr,playerName=excluded.playerName,updatedAt=CURRENT_TIMESTAMP')
    .run(playerId, playerName||'Anonymous', walletAddr);
  db.prepare('UPDATE scores SET walletAddr=? WHERE playerId=? AND period=?')
    .run(walletAddr, playerId, currentPeriod());

  res.json({ success: true, walletAddr });
});

// GET /api/wallet/:id
app.get('/api/wallet/:playerId', (req, res) => {
  const w = db.prepare('SELECT walletAddr FROM wallets WHERE playerId=?').get(req.params.playerId);
  res.json({ walletAddr: w?.walletAddr || null });
});

// GET /api/leaderboard
app.get('/api/leaderboard', (req, res) => {
  const period = req.query.period || currentPeriod();
  const rows = db.prepare(`
    SELECT playerName,playerId,score,wave,uCount,
           CASE WHEN walletAddr IS NOT NULL THEN 1 ELSE 0 END as hasWallet
    FROM scores WHERE period=? ORDER BY score DESC LIMIT 20
  `).all(period);
  res.json({ rows, period, daysLeft: daysLeft(period) });
});

// GET /api/competition
app.get('/api/competition', (req, res) => {
  const period = currentPeriod();
  ensureCompetition(period);
  const comp   = db.prepare('SELECT * FROM competitions WHERE period=?').get(period);
  const leader = db.prepare('SELECT playerName,score,walletAddr FROM scores WHERE period=? ORDER BY score DESC LIMIT 1').get(period);
  const total  = db.prepare('SELECT COUNT(*) as n FROM scores WHERE period=?').get(period);
  res.json({ comp, leader, totalPlayers: total?.n||0, daysLeft: daysLeft(period), period });
});

/* ── Admin ── */
function adminAuth(req,res,next){
  if(req.headers['x-admin-secret']!==ADMIN_SECRET) return res.status(401).json({error:'Unauthorized'});
  next();
}

app.get('/admin/summary', adminAuth, (req, res) => {
  const period = req.query.period || currentPeriod();
  const top10  = db.prepare('SELECT playerName,playerId,score,wave,uCount,walletAddr FROM scores WHERE period=? ORDER BY score DESC LIMIT 10').all(period);
  const comp   = db.prepare('SELECT * FROM competitions WHERE period=?').get(period);
  const total  = db.prepare('SELECT COUNT(*) as n FROM scores WHERE period=?').get(period).n;
  res.json({ period, top10, comp, totalPlayers:total, ownerAddress:OWNER_ADDRESS, prize:PRIZE_TOKENS, daysLeft:daysLeft(period) });
});

app.post('/admin/announce', adminAuth, async (req, res) => {
  await announceWinner(req.body.period || currentPeriod(), true);
  res.json({ success: true });
});

app.post('/admin/mark-paid', adminAuth, async (req, res) => {
  const { period, txHash } = req.body;
  if (!period || !txHash) return res.status(400).json({ error: 'Missing fields' });
  db.prepare('UPDATE competitions SET paid=1,paidTxHash=? WHERE period=?').run(txHash, period);
  const comp = db.prepare('SELECT * FROM competitions WHERE period=?').get(period);
  if (comp?.winnerName) {
    await tgChannel(
      `💸 <b>Prize Sent!</b>\n\n` +
      `<b>${PRIZE_LABEL}</b> tokens have been sent to the winner of <b>${period}</b>!\n\n` +
      `👑 Winner: @${comp.winnerName}\n` +
      `🎮 Score: $${Number(comp.winnerScore).toLocaleString()}\n` +
      `💳 Wallet: <code>${comp.winnerWallet}</code>\n` +
      `🔗 Tx: <a href="https://etherscan.io/tx/${txHash}">View on Etherscan</a>\n\n` +
      `🚀 Next month's competition is live — start hunting!\n` +
      `<a href="https://t.me/${CHANNEL_ID.replace('@','')}">@unityoneth</a>`
    );
  }
  res.json({ success: true });
});

/* ── Monthly winner announcement ── */
async function announceWinner(period, force=false) {
  const comp = db.prepare('SELECT * FROM competitions WHERE period=?').get(period);
  if (!comp || (comp.announced && !force)) return;

  const winner = db.prepare('SELECT * FROM scores WHERE period=? ORDER BY score DESC LIMIT 1').get(period);
  if (!winner) return console.log(`[${period}] No scores yet`);

  db.prepare('UPDATE competitions SET winnerId=?,winnerName=?,winnerScore=?,winnerWallet=?,announced=1 WHERE period=?')
    .run(winner.playerId, winner.playerName, winner.score, winner.walletAddr||'NOT REGISTERED', period);

  const top10  = db.prepare('SELECT playerName,score FROM scores WHERE period=? ORDER BY score DESC LIMIT 10').all(period);
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
  const lb     = top10.map((r,i) => `${medals[i]} @${r.playerName} — $${Number(r.score).toLocaleString()}`).join('\n');

  const walletLine = winner.walletAddr
    ? `💳 Wallet: <code>${winner.walletAddr}</code>\n⏳ Payout within 48 hours`
    : `⚠️ @${winner.playerName} — you haven't registered a wallet!\nDM the bot: /wallet 0xYourAddress`;

  await tgChannel(
    `🏆 <b>Kitty's Next Move — ${period} — The Signal Has Landed</b>\n\n` +
    `The move has been made. The month is over.\n\n` +
    `👑 <b>@${winner.playerName}</b>\n` +
    `📡 Signal strength: <b>$${Number(winner.score).toLocaleString()}</b>\n` +
    `💎 UNITY cubes aligned: ${winner.uCount}\n` +
    `${walletLine}\n\n` +
    `🏅 <b>Reward: ${PRIZE_LABEL} UNITY tokens</b>\n` +
    `🌐 Network: ETH Mainnet\n\n` +
    `📊 <b>Final Signal Board:</b>\n${lb}\n\n` +
    `The signal didn't disappear. It moved.\n` +
    `🚀 Next move starts NOW — follow it.\n` +
    `<a href="https://t.me/${CHANNEL_ID.replace('@','')}">@unityoneth</a>`
  );

  console.log(`[${period}] Winner announced: @${winner.playerName} score=${winner.score}`);
}

/* ── Bot webhook ── */
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const msg = req.body?.message;
  if (!msg) return;

  const chatId   = msg.chat.id;
  const text     = (msg.text||'').trim();
  const userId   = String(msg.from?.id||'');
  const userName = msg.from?.username || msg.from?.first_name || 'Player';
  const send     = (t,e={}) => tgSend(chatId,t,e);

  if (text==='/start'||text==='/play') {
    const period = currentPeriod();
    ensureCompetition(period);
    await send(
      `🎮 <b>Kitty's Next Move</b> — @unityoneth\n\n` +
      `Guide the kitty. Follow the move.\n` +
      `Catch falling UNITY cubes and stack alignment.\n` +
      `Miss one and you're out of sync.\n\n` +
      `🏆 <b>Monthly Competition</b>\n` +
      `💎 Reward: <b>${PRIZE_LABEL} UNITY tokens</b>\n` +
      `🌐 Network: ETH Mainnet\n` +
      `⏳ Days left: <b>${daysLeft(period)}</b>\n\n` +
      `The signal didn't disappear. It moved.\n\n` +
      `📝 Register wallet: /wallet 0xYourAddress\n` +
      `📊 Signal board: /leaderboard`,
      { reply_markup: { inline_keyboard: [[
        { text:'🎮 Play Now', web_app:{ url: process.env.MINI_APP_URL||'https://yourdomain.com' } }
      ]]}}
    );
  }

  else if (text==='/leaderboard') {
    const period = currentPeriod();
    const rows   = db.prepare('SELECT playerName,score FROM scores WHERE period=? ORDER BY score DESC LIMIT 10').all(period);
    const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
    let r = `📡 <b>Signal Board — ${period}</b>\n⏳ ${daysLeft(period)} days remaining\n\n`;
    if (!rows.length) r += 'No signals yet — be first to move.\n';
    else rows.forEach((row,i) => { r += `${medals[i]} @${row.playerName} — $${Number(row.score).toLocaleString()}\n`; });
    r += `\n💎 Reward: <b>${PRIZE_LABEL} UNITY tokens</b>\nSome are still watching the old screen.`;
    await send(r);
  }

  else if (text.startsWith('/wallet')) {
    const addr = text.split(' ')[1];
    if (!addr) {
      const w = db.prepare('SELECT walletAddr FROM wallets WHERE playerId=?').get(userId);
      return send(w?.walletAddr
        ? `💳 Your wallet:\n<code>${w.walletAddr}</code>\n\nUpdate: /wallet 0xNewAddress`
        : `💳 <b>Register your ETH wallet</b>\n\n<code>/wallet 0xYourEthAddress</code>\n\n⚠️ Required to receive the ${PRIZE_LABEL} UNITY token prize on ETH mainnet!`
      );
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr))
      return send('❌ Invalid ETH address. Must start with 0x, 42 characters total.');
    db.prepare('INSERT INTO wallets (playerId,playerName,walletAddr) VALUES(?,?,?) ON CONFLICT(playerId) DO UPDATE SET walletAddr=excluded.walletAddr,playerName=excluded.playerName,updatedAt=CURRENT_TIMESTAMP')
      .run(userId, userName, addr);
    db.prepare('UPDATE scores SET walletAddr=? WHERE playerId=? AND period=?').run(addr, userId, currentPeriod());
    await send(
      `✅ <b>Wallet registered!</b>\n\n<code>${addr}</code>\n\n` +
      `If you hold the signal at month end, <b>${PRIZE_LABEL} UNITY tokens</b> will be sent to this address on ETH mainnet.\n\n` +
      `🎮 Follow the move.`
    );
  }

  else if (text==='/status'||text==='/competition') {
    const period = currentPeriod();
    ensureCompetition(period);
    const leader = db.prepare('SELECT playerName,score FROM scores WHERE period=? ORDER BY score DESC LIMIT 1').get(period);
    const total  = db.prepare('SELECT COUNT(*) as n FROM scores WHERE period=?').get(period).n;
    let r = `📡 <b>Signal Status — ${period}</b>\n\n`;
    r += `⏳ Days left: <b>${daysLeft(period)}</b>\n`;
    r += `👥 Following: <b>${total}</b>\n`;
    r += `💎 Reward: <b>${PRIZE_LABEL} UNITY tokens</b>\n`;
    r += `🌐 Network: ETH Mainnet\n\n`;
    if (leader) r += `👑 Leading signal: @${leader.playerName} — $${Number(leader.score).toLocaleString()}\n\n`;
    r += `📝 Register wallet: /wallet 0xYourAddress\n📊 Signal board: /leaderboard`;
    await send(r);
  }
});

/* ── Monthly scheduler ── */
function scheduleMonthly() {
  const now  = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()+1, 1, 0, 1, 0));
  const ms   = next - now;
  console.log(`Next monthly reset in ${Math.round(ms/3600000)}h`);
  setTimeout(async function tick() {
    const prev = new Date(); prev.setUTCMonth(prev.getUTCMonth()-1);
    const prevPeriod = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth()+1).padStart(2,'0')}`;
    await announceWinner(prevPeriod);
    ensureCompetition(currentPeriod());
    await tgChannel(
      `📡 <b>The Signal Moved. New Month. Follow It.</b>\n\n` +
      `Some are still watching the old screen.\n` +
      `Others already followed.\n\n` +
      `💎 Reward: <b>${PRIZE_LABEL} UNITY tokens</b>\n` +
      `🌐 Network: ETH Mainnet\n\n` +
      `📝 Register your wallet: /wallet 0xYourAddress\n` +
      `🎮 Follow the move: /play\n` +
      `<a href="https://t.me/${CHANNEL_ID.replace('@','')}">@unityoneth</a>`
    );
    setTimeout(tick, 30*24*60*60*1000);
  }, ms);
}

/* ── Boot ── */
ensureCompetition(currentPeriod());
app.listen(PORT, () => {
  console.log(`\n🎮 Kitty's Next Move running on port ${PORT}`);
  console.log(`📅 Period: ${currentPeriod()} | ⏳ ${daysLeft(currentPeriod())} days left`);
  console.log(`💎 Prize: ${PRIZE_LABEL} UNITY tokens`);
  console.log(`💳 Owner: ${OWNER_ADDRESS}\n`);
  scheduleMonthly();
});
