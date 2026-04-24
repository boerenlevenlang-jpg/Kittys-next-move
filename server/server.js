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
    DB.competitions[period]={period,announced:false,paid:false};
  }
}
function getBoard(period){
  return Object.values(DB.scores[period]||{}).sort((a,b)=>b.score-a.score).slice(0,20);
}

async function tgSend(chatId,text,extra={}){
  if(!BOT_TOKEN){console.log('[TG]',text.slice(0,80));return;}
  try{
    const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true,...extra})
    });
    const d=await r.json();
    if(!d.ok)console.error('[TG error]',d.description,'chatId:',chatId);
  }catch(e){console.error('[TG]',e.message);}
}
async function tgChannel(text,extra={}){return tgSend(CHANNEL_ID,text,extra);}

async function tgChannelVideo(fileId,caption,entities,extra={}){
  if(!BOT_TOKEN){console.log('[TG video]',caption.slice(0,80));return;}
  try{
    const payload={chat_id:CHANNEL_ID,video:fileId,caption,supports_streaming:true,...extra};
    payload.parse_mode='HTML'; // use HTML for bold and links
    const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    const d=await r.json();
    if(!d.ok)console.error('[TG video error]',d.description);
  }catch(e){console.error('[TG video]',e.message);}
}

function mainKeyboard(chatId){
  // web_app buttons only work in private chats (positive chat IDs)
  // Groups and channels have negative chat IDs
  const isPrivate = chatId && Number(chatId) > 0;
  const playBtn = isPrivate
    ? {text:'PLAY IN TELEGRAM - WIN 1 TRILLION $UNITY',web_app:{url:MINI_APP_URL}}
    : {text:'PLAY - WIN 1 TRILLION $UNITY',url:MINI_APP_URL};
  return {inline_keyboard:[
    [playBtn],
    [{text:'Open in Browser',url:MINI_APP_URL}],
    [{text:'Buy $UNITY',url:UNISWAP_URL},{text:'Chart',url:DEX_URL}]
  ]};
}

/* ── API routes ── */
app.post('/api/score',async(req,res)=>{
  const{playerId,playerName,score,wave,uCount}=req.body;
  if(!playerId||!playerName||typeof score!=='number')return res.status(400).json({error:'Invalid'});
  if(score>9999999)return res.status(400).json({error:'Too high'});
  const period=currentPeriod();
  ensureComp(period);
  if(!DB.scores[period])DB.scores[period]={};
  const ex=DB.scores[period][playerId];
  const isNewHigh=!ex||score>ex.score;
  if(ex){if(score>ex.score)DB.scores[period][playerId]={...ex,score,wave:wave||1,uCount:uCount||0,playerName};}
  else{DB.scores[period][playerId]={playerId,playerName,score,wave:wave||1,uCount:uCount||0,walletAddr:DB.wallets[playerId]?.walletAddr||null};}
  const board=getBoard(period);
  const rank=board.findIndex(r=>r.playerId===playerId)+1;
  if(isNewHigh&&rank===1&&score>0){
    const medals=['#1','#2','#3'];
    const top3=board.slice(0,3).map((r,i)=>`${medals[i]} @${r.playerName} - ${Number(r.score).toLocaleString()}`).join('\n');
    await tgChannel(
      `<b>New #1!</b>\n\n`+
      `@${playerName} leads with <b>${score.toLocaleString()} $UNITY</b>\n\n`+
      `${top3}\n\n`+
      `${daysLeft(period)} days left - ${PRIZE} $UNITY prize`,
      {reply_markup:mainKeyboard(null)}
    );
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
app.get('/api/wallet/:id',(req,res)=>res.json({walletAddr:DB.wallets[req.params.id]?.walletAddr||null}));
app.get('/api/leaderboard',(req,res)=>{
  const period=req.query.period||currentPeriod();
  res.json({rows:getBoard(period),period,daysLeft:daysLeft(period)});
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
      `💸 <b>Prize sent!</b>\n\n`+
      `👑 @${winner.playerName} wins ${PRIZE} $UNITY\n`+
      `🔗 <a href="https://etherscan.io/tx/${txHash}">Etherscan</a>\n\n`+
      `New round starts now. Don't sleep on Roaring Kitty again.`,
      {reply_markup:mainKeyboard(null)}
    );
  }
  res.json({success:true});
});
app.post('/admin/daily-reminder',adminAuth,async(req,res)=>{
  const period=currentPeriod();
  const board=getBoard(period);
  const medals=['🥇','🥈','🥉'];
  let msg=`📡 <b>${daysLeft(period)} days left</b> — ${PRIZE} $UNITY prize\n\n`;
  if(board.length){
    board.slice(0,3).forEach((r,i)=>{ msg+=`${medals[i]} @${r.playerName} — ${Number(r.score).toLocaleString()}\n`; });
  }else{
    msg+=`No players yet. Be first.\n`;
  }
  msg+=`\n<code>${CA}</code>`;
  await tgChannel(msg,{reply_markup:mainKeyboard(null)});
  res.json({success:true});
});

/* ── Bot webhook ── */
app.post('/webhook',async(req,res)=>{
  res.sendStatus(200);
  try{
  /* Welcome new members */
  const newMembers=req.body?.message?.new_chat_members;
  if(newMembers?.length>0){
    const chatId=req.body.message.chat.id;
    for(const m of newMembers){
      if(m.is_bot)continue;
      await tgSend(chatId,
        `👋 Welcome ${m.first_name||''}!\n\n`+
        `Roaring Kitty's 4 tweets all point to Unity Software ($U).\n`+
        `$UNITY is the ETH meme token riding that signal.\n\n`+
        `🎮 Play. Win ${PRIZE} $UNITY.\n`+
        `<code>${CA}</code>`,
        {reply_markup:mainKeyboard(chatId)}
      );
    }
    return;
  }

  const msg=req.body?.message; if(!msg)return;
  const chatId=msg.chat.id;
  // Strip @botname suffix from commands (e.g. /start@unityoneth_bot -> /start)
  const rawText=(msg.text||'').trim();
  const text=rawText.replace(/@\w+$/,'').trim();
  const userId=String(msg.from?.id||''), userName=msg.from?.username||msg.from?.first_name||'Player';
  const send=(t,e={})=>tgSend(chatId,t,e);
  const period=currentPeriod();

  if(text==='/start'){
    await send(
      `🐱 <b>Play Kitty's Next Move</b>\n\n`+
      `Roaring Kitty called GME at $4. Made $250M+.\n`+
      `His last 4 tweets all signal Unity Software ($U).\n`+
      `$UNITY is the ETH meme token built on that signal.\n\n`+
      `The $GME meme token hit $160M.\n`+
      `$UNITY is next — the world just doesn't know it yet.\n\n`+
      `🏆 Play & win ${PRIZE} $UNITY this month.\n`+
      `⏳ ${daysLeft(period)} days left.\n\n`+
      `Don't sleep on Roaring Kitty again.`,
      {reply_markup:mainKeyboard(chatId)}
    );
  }
  else if(text==='/clues'){
    await send(
      `<b>The 4 Roaring Kitty Clues</b>\n\n`+
      `From Roaring Kitty:\n\n`+
      `[1] Gift box - matches Unity Engine cube logo\n`+
      `[2] TIME cover - "YOU" means "U" ($U ticker)\n`+
      `[3] Rick James skit - "UNITY!"\n`+
      `[4] Futurama dog - "I Will Wait for U"\n\n`+
      `Four posts. Same direction.\n`+
      `Not hidden. Just ignored.\n\n`+
      `https://x.com/TheRoaringKitty`,
      {reply_markup:mainKeyboard(chatId)}
    );
  }
  else if(text==='/buy'){
    await send(
      `💱 <b>Buy $UNITY</b>\n\n`+
      `1. Open Uniswap\n`+
      `2. Paste CA: <code>${CA}</code>\n`+
      `3. Swap ETH → $UNITY\n\n`+
      `Set slippage 3–5% if needed.`,
      {reply_markup:{inline_keyboard:[
        [{text:'💱 Uniswap',url:UNISWAP_URL},{text:'📈 Chart',url:DEX_URL}],
        [{text:'🌐 Website',url:WEBSITE_URL}]
      ]}}
    );
  }
  else if(text==='/leaderboard'||text==='/status'){
    ensureComp(period);
    const board=getBoard(period);
    const dl=daysLeft(period);
    const medals=['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
    let r=`📡 <b>Leaderboard — ${period}</b>\n`;
    r+=`⏳ ${dl} days left | 👥 ${board.length} players | 💎 ${PRIZE} $UNITY\n\n`;
    if(!board.length) r+=`No players yet. Be first.\n`;
    else board.slice(0,10).forEach((row,i)=>{
      r+=`${medals[i]} @${row.playerName} — ${Number(row.score).toLocaleString()}${row.walletAddr?'':' ⚠️'}\n`;
    });
    r+=`\n⚠️ = no wallet — use /wallet 0xAddress to register`;
    await send(r,{reply_markup:mainKeyboard(chatId)});
  }
  else if(text.startsWith('/wallet')){
    const addr=text.split(' ')[1];
    if(!addr){
      const w=DB.wallets[userId];
      return send(w?.walletAddr
        ?`💳 Wallet registered:\n<code>${w.walletAddr}</code>\n\nUpdate: /wallet 0xNew`
        :`💳 Register to claim your prize:\n/wallet 0xYourAddress`
      );
    }
    if(!/^0x[a-fA-F0-9]{40}$/.test(addr))return send(`❌ Invalid address. Try:\n/wallet 0xYourAddress`);
    DB.wallets[userId]={playerId:userId,playerName:userName,walletAddr:addr};
    if(DB.scores[period]?.[userId])DB.scores[period][userId].walletAddr=addr;
    await send(
      `✅ Wallet registered!\n<code>${addr}</code>\n\nWin #1 this month → receive ${PRIZE} $UNITY on ETH Mainnet.`,
      {reply_markup:{inline_keyboard:[[{text:'🎮 Play Now',web_app:{url:MINI_APP_URL}}]]}}
    );
  }
  else if(text==='/help'){
    await send(
      `<b>Commands</b>\n\n`+
      `/start — play the game\n`+
      `/clues — Roaring Kitty's 4 clues\n`+
      `/leaderboard — scores, standings & time left\n`+
      `/wallet 0xAddress — register to win`,
      {reply_markup:mainKeyboard(chatId)}
    );
  }
  }catch(err){console.error('[webhook error]',err.message);}
});



/* ── Buy Bot ── */
const UNITY_CA_LOWER = '0xfd0bb211d479710dfa01d3d98751767f51edb2d9';
const ALCHEMY_KEY = process.env.ALCHEMY_KEY || '';
let lastBuyBlock = 0;

// Price cache - refresh every 60s
let _cache = {ethPrice:0, unityUsd:0, marketCap:0, ts:0};

async function refreshPriceCache(){
  const now = Date.now();
  if(now - _cache.ts < 60000) return;
  try{
    const [ethRes, dexRes] = await Promise.all([
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd').then(r=>r.json()),
      fetch('https://api.dexscreener.com/latest/dex/tokens/'+UNITY_CA_LOWER).then(r=>r.json())
    ]);
    _cache.ethPrice = ethRes?.ethereum?.usd || 0;
    const pair = dexRes?.pairs?.[0];
    if(pair){
      _cache.unityUsd = parseFloat(pair.priceUsd||0);
      _cache.marketCap = parseFloat(pair.fdv||pair.marketCap||0);
    }
    _cache.ts = now;
  }catch(e){}
}

async function getWalletBalance(rpc, wallet){
  try{
    const addr = wallet.toLowerCase().replace('0x','').padStart(64,'0');
    const r = await fetch(rpc,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:4,method:'alchemy_getTokenBalances',
        params:[wallet,[UNITY_CA_LOWER]]})});
    const d = await r.json();
    const hex = d?.result?.tokenBalances?.[0]?.tokenBalance;
    if(!hex||hex==='0x0') return 0;
    return Number(BigInt(hex))/1e9;
  }catch(e){return 0;}
}

async function getTotalSupply(rpc){
  try{
    const r = await fetch(rpc,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:5,method:'eth_call',
        params:[{to:UNITY_CA_LOWER,data:'0x18160ddd'},'latest']})});
    const d = await r.json();
    if(!d.result||d.result==='0x') return 0;
    return Number(BigInt(d.result))/1e9;
  }catch(e){return 0;}
}

function fmtAmt(n){
  if(n>=1e12) return (n/1e12).toFixed(2)+'T';
  if(n>=1e9)  return (n/1e9).toFixed(2)+'B';
  if(n>=1e6)  return (n/1e6).toFixed(2)+'M';
  if(n>=1e3)  return (n/1e3).toFixed(2)+'K';
  return n.toFixed(0);
}

async function checkBuys(){
  if(!ALCHEMY_KEY) return;
  try{
    const rpc = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;

    // Get latest block
    const blockRes = await fetch(rpc,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',method:'eth_blockNumber',params:[],id:1})});
    const blockData = await blockRes.json();
    const latestBlock = parseInt(blockData.result,16);
    if(lastBuyBlock===0){lastBuyBlock=latestBlock;return;}
    if(latestBlock<=lastBuyBlock) return;

    // Get Transfer events
    const logsRes = await fetch(rpc,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',method:'eth_getLogs',id:2,params:[{
        fromBlock:'0x'+lastBuyBlock.toString(16),
        toBlock:'0x'+latestBlock.toString(16),
        address:UNITY_CA_LOWER,
        topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
      }]})});
    const logsData = await logsRes.json();
    lastBuyBlock = latestBlock;
    if(!logsData.result?.length) return;

    // Group by txHash - show only largest transfer per transaction
    const txMap = {};
    for(const log of logsData.result){
      const rawHex = log.data.startsWith('0x')?log.data:'0x'+log.data;
      const amt = Number(BigInt(rawHex))/1e9;
      if(!txMap[log.transactionHash]||amt>txMap[log.transactionHash].amount)
        txMap[log.transactionHash]={log,amount:amt};
    }

    // Refresh price cache once per cycle
    await refreshPriceCache();

    for(const {log,amount} of Object.values(txMap)){
      if(amount<1000000) continue; // min 1M tokens

      // Get actual buyer (tx.from) and wallet balance in parallel
      const [txData, walletBal] = await Promise.all([
        fetch(rpc,{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({jsonrpc:'2.0',method:'eth_getTransactionByHash',id:6,
            params:[log.transactionHash]})}).then(r=>r.json()).catch(()=>({})),
        getWalletBalance(rpc,'0x'+log.topics[2].slice(26))
      ]);

      const buyer = txData?.result?.from || '0x'+log.topics[2].slice(26);
      const shortBuyer = buyer.slice(0,6)+'...'+buyer.slice(-4);

      // Emoji scaling
      let emojiCount = amount>=1e11?8:amount>=1e10?6:amount>=1e9?5:
                       amount>=1e8?4:amount>=1e7?3:amount>=1e6?2:1;
      if(amount>=1e12) emojiCount = 10+Math.floor((amount-1e12)/1e11);
      emojiCount = Math.min(emojiCount,50);

      const usdValue = amount*_cache.unityUsd;

      const caption =
        `${'🐾'.repeat(emojiCount)}\n`+
        `<b>Unity Software Buy!</b>\n\n`+
        `🔀 <b>Got ${fmtAmt(amount)} UNITY${usdValue>0?' ($'+usdValue.toFixed(2)+')':''}</b>\n`+
        `👤 <b><a href="https://etherscan.io/address/${buyer}">${shortBuyer}</a> / <a href="https://etherscan.io/tx/${log.transactionHash}">TX</a></b>\n`+
        `🪙 <b>Holding ${walletBal>0?fmtAmt(walletBal)+' UNITY':'N/A'}</b>\n`+
        `💸 <b>Market Cap ${_cache.marketCap>0?'$'+fmtAmt(_cache.marketCap):'N/A'}</b>\n\n`+
        `<b>😼 Roaring Kitty's last 4 posts all point to UNITY. 😼</b>`;

      await tgChannelVideo(
        'CgACAgUAAxkBAAIBUmnrjSSu4LzTAYQfOiTC9WDzr7y6AAL8HwACM2VgVwNkcszPSCOXOwQ',
        caption, null,
        {reply_markup:{inline_keyboard:[
          [{text:'Play - Win 1 Trillion $UNITY',url:MINI_APP_URL}],
          [{text:'Buy $UNITY',url:UNISWAP_URL},{text:'Chart',url:DEX_URL}]
        ]}}
      );
    }
  }catch(e){console.error('[buybot]',e.message);}
}

if(ALCHEMY_KEY){
  setInterval(checkBuys,30000);
  console.log('Buy bot active');
}else{
  console.log('Buy bot inactive - add ALCHEMY_KEY to Railway vars');
}

ensureComp(currentPeriod());
app.listen(PORT,'0.0.0.0',()=>{
  console.log(`\n🎮 Kitty's Next Move on port ${PORT}`);
  console.log(`📅 ${currentPeriod()} | ⏳ ${daysLeft(currentPeriod())} days | 💎 ${PRIZE}\n`);
});
