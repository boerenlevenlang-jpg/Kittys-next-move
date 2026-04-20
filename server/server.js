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
    if(!d.ok)console.error('[TG error]',d.description);
  }catch(e){console.error('[TG]',e.message);}
}
async function tgChannel(text,extra={}){return tgSend(CHANNEL_ID,text,extra);}

function mainKeyboard(){
  return {inline_keyboard:[
    [{text:'ð® PLAY IN TELEGRAM â WIN 1 TRILLION $UNITY',web_app:{url:MINI_APP_URL}}],
    [{text:'ð¥ï¸ Open Full Game in Browser â',url:MINI_APP_URL}],
    [{text:'ð± Buy $UNITY',url:UNISWAP_URL},{text:'ð Chart',url:DEX_URL}]
  ]};
}

/* ââ API routes ââ */
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
    const top3=board.slice(0,3).map((r,i)=>`${'ð¥ð¥ð¥'[i]} @${r.playerName} â ${Number(r.score).toLocaleString()}`).join('\n');
    await tgChannel(
      `ð <b>New #1!</b>\n\n`+
      `@${playerName} leads with <b>${score.toLocaleString()} $UNITY</b>\n\n`+
      `${top3}\n\n`+
      `â³ ${daysLeft(period)} days left â ð ${PRIZE} $UNITY prize`,
      {reply_markup:mainKeyboard()}
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

/* ââ Admin ââ */
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
      `ð¸ <b>Prize sent!</b>\n\n`+
      `ð @${winner.playerName} wins ${PRIZE} $UNITY\n`+
      `ð <a href="https://etherscan.io/tx/${txHash}">Etherscan</a>\n\n`+
      `New round starts now. Don't sleep on Roaring Kitty again.`,
      {reply_markup:mainKeyboard()}
    );
  }
  res.json({success:true});
});
app.post('/admin/daily-reminder',adminAuth,async(req,res)=>{
  const period=currentPeriod();
  const board=getBoard(period);
  const medals=['ð¥','ð¥','ð¥'];
  let msg=`ð¡ <b>${daysLeft(period)} days left</b> â ${PRIZE} $UNITY prize\n\n`;
  if(board.length){
    board.slice(0,3).forEach((r,i)=>{ msg+=`${medals[i]} @${r.playerName} â ${Number(r.score).toLocaleString()}\n`; });
  }else{
    msg+=`No players yet. Be first.\n`;
  }
  msg+=`\n<code>${CA}</code>`;
  await tgChannel(msg,{reply_markup:mainKeyboard()});
  res.json({success:true});
});

/* ââ Bot webhook ââ */
app.post('/webhook',async(req,res)=>{
  res.sendStatus(200);

  /* Welcome new members */
  const newMembers=req.body?.message?.new_chat_members;
  if(newMembers?.length>0){
    const chatId=req.body.message.chat.id;
    for(const m of newMembers){
      if(m.is_bot)continue;
      await tgSend(chatId,
        `ð Welcome ${m.first_name||''}!\n\n`+
        `Roaring Kitty's 4 tweets all point to Unity Software ($U).\n`+
        `$UNITY is the ETH meme token riding that signal.\n\n`+
        `ð® Play. Win ${PRIZE} $UNITY.\n`+
        `<code>${CA}</code>`,
        {reply_markup:mainKeyboard()}
      );
    }
    return;
  }

  const msg=req.body?.message; if(!msg)return;
  const chatId=msg.chat.id, text=(msg.text||'').trim();
  const userId=String(msg.from?.id||''), userName=msg.from?.username||msg.from?.first_name||'Player';
  const send=(t,e={})=>tgSend(chatId,t,e);
  const period=currentPeriod();

  if(text==='/start'){
    await send(
      `ð± <b>Play Kitty's Next Move</b>\n\n`+
      `Roaring Kitty called GME at $4. Made $250M+.\n`+
      `His last 4 tweets all signal Unity Software ($U).\n`+
      `$UNITY is the ETH meme token built on that signal.\n\n`+
      `The $GME meme token hit $160M.\n`+
      `$UNITY is next â the world just doesn't know it yet.\n\n`+
      `ð Play & win ${PRIZE} $UNITY this month.\n`+
      `â³ ${daysLeft(period)} days left.\n\n`+
      `Don't sleep on Roaring Kitty again.`,
      {reply_markup:mainKeyboard()}
    );
  }
  else if(text==='/clues'){
    await send(
      `ð <b>The 4 Roaring Kitty Clues</b>\n\n`+
      `From Roaring Kitty\n\n`+
      `ð Gift box â matches Unity Engine cube logo\n`+
      `ðº TIME cover â "YOU" â "U" ($U ticker)\n`+
      `â Rick James: "UNITY!"\n`+
      `ð Futurama dog â "I Will Wait for U"\n\n`+
      `Four posts.\n`+
      `Same direction.\n\n`+
      `Not hidden. Just ignored.\n\n`+
      `https://x.com/TheRoaringKitty`,
      {reply_markup:mainKeyboard()}
    );
  }
  else if(text==='/buy'){
    await send(
      `ð± <b>Buy $UNITY</b>\n\n`+
      `1. Open Uniswap\n`+
      `2. Paste CA: <code>${CA}</code>\n`+
      `3. Swap ETH â $UNITY\n\n`+
      `Set slippage 3â5% if needed.`,
      {reply_markup:{inline_keyboard:[
        [{text:'ð± Uniswap',url:UNISWAP_URL},{text:'ð Chart',url:DEX_URL}],
        [{text:'ð Website',url:WEBSITE_URL}]
      ]}}
    );
  }
  else if(text==='/leaderboard'){
    const board=getBoard(period);
    const medals=['ð¥','ð¥','ð¥','4ï¸â£','5ï¸â£','6ï¸â£','7ï¸â£','8ï¸â£','9ï¸â£','ð'];
    let r=`ð¡ <b>Leaderboard â ${period}</b>\nâ³ ${daysLeft(period)} days | ð ${PRIZE} $UNITY\n\n`;
    if(!board.length) r+=`No players yet. Be first.\n`;
    else board.slice(0,10).forEach((row,i)=>{
      r+=`${medals[i]} @${row.playerName} â ${Number(row.score).toLocaleString()}${row.walletAddr?'':' â ï¸'}\n`;
    });
    r+=`\nâ ï¸ = no wallet registered\n/wallet 0xAddress to register`;
    await send(r,{reply_markup:mainKeyboard()});
  }
  else if(text.startsWith('/wallet')){
    const addr=text.split(' ')[1];
    if(!addr){
      const w=DB.wallets[userId];
      return send(w?.walletAddr
        ?`ð³ Wallet registered:\n<code>${w.walletAddr}</code>\n\nUpdate: /wallet 0xNew`
        :`ð³ Register to claim your prize:\n/wallet 0xYourAddress`
      );
    }
    if(!/^0x[a-fA-F0-9]{40}$/.test(addr))return send(`â Invalid address. Try:\n/wallet 0xYourAddress`);
    DB.wallets[userId]={playerId:userId,playerName:userName,walletAddr:addr};
    if(DB.scores[period]?.[userId])DB.scores[period][userId].walletAddr=addr;
    await send(
      `â Wallet registered!\n<code>${addr}</code>\n\nWin #1 this month â receive ${PRIZE} $UNITY on ETH Mainnet.`,
      {reply_markup:{inline_keyboard:[[{text:'ð® Play Now',web_app:{url:MINI_APP_URL}}]]}}
    );
  }
  else if(text==='/status'){
    ensureComp(period);
    const board=getBoard(period);
    let r=`â³ <b>${daysLeft(period)} days left</b>\n`;
    r+=`ð¥ ${board.length} players\n`;
    r+=`ð ${PRIZE} $UNITY\n\n`;
    if(board[0]) r+=`ð @${board[0].playerName} â ${Number(board[0].score).toLocaleString()}\n\n`;
    r+=`<code>${CA}</code>`;
    await send(r,{reply_markup:mainKeyboard()});
  }
  else if(text==='/price'){
    await send(
      `ð° <b>$UNITY Price & Links</b>\n\n`+
      `ð Chart: DexTools\n`+
      `ð± Buy: Uniswap\n`+
      `ð Website: unityoneth.com\n\n`+
      `ð CA: <code>${CA}</code>`,
      {reply_markup:{inline_keyboard:[
        [{text:'ð± Buy $UNITY',url:UNISWAP_URL},{text:'ð DexTools',url:DEX_URL}],
        [{text:'ð unityoneth.com',url:WEBSITE_URL}]
      ]}}
    );
  }
  else if(text==='/help'){
    await send(
      `<b>Commands</b>\n\n`+
      `/start â play the game\n`+
      `/clues â Roaring Kitty's 4 tweets\n`+
      `/buy â how to buy $UNITY\n`+
      `/price â price & links\n`+
      `/leaderboard â top scores\n`+
      `/status â competition status\n`+
      `/wallet 0xAddress â register to win`,
      {reply_markup:mainKeyboard()}
    );
  }
});

ensureComp(currentPeriod());
app.listen(PORT,'0.0.0.0',()=>{
  console.log(`\nð® Kitty's Next Move on port ${PORT}`);
  console.log(`ð ${currentPeriod()} | â³ ${daysLeft(currentPeriod())} days | ð ${PRIZE}\n`);
});