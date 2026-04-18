require('dotenv').config();
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const app  = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const BOT_TOKEN    = process.env.BOT_TOKEN    || '';
const CHANNEL_ID   = process.env.CHANNEL_ID   || '@unityoneth';
const PORT         = process.env.PORT          || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET  || 'changeme';
const PRIZE_TOKENS = '1,000,000,000,000';
const PRIZE_LABEL  = '1 Trillion UNITY';

const DB_FILE = path.join(__dirname, 'db.json');
function readDB(){try{if(fs.existsSync(DB_FILE))return JSON.parse(fs.readFileSync(DB_FILE,'utf8'));}catch(e){}return{scores:{},wallets:{},competitions:{}};}
function writeDB(data){try{fs.writeFileSync(DB_FILE,JSON.stringify(data,null,2));}catch(e){}}

function currentPeriod(){const n=new Date();return`${n.getUTCFullYear()}-${String(n.getUTCMonth()+1).padStart(2,'0')}`;}
function daysLeft(period){const[year,month]=period.split('-').map(Number);return Math.max(0,Math.ceil((new Date(Date.UTC(year,month,1))-new Date())/86400000));}
function ensureCompetition(db,period){if(!db.competitions[period]){const[year,month]=period.split('-').map(Number);db.competitions[period]={period,start:new Date(Date.UTC(year,month-1,1)).toISOString().slice(0,10),end:new Date(Date.UTC(year,month,0)).toISOString().slice(0,10),announced:false,paid:false,paidTxHash:null};}}
function getLeaderboard(db,period){return Object.values(db.scores[period]||{}).sort((a,b)=>b.score-a.score).slice(0,20);}

async function tgSend(chatId,text,extra={}){if(!BOT_TOKEN){console.log('[TG]',text.slice(0,60));return;}try{await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true,...extra})});}catch(e){console.error('[TG]',e.message);}}
async function tgChannel(text,extra={}){return tgSend(CHANNEL_ID,text,extra);}

app.post('/api/score',(req,res)=>{
  const{playerId,playerName,score,wave,uCount}=req.body;
  if(!playerId||!playerName||typeof score!=='number')return res.status(400).json({error:'Invalid'});
  if(score>9999999)return res.status(400).json({error:'Score too high'});
  const db=readDB(),period=currentPeriod();
  ensureCompetition(db,period);
  if(!db.scores[period])db.scores[period]={};
  const existing=db.scores[period][playerId];
  let isNewBest=false;
  if(existing){if(score>existing.score){db.scores[period][playerId]={...existing,score,wave:wave||1,uCount:uCount||0,playerName,updatedAt:new Date().toISOString()};isNewBest=true;}}
  else{const wallet=db.wallets[playerId]?.walletAddr||null;db.scores[period][playerId]={playerId,playerName,score,wave:wave||1,uCount:uCount||0,walletAddr:wallet,updatedAt:new Date().toISOString()};isNewBest=true;}
  writeDB(db);
  const board=getLeaderboard(db,period);
  const rank=board.findIndex(r=>r.playerId===playerId)+1;
  res.json({rank,total:board.length,period,isNewBest,daysLeft:daysLeft(period)});
});

app.post('/api/wallet',(req,res)=>{
  const{playerId,playerName,walletAddr}=req.body;
  if(!playerId||!walletAddr)return res.status(400).json({error:'Missing'});
  if(!/^0x[a-fA-F0-9]{40}$/.test(walletAddr))return res.status(400).json({error:'Invalid ETH'});
  const db=readDB(),period=currentPeriod();
  db.wallets[playerId]={playerId,playerName:playerName||'Anonymous',walletAddr,updatedAt:new Date().toISOString()};
  if(db.scores[period]?.[playerId])db.scores[period][playerId].walletAddr=walletAddr;
  writeDB(db);res.json({success:true,walletAddr});
});

app.get('/api/wallet/:playerId',(req,res)=>{const db=readDB();res.json({walletAddr:db.wallets[req.params.playerId]?.walletAddr||null});});

app.get('/api/leaderboard',(req,res)=>{const db=readDB(),period=req.query.period||currentPeriod();res.json({rows:getLeaderboard(db,period),period,daysLeft:daysLeft(period)});});

app.get('/api/competition',(req,res)=>{const db=readDB(),period=currentPeriod();ensureCompetition(db,period);writeDB(db);const board=getLeaderboard(db,period);res.json({period,daysLeft:daysLeft(period),totalPlayers:board.length,leader:board[0]||null});});

function adminAuth(req,res,next){if(req.headers['x-admin-secret']!==ADMIN_SECRET)return res.status(401).json({error:'Unauthorized'});next();}
app.get('/admin/summary',adminAuth,(req,res)=>{const db=readDB(),period=req.query.period||currentPeriod();res.json({period,top10:getLeaderboard(db,period),daysLeft:daysLeft(period),prize:PRIZE_TOKENS});});
app.post('/admin/announce',adminAuth,async(req,res)=>{await announceWinner(req.body.period||currentPeriod(),true);res.json({success:true});});
app.post('/admin/mark-paid',adminAuth,async(req,res)=>{
  const{period,txHash}=req.body;if(!period||!txHash)return res.status(400).json({error:'Missing'});
  const db=readDB();if(db.competitions[period]){db.competitions[period].paid=true;db.competitions[period].paidTxHash=txHash;}writeDB(db);
  const winner=getLeaderboard(db,period)[0];
  if(winner)await tgChannel(`💸 <b>Reward Sent!</b>\n\n<b>${PRIZE_TOKENS} UNITY tokens</b> sent!\n👑 @${winner.playerName}\n💳 <code>${winner.walletAddr||'N/A'}</code>\n🔗 <a href="https://etherscan.io/tx/${txHash}">Etherscan</a>`);
  res.json({success:true});
});

async function announceWinner(period,force=false){
  const db=readDB(),comp=db.competitions[period];
  if(!comp||(comp.announced&&!force))return;
  const board=getLeaderboard(db,period),winner=board[0];
  if(!winner)return;
  db.competitions[period].announced=true;writeDB(db);
  const medals=['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
  const lb=board.slice(0,10).map((r,i)=>`${medals[i]} @${r.playerName} — $${Number(r.score).toLocaleString()}`).join('\n');
  const wl=winner.walletAddr?`💳 <code>${winner.walletAddr}</code>\n⏳ Reward within 48h`:`⚠️ @${winner.playerName} — register: /wallet 0xYourAddress`;
  await tgChannel(`🏆 <b>Kitty's Next Move — ${period} — The Signal Has Landed</b>\n\n👑 <b>@${winner.playerName}</b>\n📡 $${Number(winner.score).toLocaleString()}\n${wl}\n\n🏅 <b>${PRIZE_TOKENS} UNITY tokens</b>\n🌐 ETH Mainnet\n\n📊 <b>Final Signal Board:</b>\n${lb}\n\nThe signal didn't disappear. It moved.\n<a href="https://t.me/${CHANNEL_ID.replace('@','')}">@unityoneth</a>`);
}

app.post('/webhook',async(req,res)=>{
  res.sendStatus(200);
  const msg=req.body?.message;if(!msg)return;
  const chatId=msg.chat.id,text=(msg.text||'').trim(),userId=String(msg.from?.id||''),userName=msg.from?.username||msg.from?.first_name||'Player';
  const send=(t,e={})=>tgSend(chatId,t,e);
  const db=readDB(),period=currentPeriod();
  if(text==='/start'||text==='/play'){
    await send(`🎮 <b>Kitty's Next Move</b> — @unityoneth\n\nGuide the kitty. Follow the move.\nCatch falling UNITY cubes. Miss one — out of sync.\n\n🏆 <b>Monthly Competition</b>\n💎 <b>${PRIZE_TOKENS} UNITY tokens</b>\n🌐 ETH Mainnet\n⏳ Days left: <b>${daysLeft(period)}</b>\n\nThe signal didn't disappear. It moved.\n\n📝 /wallet 0xYourAddress\n📊 /leaderboard`,
      {reply_markup:{inline_keyboard:[[{text:'🎮 Follow the Move',web_app:{url:process.env.MINI_APP_URL||'https://yourdomain.com'}}]]}});
  }
  else if(text==='/leaderboard'){
    const board=getLeaderboard(db,period),medals=['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
    let r=`📡 <b>Signal Board — ${period}</b>\n⏳ ${daysLeft(period)} days remaining\n\n`;
    if(!board.length)r+='No signals yet — be first.\n';
    else board.slice(0,10).forEach((row,i)=>{r+=`${medals[i]} @${row.playerName} — $${Number(row.score).toLocaleString()}\n`;});
    r+=`\n💎 <b>${PRIZE_TOKENS} UNITY tokens</b>\nSome are still watching the old screen.`;
    await send(r);
  }
  else if(text.startsWith('/wallet')){
    const addr=text.split(' ')[1];
    if(!addr){const w=db.wallets[userId];return send(w?.walletAddr?`💳 Your wallet:\n<code>${w.walletAddr}</code>\n\nUpdate: /wallet 0xNew`:`💳 <b>Register ETH wallet</b>\n\n/wallet 0xYourAddress\n\n⚠️ Required to receive ${PRIZE_TOKENS} UNITY!`);}
    if(!/^0x[a-fA-F0-9]{40}$/.test(addr))return send('❌ Invalid ETH address.');
    db.wallets[userId]={playerId:userId,playerName:userName,walletAddr:addr,updatedAt:new Date().toISOString()};
    if(db.scores[period]?.[userId])db.scores[period][userId].walletAddr=addr;
    writeDB(db);
    await send(`✅ <b>Wallet registered!</b>\n\n<code>${addr}</code>\n\nIf you hold the top signal, <b>${PRIZE_TOKENS} UNITY tokens</b> sent to this address.\n\n🎮 Follow the move.`);
  }
  else if(text==='/status'||text==='/competition'){
    ensureCompetition(db,period);writeDB(db);
    const board=getLeaderboard(db,period);
    let r=`📡 <b>Signal Status — ${period}</b>\n\n⏳ Days left: <b>${daysLeft(period)}</b>\n👥 Following: <b>${board.length}</b>\n💎 <b>${PRIZE_TOKENS} UNITY tokens</b>\n🌐 ETH Mainnet\n\n`;
    if(board[0])r+=`👑 Leading: @${board[0].playerName} — $${Number(board[0].score).toLocaleString()}\n\n`;
    r+=`📝 /wallet 0xYourAddress\n📊 /leaderboard`;
    await send(r);
  }
});

function scheduleMonthly(){
  const now=new Date(),next=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1,0,1,0)),ms=next-now;
  console.log(`Next monthly reset in ${Math.round(ms/3600000)}h`);
  setTimeout(async function tick(){
    const prev=new Date();prev.setUTCMonth(prev.getUTCMonth()-1);
    const pp=`${prev.getUTCFullYear()}-${String(prev.getUTCMonth()+1).padStart(2,'0')}`;
    await announceWinner(pp);
    const db=readDB();ensureCompetition(db,currentPeriod());writeDB(db);
    await tgChannel(`📡 <b>The Signal Moved. New Month. Follow It.</b>\n\nSome are still watching the old screen.\nOthers already followed.\n\n💎 <b>${PRIZE_TOKENS} UNITY tokens</b>\n🌐 ETH Mainnet\n\n📝 /wallet 0xYourAddress\n🎮 /play\n<a href="https://t.me/${CHANNEL_ID.replace('@','')}">@unityoneth</a>`);
    setTimeout(tick,30*24*60*60*1000);
  },ms);
}

const _db=readDB();ensureCompetition(_db,currentPeriod());writeDB(_db);
app.listen(PORT,()=>{
  console.log(`\n🎮 Kitty's Next Move running on port ${PORT}`);
  console.log(`📅 Period: ${currentPeriod()} | ⏳ ${daysLeft(currentPeriod())} days left`);
  console.log(`💎 Prize: ${PRIZE_TOKENS} UNITY tokens\n`);
  scheduleMonthly();
});
