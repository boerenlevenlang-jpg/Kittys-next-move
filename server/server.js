require('dotenv').config();
const express = require('express');
const path    = require('path');

const app  = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const BOT_TOKEN    = process.env.BOT_TOKEN    || '';
const CHANNEL_ID   = process.env.CHANNEL_ID   || '@unityoneth';
const PORT         = parseInt(process.env.PORT || '3000', 10);
const ADMIN_SECRET = process.env.ADMIN_SECRET  || 'changeme';
const PRIZE        = '1,000,000,000,000';
const CA           = '0xFd0bb211d479710dFa01d3d98751767F51edb2d9';
const UNISWAP_URL  = 'https://app.uniswap.org/explore/tokens/ethereum/0xfd0bb211d479710dfa01d3d98751767f51edb2d9';
const DEX_URL      = 'https://www.dextools.io/app/ether/pair-explorer/0xc85589c893c9a4cc7ea0b193095712aca1b8441c';
const WEBSITE_URL  = 'https://www.unityoneth.com';
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://yourdomain.com';

/* ── In-memory DB ── */
const DB = { scores:{}, wallets:{}, competitions:{} };

function currentPeriod(){
  const n=new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth()+1).padStart(2,'0')}`;
}

function daysLeft(period){
  const[year,month]=period.split('-').map(Number);
  return Math.max(0,Math.ceil((new Date(Date.UTC(year,month,1))-new Date())/86400000));
}

function hoursLeft(period){
  const[year,month]=period.split('-').map(Number);
  const diff=new Date(Date.UTC(year,month,1))-new Date();
  return Math.max(0,Math.floor(diff/3600000));
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

/* ── Default inline keyboard ── */
function mainKeyboard(){
  return {inline_keyboard:[
    [{text:'🎮 Play Now',web_app:{url:MINI_APP_URL}}],
    [{text:'💱 Buy $UNITY on Uniswap',url:UNISWAP_URL}],
    [{text:'📈 DexTools Chart',url:DEX_URL},{text:'🌐 Website',url:WEBSITE_URL}]
  ]};
}

/* ── Routes ── */
app.post('/api/score',async(req,res)=>{
  const{playerId,playerName,score,wave,uCount}=req.body;
  if(!playerId||!playerName||typeof score!=='number')return res.status(400).json({error:'Invalid'});
  if(score>9999999)return res.status(400).json({error:'Score too high'});
  const period=currentPeriod();
  ensureComp(period);
  if(!DB.scores[period])DB.scores[period]={};
  const ex=DB.scores[period][playerId];
  const isNewHigh=!ex||score>ex.score;
  if(ex){if(score>ex.score)DB.scores[period][playerId]={...ex,score,wave:wave||1,uCount:uCount||0,playerName};}
  else{DB.scores[period][playerId]={playerId,playerName,score,wave:wave||1,uCount:uCount||0,walletAddr:DB.wallets[playerId]?.walletAddr||null};}
  const board=getBoard(period);
  const rank=board.findIndex(r=>r.playerId===playerId)+1;

  /* Post to channel if new #1 */
  if(isNewHigh&&rank===1&&score>0){
    const medals=['🥇','🥈','🥉'];
    let lb=`🏆 <b>New Leader on the Signal Board!</b>\n\n`;
    lb+=`👑 @${playerName} just took #1 with <b>${score.toLocaleString()} $UNITY</b>\n\n`;
    lb+=`📊 <b>Top 3 this month:</b>\n`;
    board.slice(0,3).forEach((row,i)=>{
      lb+=`${medals[i]||'  '} @${row.playerName} — ${Number(row.score).toLocaleString()}\n`;
    });
    lb+=`\n⏳ ${daysLeft(period)} days left to claim the prize\n`;
    lb+=`💎 <b>${PRIZE} $UNITY tokens</b> — ETH Mainnet\n\n`;
    lb+=`Think you can beat them? 👇`;
    await tgChannel(lb,{reply_markup:mainKeyboard()});
  }

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
  res.json({period,top10:getBoard(period),daysLeft:daysLeft(period),prize:PRIZE});
});
app.post('/admin/mark-paid',adminAuth,async(req,res)=>{
  const{period,txHash}=req.body;
  if(!period||!txHash)return res.status(400).json({error:'Missing'});
  if(DB.competitions[period])DB.competitions[period].paidTxHash=txHash;
  const winner=getBoard(period)[0];
  if(winner){
    await tgChannel(
      `💸 <b>Prize Sent!</b>\n\n`+
      `The ${period} competition is over.\n\n`+
      `👑 <b>Winner: @${winner.playerName}</b>\n`+
      `🏆 Score: ${Number(winner.score).toLocaleString()} $UNITY\n`+
      `💳 Wallet: <code>${winner.walletAddr||'N/A'}</code>\n`+
      `💎 Prize: <b>${PRIZE} $UNITY tokens</b>\n`+
      `🔗 <a href="https://etherscan.io/tx/${txHash}">View on Etherscan</a>\n\n`+
      `A new competition starts now.\n`+
      `He did it with GME. He's signalling $UNITY.\n`+
      `<b>Don't miss it twice.</b>`,
      {reply_markup:mainKeyboard()}
    );
  }
  res.json({success:true});
});

/* ── Daily reminder (call this via cron or admin route) ── */
app.post('/admin/daily-reminder',adminAuth,async(req,res)=>{
  const period=currentPeriod();
  const board=getBoard(period);
  const dl=daysLeft(period);
  const medals=['🥇','🥈','🥉'];
  let msg=`📡 <b>Daily Signal Update</b>\n\n`;
  msg+=`⏳ <b>${dl} days left</b> to win ${PRIZE} $UNITY\n\n`;
  if(board.length){
    msg+=`📊 <b>Current Leaderboard:</b>\n`;
    board.slice(0,5).forEach((row,i)=>{
      msg+=`${medals[i]||`${i+1}.`} @${row.playerName} — ${Number(row.score).toLocaleString()}\n`;
    });
    msg+=`\n`;
  }else{
    msg+=`No players yet this month — be the first!\n\n`;
  }
  msg+=`🔥 Roaring Kitty called GME at $4.\n`;
  msg+=`The $GME meme token hit $160M.\n`;
  msg+=`<b>$UNITY hasn't moved yet.</b>\n\n`;
  msg+=`📌 CA: <code>${CA}</code>`;
  await tgChannel(msg,{reply_markup:mainKeyboard()});
  res.json({success:true});
});

/* ── Bot webhook ── */
app.post('/webhook',async(req,res)=>{
  res.sendStatus(200);

  /* Handle new channel members */
  const newMembers=req.body?.message?.new_chat_members;
  if(newMembers&&newMembers.length>0){
    const chatId=req.body.message.chat.id;
    for(const member of newMembers){
      if(member.is_bot)continue;
      const name=member.first_name||'anon';
      await tgSend(chatId,
        `👋 Welcome, ${name}!\n\n`+
        `You just joined the sharpest community in crypto.\n\n`+
        `Roaring Kitty left 4 clues. They all point to <b>$UNITY</b>.\n`+
        `The $GME meme token hit $160M. $UNITY hasn't moved yet.\n\n`+
        `🎮 Play the game. Win <b>${PRIZE} $UNITY tokens</b>.\n`+
        `📌 CA: <code>${CA}</code>\n\n`+
        `Type /start to begin.`,
        {reply_markup:{inline_keyboard:[[{text:'🎮 Follow the Move',web_app:{url:MINI_APP_URL}}]]}}
      );
    }
    return;
  }

  const msg=req.body?.message;if(!msg)return;
  const chatId=msg.chat.id,text=(msg.text||'').trim();
  const userId=String(msg.from?.id||''),userName=msg.from?.username||msg.from?.first_name||'Player';
  const send=(t,e={})=>tgSend(chatId,t,e);
  const period=currentPeriod();

  /* /start or /play */
  if(text==='/start'||text==='/play'){
    await send(
      `🐱 <b>Kitty's Next Move</b>\n\n`+
      `Roaring Kitty turned $53K into $48M calling GameStop before anyone.\n`+
      `He went silent. Then left 4 cryptic tweets.\n`+
      `All four point to one thing: <b>$UNITY on Ethereum.</b>\n\n`+
      `The $GME meme token hit $160M market cap.\n`+
      `<b>$UNITY hasn't moved yet.</b>\n\n`+
      `━━━━━━━━━━━━━━━\n`+
      `🎮 <b>PLAY & WIN</b>\n`+
      `Guide the kitty. Catch $UNITY cubes.\n`+
      `Avoid GME tombstones, SEC badges & SHORT bears.\n\n`+
      `🏆 <b>Monthly Prize</b>\n`+
      `💎 ${PRIZE} $UNITY tokens\n`+
      `🌐 ETH Mainnet — highest score wins\n`+
      `⏳ <b>${daysLeft(period)} days left</b> this round\n\n`+
      `━━━━━━━━━━━━━━━\n`+
      `📌 <b>$UNITY — ETH Mainnet</b>\n`+
      `<code>${CA}</code>\n\n`+
      `He did it with GME. He's signalling $UNITY.\n`+
      `<b>Don't miss it twice.</b>`,
      {reply_markup:mainKeyboard()}
    );
  }

  /* /clues — explain the 4 tweets */
  else if(text==='/clues'){
    await send(
      `🔍 <b>Roaring Kitty's 4 Clues</b>\n\n`+
      `He never says the ticker. He shows you.\n\n`+
      `🎁 <b>Tweet 1 — Gift Box</b>\n`+
      `The box shape = Unity Engine cube logo.\n\n`+
      `📺 <b>Tweet 2 — TIME Magazine Cover</b>\n`+
      `"TIME U COVER" — $U is Unity's stock ticker.\n`+
      `Timestamp: 1:09 / 4:20. April 20th?\n\n`+
      `✊ <b>Tweet 3 — Dave Chappelle as Rick James</b>\n`+
      `The knuckle ring spells U-N-I-T-Y.\n`+
      `$U surged 14% the day he posted it.\n\n`+
      `🐕 <b>Tweet 4 — Futurama Dog Clip</b>\n`+
      `Song: "I Will Wait for U" by Connie Francis.\n`+
      `U = Unity. He's waiting for it to move.\n\n`+
      `━━━━━━━━━━━━━━━\n`+
      `Four tweets. Zero words. All signal.\n\n`+
      `📌 <code>${CA}</code>`,
      {reply_markup:mainKeyboard()}
    );
  }

  /* /about */
  else if(text==='/about'){
    await send(
      `📖 <b>What is $UNITY?</b>\n\n`+
      `$UNITY is the official meme token on Ethereum inspired by Roaring Kitty's 4 cryptic tweets — all pointing to Unity Software ($U).\n\n`+
      `🏆 <b>Why $UNITY?</b>\n`+
      `• Roaring Kitty called $GME before the world knew\n`+
      `• The $GME meme token hit $160M market cap\n`+
      `• His last 4 tweets all signal Unity Software\n`+
      `• $UNITY is on Ethereum Mainnet — the most trusted chain\n`+
      `• Still early. Hasn't moved yet.\n\n`+
      `📌 <b>Contract Address</b>\n`+
      `<code>${CA}</code>\n\n`+
      `🌐 ETH Mainnet — verify on Etherscan\n\n`+
      `He did it with GME. He's signalling $UNITY.\n`+
      `<b>Don't miss it twice.</b>`,
      {reply_markup:mainKeyboard()}
    );
  }

  /* /buy */
  else if(text==='/buy'){
    await send(
      `💱 <b>How to Buy $UNITY</b>\n\n`+
      `<b>Step 1</b> — Get ETH in a wallet (MetaMask, Coinbase Wallet, etc.)\n\n`+
      `<b>Step 2</b> — Go to Uniswap and paste the contract address:\n`+
      `<code>${CA}</code>\n\n`+
      `<b>Step 3</b> — Swap ETH for $UNITY\n`+
      `Set slippage to 3-5% if needed.\n\n`+
      `<b>Step 4</b> — Add token to your wallet using the CA above\n\n`+
      `📈 Track it live on DexTools\n\n`+
      `⚠️ Always DYOR. This is not financial advice.\n\n`+
      `He did it with GME. He's signalling $UNITY.\n`+
      `<b>Don't miss it twice.</b>`,
      {reply_markup:{inline_keyboard:[
        [{text:'💱 Buy on Uniswap',url:UNISWAP_URL}],
        [{text:'📈 DexTools Chart',url:DEX_URL},{text:'🌐 Website',url:WEBSITE_URL}]
      ]}}
    );
  }

  /* /leaderboard */
  else if(text==='/leaderboard'){
    const board=getBoard(period);
    const medals=['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
    let r=`📡 <b>Signal Board — ${period}</b>\n`;
    r+=`⏳ ${daysLeft(period)} days left | 💎 ${PRIZE} $UNITY\n\n`;
    if(!board.length){
      r+=`No players yet. Be the first to follow the move.\n`;
    }else{
      board.slice(0,10).forEach((row,i)=>{
        const wallet=row.walletAddr?'✅':'⚠️';
        r+=`${medals[i]} @${row.playerName} — ${Number(row.score).toLocaleString()} ${wallet}\n`;
      });
      r+=`\n✅ = wallet registered  ⚠️ = wallet needed\n`;
    }
    r+=`\n📝 Register wallet to claim prize:\n/wallet 0xYourAddress\n\n`;
    r+=`He did it with GME. He's signalling $UNITY.\n<b>Don't miss it twice.</b>`;
    await send(r,{reply_markup:mainKeyboard()});
  }

  /* /wallet */
  else if(text.startsWith('/wallet')){
    const addr=text.split(' ')[1];
    if(!addr){
      const w=DB.wallets[userId];
      return send(w?.walletAddr
        ?`💳 <b>Your registered wallet:</b>\n<code>${w.walletAddr}</code>\n\nTo update:\n/wallet 0xNewAddress`
        :`💳 <b>Register your ETH wallet</b>\n\n`+
         `You need this to receive your prize if you win.\n\n`+
         `Send your address like this:\n`+
         `/wallet 0xYourAddress\n\n`+
         `⚠️ Only your PUBLIC wallet address.\n`+
         `Never share your private key or seed phrase.\n\n`+
         `💎 Prize: ${PRIZE} $UNITY on ETH Mainnet`
      );
    }
    if(!/^0x[a-fA-F0-9]{40}$/.test(addr)){
      return send(
        `❌ <b>Invalid address</b>\n\n`+
        `Must start with 0x and be 42 characters.\n\n`+
        `Try again:\n/wallet 0xYourAddress`
      );
    }
    DB.wallets[userId]={playerId:userId,playerName:userName,walletAddr:addr};
    if(DB.scores[period]?.[userId])DB.scores[period][userId].walletAddr=addr;
    await send(
      `✅ <b>Wallet registered!</b>\n\n`+
      `<code>${addr}</code>\n\n`+
      `If you finish #1 this month you'll receive:\n`+
      `💎 <b>${PRIZE} $UNITY tokens</b>\n`+
      `🌐 Sent directly to this address on ETH Mainnet\n\n`+
      `Now go play and climb the leaderboard 👇`,
      {reply_markup:{inline_keyboard:[[{text:'🎮 Play Now',web_app:{url:MINI_APP_URL}}]]}}
    );
  }

  /* /status */
  else if(text==='/status'){
    ensureComp(period);
    const board=getBoard(period);
    const dl=daysLeft(period);
    const hl=hoursLeft(period);
    let r=`📡 <b>Competition Status — ${period}</b>\n\n`;
    r+=`⏳ Time left: <b>${dl} days ${hl%24} hours</b>\n`;
    r+=`👥 Players: <b>${board.length}</b>\n`;
    r+=`💎 Prize: <b>${PRIZE} $UNITY</b>\n`;
    r+=`🌐 ETH Mainnet\n\n`;
    if(board[0]){
      r+=`👑 Leader: @${board[0].playerName}\n`;
      r+=`🏆 Score: ${Number(board[0].score).toLocaleString()} $UNITY\n\n`;
    }
    r+=`📌 CA: <code>${CA}</code>\n\n`;
    r+=`/leaderboard — full board\n`;
    r+=`/clues — the 4 Roaring Kitty clues\n`;
    r+=`/buy — how to buy $UNITY\n`;
    r+=`/wallet 0xAddress — register to win`;
    await send(r,{reply_markup:mainKeyboard()});
  }

  /* /help */
  else if(text==='/help'){
    await send(
      `🐱 <b>Kitty's Next Move — Commands</b>\n\n`+
      `/start — intro & play\n`+
      `/clues — Roaring Kitty's 4 tweets explained\n`+
      `/about — what is $UNITY?\n`+
      `/buy — how to buy $UNITY on Uniswap\n`+
      `/leaderboard — monthly top scores\n`+
      `/status — competition status & time left\n`+
      `/wallet 0xAddress — register ETH wallet to claim prize\n\n`+
      `📌 CA: <code>${CA}</code>`,
      {reply_markup:mainKeyboard()}
    );
  }
});

/* ── Boot ── */
ensureComp(currentPeriod());
app.listen(PORT,'0.0.0.0',()=>{
  console.log(`\n🎮 Kitty's Next Move on port ${PORT}`);
  console.log(`📅 Period: ${currentPeriod()} | ⏳ ${daysLeft(currentPeriod())} days left`);
  console.log(`💎 Prize: ${PRIZE} $UNITY\n`);
});
