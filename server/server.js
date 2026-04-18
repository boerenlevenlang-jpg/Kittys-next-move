require('dotenv').config();
const express = require('express');
const path    = require('path');
const crypto  = require('crypto');

const app  = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const BOT_TOKEN    = process.env.BOT_TOKEN    || '';
const CHANNEL_ID   = process.env.CHANNEL_ID   || '@unityoneth';
const PORT         = parseInt(process.env.PORT || '3000', 10);
const ADMIN_SECRET = process.env.ADMIN_SECRET  || 'changeme';
const PRIZE_TOKENS = '1,000,000,000,000';

/* ── In-memory DB (scores reset on redeploy — fine for MVP) ── */
const DB = { scores:{}, wallets:{}, competitions:{} };

function currentPeriod(){
  const n=new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth()+1).padStart(2,'0')}`;
}

function daysLeft(period){
  const[year,month]=period.split('-').map(Number);
  return Math.max(0,Math.ceil((new Date(Date.UTC(year,month,1))-new Date())/86400000));
}

function ensureComp(period){
  if(!DB.competitions[period]){
    const[year,month]=period.split('-').map(Number);
    DB.competitions[period]={
      period,
      start:new Date(Date.UTC(year,month-1,1)).toISOString().slice(0,10),
      end:new Date(Date.UTC(year,month,0)).toISOString().slice(0,10),
      announced:false, paid:false
    };
  }
}

function getBoard(period){
  return Object.values(DB.scores[period]||{})
    .sort((a,b)=>b.score-a.score).slice(0,20);
}

/* ── Telegram ── */
async function tgSend(chatId,text,extra={}){
  if(!BOT_TOKEN){console.log('[TG]',text.slice(0,80));return;}
  try{
    const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true,...extra})
    });
    const d=await r.json();
    if(!d.ok)console.error('[TG error]',d.description);
  }catch(e){console.error('[TG]',e.message);}
}
async function tgChannel(text,extra={}){return tgSend(CHANNEL_ID,text,extra);}

/* ── Routes ── */
app.post('/api/score',(req,res)=>{
  const{playerId,playerName,score,wave,uCount}=req.body;
  if(!playerId||!playerName||typeof score!=='number')return res.status(400).json({error:'Invalid'});
  if(score>9999999)return res.status(400).json({error:'Score too high'});
  const period=currentPeriod();
  ensureComp(period);
  if(!DB.scores[period])DB.scores[period]={};
  const ex=DB.scores[period][playerId];
  if(ex){if(score>ex.score)DB.scores[period][playerId]={...ex,score,wave:wave||1,uCount:uCount||0,playerName};}
  else{DB.scores[period][playerId]={playerId,playerName,score,wave:wave||1,uCount:uCount||0,walletAddr:DB.wallets[playerId]?.walletAddr||null};}
  const board=getBoard(period);
  const rank=board.findIndex(r=>r.playerId===playerId)+1;
  res.json({rank,total:board.length,period,daysLeft:daysLeft(period)});
});

app.post('/api/wallet',(req,res)=>{
  const{playerId,playerName,walletAddr}=req.body;
  if(!playerId||!walletAddr)return res.status(400).json({error:'Missing'});
  if(!/^0x[a-fA-F0-9]{40}$/.test(walletAddr))return res.status(400).json({error:'Invalid ETH'});
  DB.wallets[playerId]={playerId,playerName:playerName||'Anonymous',walletAddr};
  const period=currentPeriod();
  if(DB.scores[period]?.[playerId])DB.scores[period][playerId].walletAddr=walletAddr;
  res.json({success:true,walletAddr});
});

app.get('/api/wallet/:id',(req,res)=>{
  res.json({walletAddr:DB.wallets[req.params.id]?.walletAddr||null});
});

app.get('/api/leaderboard',(req,res)=>{
  const period=req.query.period||currentPeriod();
  res.json({rows:getBoard(period),period,daysLeft:daysLeft(period)});
});

app.get('/api/competition',(req,res)=>{
  const period=currentPeriod();
  ensureComp(period);
  const board=getBoard(period);
  res.json({period,daysLeft:daysLeft(period),totalPlayers:board.length,leader:board[0]||null});
});

app.get('/health',(req,res)=>res.json({status:'ok',period:currentPeriod(),daysLeft:daysLeft(currentPeriod())}));

/* ── Admin ── */
function adminAuth(req,res,next){
  if(req.headers['x-admin-secret']!==ADMIN_SECRET)return res.status(401).json({error:'Unauthorized'});
  next();
}
app.get('/admin/summary',adminAuth,(req,res)=>{
  const period=req.query.period||currentPeriod();
  res.json({period,top10:getBoard(period),daysLeft:daysLeft(period),prize:PRIZE_TOKENS});
});
app.post('/admin/mark-paid',adminAuth,async(req,res)=>{
  const{period,txHash}=req.body;
  if(!period||!txHash)return res.status(400).json({error:'Missing'});
  if(DB.competitions[period])DB.competitions[period].paidTxHash=txHash;
  const winner=getBoard(period)[0];
  if(winner)await tgChannel(
    `💸 <b>Reward Sent!</b>\n\n<b>${PRIZE_TOKENS} UNITY tokens</b> sent!\n`+
    `👑 @${winner.playerName}\n💳 <code>${winner.walletAddr||'N/A'}</code>\n`+
    `🔗 <a href="https://etherscan.io/tx/${txHash}">Etherscan</a>\n\n`+
    `The signal didn't disappear. It moved.`
  );
  res.json({success:true});
});

/* ── Bot webhook ── */
app.post('/webhook',async(req,res)=>{
  res.sendStatus(200);
  const msg=req.body?.message;if(!msg)return;
  const chatId=msg.chat.id,text=(msg.text||'').trim();
  const userId=String(msg.from?.id||''),userName=msg.from?.username||msg.from?.first_name||'Player';
  const send=(t,e={})=>tgSend(chatId,t,e);
  const period=currentPeriod();

  if(text==='/start'||text==='/play'){
    await send(
      `🎮 <b>Kitty's Next Move</b> — @unityoneth\n\n`+
      `Guide the kitty. Follow the move.\n`+
      `Catch falling UNITY cubes. Miss one — out of sync.\n\n`+
      `🏆 <b>Monthly Competition</b>\n`+
      `💎 <b>${PRIZE_TOKENS} UNITY tokens</b>\n`+
      `🌐 ETH Mainnet\n`+
      `⏳ Days left: <b>${daysLeft(period)}</b>\n\n`+
      `The signal didn't disappear. It moved.\n\n`+
      `📝 /wallet 0xYourAddress\n`+
      `📊 /leaderboard`,
      {reply_markup:{inline_keyboard:[[
        {text:'🎮 Follow the Move',web_app:{url:process.env.MINI_APP_URL||'https://yourdomain.com'}}
      ]]}}
    );
  }
  else if(text==='/leaderboard'){
    const board=getBoard(period);
    const medals=['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
    let r=`📡 <b>Signal Board — ${period}</b>\n⏳ ${daysLeft(period)} days remaining\n\n`;
    if(!board.length)r+='No signals yet — be first.\n';
    else board.slice(0,10).forEach((row,i)=>{r+=`${medals[i]} @${row.playerName} — $${Number(row.score).toLocaleString()}\n`;});
    r+=`\n💎 <b>${PRIZE_TOKENS} UNITY tokens</b>\nSome are still watching the old screen.`;
    await send(r);
  }
  else if(text.startsWith('/wallet')){
    const addr=text.split(' ')[1];
    if(!addr){
      const w=DB.wallets[userId];
      return send(w?.walletAddr
        ?`💳 Your wallet:\n<code>${w.walletAddr}</code>\n\nUpdate: /wallet 0xNew`
        :`💳 <b>Register ETH wallet</b>\n\n/wallet 0xYourAddress\n\n⚠️ Required to receive ${PRIZE_TOKENS} UNITY!`
      );
    }
    if(!/^0x[a-fA-F0-9]{40}$/.test(addr))return send('❌ Invalid ETH address.');
    DB.wallets[userId]={playerId:userId,playerName:userName,walletAddr:addr};
    if(DB.scores[period]?.[userId])DB.scores[period][userId].walletAddr=addr;
    await send(`✅ <b>Wallet registered!</b>\n\n<code>${addr}</code>\n\nIf you hold the top signal, <b>${PRIZE_TOKENS} UNITY tokens</b> sent here.\n\n🎮 Follow the move.`);
  }
  else if(text==='/status'){
    ensureComp(period);
    const board=getBoard(period);
    let r=`📡 <b>Signal Status — ${period}</b>\n\n⏳ Days left: <b>${daysLeft(period)}</b>\n👥 Following: <b>${board.length}</b>\n💎 <b>${PRIZE_TOKENS} UNITY tokens</b>\n🌐 ETH Mainnet\n\n`;
    if(board[0])r+=`👑 Leading: @${board[0].playerName} — $${Number(board[0].score).toLocaleString()}\n\n`;
    r+=`📝 /wallet 0xYourAddress\n📊 /leaderboard`;
    await send(r);
  }
});

/* ── Boot ── */
ensureComp(currentPeriod());
app.listen(PORT,'0.0.0.0',()=>{
  console.log(`\n🎮 Kitty's Next Move running on port ${PORT}`);
  console.log(`📅 Period: ${currentPeriod()} | ⏳ ${daysLeft(currentPeriod())} days left`);
  console.log(`💎 Prize: ${PRIZE_TOKENS} UNITY tokens\n`);
});
