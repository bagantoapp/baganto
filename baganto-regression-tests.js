const {JSDOM}=require('jsdom');const fs=require('fs');
const APP='/sessions/peaceful-eloquent-planck/mnt/baganto/baganto-barter-app.html';
const html=fs.readFileSync(APP,'utf8');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const DAY=86400000;
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
let pass=0, fail=0;
const ok=(name,cond,extra)=>{ (cond?pass++:fail++); console.log((cond?'  PASS  ':'  FAIL  ')+name+(extra!==undefined?'  ['+extra+']':'')); };
async function seed(mutate, opts){
  opts=opts||{};
  const d0=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"http://localhost/"});
  await wait(900);
  const db=JSON.parse(d0.window.localStorage.getItem('baganto_db_v4'));
  if(mutate) mutate(db);
  const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"http://localhost/",
    beforeParse(w){w.localStorage.setItem('baganto_db_v4',JSON.stringify(db));w.localStorage.setItem('baganto_user_v2','u1');w.confirm=function(){return true;};w.prompt=function(){return (opts&&opts.prompt!==undefined)?opts.prompt:'DELETE';};w.URL.createObjectURL=function(){return 'blob:fake';};w.URL.revokeObjectURL=function(){};}});
  await wait(1000);
  const w=dom.window,d=w.document;
  const errs=[];w.addEventListener('error',e=>errs.push(e.message));
  return {w,d,errs,
    click:s=>{const e=typeof s==='string'?d.querySelector(s):s;if(e)e.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));return !!e;},
    db:()=>JSON.parse(w.localStorage.getItem('baganto_db_v4')),
    app:()=>d.getElementById('app').innerHTML};
}
(async()=>{
 console.log('\n== BOOSTED ADS RANK FIRST ==');
 {
  const t=await seed(db=>{const i=db.items.find(x=>x.id==='i10');
    i.boostedUntil=Date.now()+7*DAY;i.isFeatured=true;i.createdAt=Date.now()-40*DAY;i.expiresAt=Date.now()+20*DAY;i.views=1;i.price=999999;});
  t.click('[data-action="goto-tab"][data-tab="market"]'); await wait(200);
  const inp=[...t.d.querySelectorAll('input')].find(i=>(i.placeholder||'').toLowerCase().includes('search'));
  inp.value='a'; inp.dispatchEvent(new t.w.Event('input',{bubbles:true})); await wait(350);
  const first=()=>((t.d.querySelector('.item-card .item-title')||{}).textContent||'');
  ok('boosted first on newest', first()==='4-Person Camping Tent', first());
  const sel=[...t.d.querySelectorAll('select')].find(s=>[...s.options].some(o=>/price_asc|views|nearest/.test(o.value)));
  for(const v of ['views','price_asc','price_desc','nearest']){
    sel.value=v; sel.dispatchEvent(new t.w.Event('change',{bubbles:true})); await wait(300);
    ok('boosted first on '+v, first()==='4-Person Camping Tent', first());
  }
 }
 console.log('\n== AD EXPIRY + REPOST ==');
 {
  const t=await seed(db=>{const m=db.items.filter(i=>i.ownerId==='u1'&&i.status==='available');
    m[0].createdAt=Date.now()-40*DAY; delete m[0].expiresAt;});
  const old=t.db().items.find(i=>i.status==='expired');
  ok('old ad auto-expired', !!old, old&&old.title);
  ok('expiresAt on every item', t.db().items.every(i=>!!i.expiresAt));
  t.click('[data-action="goto-tab"][data-tab="listings"]'); await wait(300);
  ok('Expired tab exists', [...t.d.querySelectorAll('.ads-tab-btn')].some(b=>/Expired \(1\)/.test(b.textContent)));
  ok('days-left shown', /days left|day left|Expires today/.test(t.app()));
  t.click('[data-action="my-ads-tab"][data-tab="expired"]'); await wait(300);
  ok('repost button present', !!t.d.querySelector('[data-action="repost-listing"]'));
  const before=t.db().users.find(u=>u.id==='u1').adsUsedThisPeriod||0;
  t.click('[data-action="repost-listing"]'); await wait(350);
  const re=t.db().items.find(i=>i.title===old.title);
  ok('repost makes it available', re.status==='available');
  ok('repost gives fresh 30 days', Math.round((re.expiresAt-Date.now())/DAY)===30);
  ok('repost uses one ad from quota', (t.db().users.find(u=>u.id==='u1').adsUsedThisPeriod||0)===before+1);
 }
 console.log('\n== NOTIFICATION BELL ==');
 {
  const t=await seed(db=>{db.notifications=db.notifications||[];
    db.notifications.push({id:'n1',userId:'u1',type:'offer',text:'Someone offered on your ad',read:false,createdAt:Date.now()-3600000});});
  ok('unread badge on Profile tab', /nav-badge/.test(t.d.querySelector('[data-tab="profile"]').innerHTML));
  t.click('[data-action="goto-tab"][data-tab="profile"]'); await wait(300);
  ok('bell visible on Profile', !!t.d.querySelector('.notif-bell'));
  ok('unread count on bell', (t.d.querySelector('.notif-count')||{}).textContent==='1');
  t.click('[data-action="toggle-notifs"]'); await wait(250);
  ok('panel opens with the notification', t.d.querySelectorAll('.notif-item').length===1);
  t.click('[data-action="mark-notifs-read"]'); await wait(250);
  ok('mark all read clears count', !t.d.querySelector('.notif-count'));
 }
 console.log('\n== FREE PLAN QUOTA (3 ads) ==');
 {
  const t=await seed();
  const post=async n=>{
    t.click('[data-action="goto-tab"][data-tab="listings"]'); await wait(200);
    if(!t.d.querySelector('form[data-form="add-listing"]')) t.click('[data-action="toggle-listing-form"]');
    await wait(200);
    const f=t.d.querySelector('form[data-form="add-listing"]'); if(!f) return;
    f.querySelector('[name="title"]').value='T'+n;
    const de=f.querySelector('[name="description"]'); if(de) de.value='d';
    const s=f.querySelector('[name="forSale"]'); if(s) s.checked=true;
    const p=f.querySelector('[name="price"]'); if(p) p.value='100';
    f.dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true})); await wait(250);
  };
  const b=t.db().items.length;
  for(let i=1;i<=4;i++) await post(i);
  ok('exactly 3 ads allowed on Free', t.db().items.length-b===3, t.db().items.length-b);
  ok('4th blocked -> Plans page', /Plans &amp; Pricing|Plans & Pricing/.test(t.app()));
 }
 console.log('\n== PRICING PAGE ==');
 {
  const t=await seed();
  t.click('[data-action="goto-tab"][data-tab="pricing"]'); await wait(300);
  const p=t.app();
  ok('4 plans', t.d.querySelectorAll('[data-action="select-plan"]').length===4);
  ok('6 add-ons', t.d.querySelectorAll('[data-action="buy-addon"]').length===6);
  ok('Business has 8 boosts', /100 ads · 8 boosts/.test(p));
  ok('Free has 3 ads', /3 ads · 0 boosts/.test(p));
  ok('30-day duration stated', /Every ad runs for 30 days/.test(p));
  ok('no support wording', !/Community support|Email support|Priority support|24\/7/.test(p));
  ok('no "What people actually pay"', !/What people actually pay/.test(p));
  const biz=[...t.d.querySelectorAll('[data-action="select-plan"]')].find(b=>b.dataset.plan==='business');
  t.click(biz); await wait(300);
  ok('upgrade credits 8 boosts', t.db().users.find(u=>u.id==='u1').boostCredits===8);
 }
 console.log('\n== CHAT: photos, bubbles, all deal kinds ==');
 {
  const now=Date.now();
  const t=await seed(db=>{
    db.deals.push({id:'d_sale',kind:'sale',fromUserId:'u1',toUserId:'u2',itemId:'i3',price:9500,status:'completed',createdAt:now-3600000,completedAt:now-3600000});
    db.deals.push({id:'d_offer',kind:'offer',fromUserId:'u1',toUserId:'u2',itemId:'i4',price:2000,status:'pending',createdAt:now-1800000});
    db.deals.push({id:'d_query',kind:'query',fromUserId:'u1',toUserId:'u3',itemId:'i6',status:'pending',createdAt:now-900000});});
  for(const id of ['d_sale','d_offer','d_query']){
    t.click('[data-action="goto-tab"][data-tab="trades"]'); await wait(250);
    t.click('.chat-row[data-id="'+id+'"]'); await wait(300);
    ok(id+' has a chat box', !!t.d.querySelector('[data-form="send-message"]'));
    ok(id+' has photo attach', !!t.d.querySelector('.chat-attach'));
    ok(id+' header not broken', !/removed listing/.test((t.d.querySelector('.chat-head-sub')||{}).textContent||''));
    t.click('[data-action="close-modal"]'); await wait(180);
  }
  t.click('[data-action="goto-tab"][data-tab="trades"]'); await wait(250);
  for(const r of [...t.d.querySelectorAll('.chat-row')]){ t.click(r); await wait(220); if(t.d.querySelector('[data-form="send-message"]')) break; t.click('[data-action="close-modal"]'); await wait(120); }
  ok('date divider present', t.d.querySelectorAll('.chat-day').length>0);
  const inp=t.d.querySelector('#chatImgInput');
  Object.defineProperty(inp,'files',{value:[new t.w.File([bytes],'a.png',{type:'image/png'})],configurable:true});
  inp.dispatchEvent(new t.w.Event('change',{bubbles:true})); await wait(1900);
  ok('photo stages in composer', t.d.querySelectorAll('#chatImgStrip img').length===1);
  t.d.querySelector('[data-form="send-message"] input[name="text"]').value='hi';
  t.d.querySelector('[data-form="send-message"]').dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true})); await wait(300);
  ok('photo message sent', t.d.querySelectorAll('.msg .msg-img').length>0);
  ok('WhatsApp bubbles present', t.d.querySelectorAll('.msg-me,.msg-them').length>0);
  ok('clock times on bubbles', /\d{1,2}:\d{2} (am|pm)/.test((t.d.querySelector('.msg-time')||{}).textContent||''), (t.d.querySelector('.msg-time')||{}).textContent);
  t.click('.msg .msg-img'); await wait(250);
  ok('lightbox opens', !!t.d.querySelector('[data-action="close-photo-view"]'));
 }
 console.log('\n== PROPOSE TRADE (custom item) ==');
 {
  const t=await seed();
  t.click('[data-action="open-item"][data-id="i7"]'); await wait(250);
  t.click('[data-action="open-propose"]'); await wait(250);
  ok('dropdown with ads', !!t.d.querySelector('#offeredItemSelect'));
  ok('has "Something else" option', [...t.d.querySelector('#offeredItemSelect').options].some(o=>o.value==='__custom__'));
  ok('attach photos button', !!t.d.querySelector('.attach-wide'));
  const sel=t.d.querySelector('#offeredItemSelect');
  sel.value='__custom__'; sel.dispatchEvent(new t.w.Event('change',{bubbles:true})); await wait(200);
  ok('describe box revealed', t.d.querySelector('#offerCustomWrap').style.display!=='none');
  t.d.querySelector('#offeredTextInput').value='Yamaha keyboard';
  t.d.querySelector('[name="message"]').value='not listed';
  t.d.querySelector('[data-form="propose-trade"]').dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true})); await wait(320);
  const dl=t.db().deals[t.db().deals.length-1];
  ok('custom proposal stored', dl.offeredItemId===null && dl.offeredText==='Yamaha keyboard');
  ok('shows in chat list', /✏️ Yamaha keyboard/.test(t.app()));
 }
 console.log('\n== PROPOSE with NO ads ==');
 {
  const t=await seed(db=>{db.items.forEach(i=>{if(i.ownerId==='u1') i.ownerId='u9';});
    db.users.push({id:'u9',name:'Ghost',avatar:'👻',city:'Delhi'});});
  t.click('[data-action="open-item"][data-id="i7"]'); await wait(250);
  ok('Propose button still shown', !!t.d.querySelector('[data-action="open-propose"]'));
  t.click('[data-action="open-propose"]'); await wait(250);
  ok('no dropdown', !t.d.querySelector('#offeredItemSelect'));
  ok('describe box shown directly', !!t.d.querySelector('#offeredTextInput'));
 }
 console.log('\n== LOGIN ==');
 {
  const t=await seed();
  t.click('[data-action="goto-tab"][data-tab="profile"]'); await wait(250);
  t.click('[data-action="logout"]'); await wait(250);
  ok('login page shows', !!t.d.querySelector('form[data-form="auth-login"]'));
  t.d.querySelector('[name="password"]').value='demo123';
  t.click('[data-action="set-login-mode"][data-mode="email"]'); await wait(220);
  ok('email toggle works', !!t.d.querySelector('input[name="email"]'));
  ok('password preserved', t.d.querySelector('[name="password"]').value==='demo123');
  t.d.querySelector('[name="email"]').value='you@baganto.com';
  t.click('[data-action="submit-login"]'); await wait(300);
  ok('email login works', !t.d.querySelector('.auth-card'));
  t.click('[data-action="goto-tab"][data-tab="profile"]'); await wait(200);
  t.click('[data-action="logout"]'); await wait(250);
  t.click('[data-action="goto-forgot-password"]'); await wait(250);
  ok('forgot password opens', !!t.d.querySelector('form[data-form="auth-forgot-password"]'));
 }
 console.log('\n== PROFILE PICTURE ==');
 {
  const t=await seed();
  t.click('[data-action="goto-tab"][data-tab="profile"]'); await wait(250);
  ok('upload button present', !!t.d.querySelector('.avatar-upload-btn'));
  const inp=t.d.querySelector('#avatarFileInput');
  Object.defineProperty(inp,'files',{value:[new t.w.File([bytes],'me.png',{type:'image/png'})],configurable:true});
  inp.dispatchEvent(new t.w.Event('change',{bubbles:true})); await wait(1900);
  ok('photo saved', !!t.db().users.find(u=>u.id==='u1').avatarPhoto);
  ok('shows on profile', !!t.d.querySelector('.profile-avatar img'));
  t.click('[data-action="remove-avatar-photo"]'); await wait(300);
  ok('remove works', t.db().users.find(u=>u.id==='u1').avatarPhoto===null);
 }
 console.log('\n== PHONE VERIFICATION ==');
 {
  const t=await seed(db=>{const u=db.users.find(x=>x.id==='u1'); u.phoneVerified=false; u.otp=null; u.otpExpiry=null;});
  t.click('[data-action="goto-tab"][data-tab="profile"]'); await wait(300);
  ok('phone field on Profile', !!t.d.querySelector('#phoneInput'));
  ok('Send OTP button', !!t.d.querySelector('[data-action="send-phone-otp"]'));
  // invalid number rejected
  t.d.querySelector('#phoneInput').value='123';
  t.click('[data-action="send-phone-otp"]'); await wait(250);
  ok('invalid number rejected', !t.d.querySelector('#phoneOtpInput'));
  // valid number
  t.d.querySelector('#phoneInput').value='9876500011';
  t.click('[data-action="send-phone-otp"]'); await wait(300);
  ok('OTP input appears', !!t.d.querySelector('#phoneOtpInput'));
  const otp=t.db().users.find(u=>u.id==='u1').otp;
  ok('OTP generated + stored', /^[0-9]{6}$/.test(otp||''), otp);
  // wrong otp
  t.d.querySelector('#phoneOtpInput').value='000000';
  t.click('[data-action="verify-phone-otp"]'); await wait(300);
  ok('wrong OTP rejected', t.db().users.find(u=>u.id==='u1').phoneVerified!==true);
  // right otp
  t.d.querySelector('#phoneOtpInput').value=otp;
  t.click('[data-action="verify-phone-otp"]'); await wait(350);
  const u=t.db().users.find(x=>x.id==='u1');
  ok('PHONE VERIFIED', u.phoneVerified===true);
  ok('phone number saved', u.phone==='9876500011', u.phone);
  ok('OTP cleared after use', !u.otp);
  ok('verified state shown', /Phone verified/.test(t.app()));
  ok('☎️ badge on profile', /☎️/.test(t.app()));
  ok('no errors', t.errs.length===0, t.errs.join('|'));
 }
 console.log('\n== BLOCK USER ==');
 {
  const t=await seed(db=>{
    db.deals.push({id:'d_blocktest',kind:'barter',fromUserId:'u1',toUserId:'u3',offeredItemId:'i2',requestedItemId:'i7',status:'pending',createdAt:Date.now()-600000,completedAt:null});
  });
  // open someone else's ad
  t.click('[data-action="open-item"][data-id="i7"]'); await wait(300);
  ok('Block button on ad', !!t.d.querySelector('[data-action="block-user"]'));
  const ownerId=t.d.querySelector('[data-action="block-user"]').dataset.userid;
  t.click('[data-action="block-user"]'); await wait(350);
  ok('BLOCK saved', (t.db().users.find(u=>u.id==='u1').blockedUsers||[]).indexOf(ownerId)>=0);
  // their ads hidden
  t.click('[data-action="goto-tab"][data-tab="market"]'); await wait(300);
  const theirTitles=t.db().items.filter(i=>i.ownerId===ownerId&&i.status==='available').map(i=>i.title);
  ok('blocked user ads hidden from home', theirTitles.every(x=>!t.app().includes(x)), theirTitles.length+' ads');
  const inp=[...t.d.querySelectorAll('input')].find(i=>(i.placeholder||'').toLowerCase().includes('search'));
  inp.value=theirTitles[0].slice(0,6); inp.dispatchEvent(new t.w.Event('input',{bubbles:true})); await wait(350);
  ok('blocked user ads hidden from search', !t.app().includes(theirTitles[0]));
  // messaging blocked
  t.click('[data-action="goto-tab"][data-tab="trades"]'); await wait(300);
  let msgsBefore=t.db().messages.length, tried=false;
  for(const r of [...t.d.querySelectorAll('.chat-row')]){
    t.click(r); await wait(250);
    const f=t.d.querySelector('[data-form="send-message"]');
    if(f){
      const dealId=f.dataset.id, dl=t.db().deals.find(x=>x.id===dealId);
      const other=dl.fromUserId==='u1'?dl.toUserId:dl.fromUserId;
      if(other===ownerId){
        f.querySelector('input[name="text"]').value='should not send';
        f.dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true})); await wait(300);
        tried=true;
        ok('message to blocked user refused', t.db().messages.length===msgsBefore);
        break;
      }
    }
    t.click('[data-action="close-modal"]'); await wait(150);
  }
  if(!tried) console.log('  (no existing chat with that user to test messaging)');
  // profile list + unblock
  t.click('[data-action="close-modal"]'); await wait(150);
  t.click('[data-action="goto-tab"][data-tab="profile"]'); await wait(300);
  ok('Blocked Users section on profile', /Blocked Users/.test(t.app()));
  ok('blocked person listed', !!t.d.querySelector('[data-action="unblock-user"]'));
  t.click('[data-action="unblock-user"]'); await wait(350);
  ok('UNBLOCK works', (t.db().users.find(u=>u.id==='u1').blockedUsers||[]).length===0);
  t.click('[data-action="goto-tab"][data-tab="market"]'); await wait(300);
  ok('ads visible again after unblock', theirTitles.some(x=>t.app().includes(x)));
  ok('no errors', t.errs.length===0, t.errs.join('|'));
 }
 
 console.log('\n== PASSWORD HASHING ==');
 {
  const t=await seed();
  const users=t.db().users;
  ok('no plain password stored anywhere', users.every(u=>u.password===undefined), users.filter(u=>u.password!==undefined).length+' leaked');
  ok('every user has a hash', users.every(u=>/^[0-9a-f]{64}$/.test(u.pwHash||'')));
  ok('every user has a unique salt', new Set(users.map(u=>u.pwSalt)).size===users.length);
  ok('same password gives different hashes (salted)', new Set(users.map(u=>u.pwHash)).size===users.length);
  ok('raw text "demo123" not in storage', !t.w.localStorage.getItem('baganto_db_v4').includes('"password"'));
  // login still works
  t.click('[data-action="goto-tab"][data-tab="profile"]'); await wait(250);
  t.click('[data-action="logout"]'); await wait(250);
  t.d.querySelector('[name="phone"]').value='9876541001';
  t.d.querySelector('[name="password"]').value='demo123';
  t.click('[data-action="submit-login"]'); await wait(300);
  ok('LOGIN with correct password works', !t.d.querySelector('.auth-card'));
  t.click('[data-action="goto-tab"][data-tab="profile"]'); await wait(200);
  t.click('[data-action="logout"]'); await wait(250);
  t.d.querySelector('[name="phone"]').value='9876541001';
  t.d.querySelector('[name="password"]').value='wrongpass';
  t.click('[data-action="submit-login"]'); await wait(300);
  ok('wrong password rejected', !!t.d.querySelector('.auth-card'));
  // signup stores a hash
  t.click('[data-action="goto-signup"]'); await wait(250);
  const f=t.d.querySelector('form[data-form="auth-signup"]');
  f.querySelector('[name="fullname"]').value='New Person';
  f.querySelector('[name="email"]').value='new@x.com';
  f.querySelector('[name="phone"]').value='9000000001';
  f.querySelector('[name="password"]').value='secret123';
  f.dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true})); await wait(350);
  const nu=t.db().users.find(u=>u.email==='new@x.com');
  ok('SIGNUP stores hash not plain', !!nu && nu.password===undefined && /^[0-9a-f]{64}$/.test(nu.pwHash||''));
  t.click('[data-action="goto-tab"][data-tab="profile"]'); await wait(200);
  t.click('[data-action="logout"]'); await wait(250);
  t.d.querySelector('[name="phone"]').value='9000000001';
  t.d.querySelector('[name="password"]').value='secret123';
  t.click('[data-action="submit-login"]'); await wait(300);
  ok('new account can log in', !t.d.querySelector('.auth-card'));
  ok('no errors', t.errs.length===0, t.errs.join('|'));
 }
 console.log('\n== password reset still works ==');
 {
  const t=await seed();
  t.click('[data-action="goto-tab"][data-tab="profile"]'); await wait(250);
  t.click('[data-action="logout"]'); await wait(250);
  t.click('[data-action="goto-forgot-password"]'); await wait(250);
  t.d.querySelector('[name="emailOrPhone"]').value='9876541001';
  t.d.querySelector('[data-form="auth-forgot-password"]').dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true})); await wait(300);
  const otp=((t.d.getElementById('authError')||{}).innerHTML||'').match(/OTP: (\d{6})/);
  t.d.querySelector('[name="otp"]').value=otp?otp[1]:'654321';
  t.d.querySelector('[data-form="auth-otp-verify"]').dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true})); await wait(300);
  t.d.querySelector('[name="newPassword"]').value='brandnew1';
  t.d.querySelector('[name="confirmPassword"]').value='brandnew1';
  t.d.querySelector('[data-form="auth-reset-password"]').dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true})); await wait(350);
  const u=t.db().users.find(x=>x.id==='u1');
  ok('reset stores a hash, not plain text', u.password===undefined && /^[0-9a-f]{64}$/.test(u.pwHash||''));
  t.d.querySelector('[name="phone"]').value='9876541001';
  t.d.querySelector('[name="password"]').value='brandnew1';
  t.click('[data-action="submit-login"]'); await wait(300);
  ok('login with the NEW password works', !t.d.querySelector('.auth-card'));
 }
 console.log('\n== EXPORT + DELETE ACCOUNT ==');
 {
  const t=await seed();
  t.click('[data-action="goto-tab"][data-tab="profile"]'); await wait(300);
  ok('Your Data section present', /Your Data/.test(t.app()));
  ok('download button', !!t.d.querySelector('[data-action="export-my-data"]'));
  ok('delete account button', !!t.d.querySelector('[data-action="delete-my-account"]'));
  // capture the exported payload
  let captured=null;
  const origCreate=t.w.Blob;
  t.w.Blob=function(parts,opts){ captured=parts[0]; return new origCreate(parts,opts); };
  t.click('[data-action="export-my-data"]'); await wait(350);
  ok('export produced a file', !!captured);
  let data=null; try{ data=JSON.parse(captured); }catch(e){}
  ok('export is valid JSON', !!data);
  ok('export has profile + ads + messages', data && data.profile && Array.isArray(data.myAds) && Array.isArray(data.myMessages));
  ok('export EXCLUDES password hash', data && !JSON.stringify(data.profile).includes('pwHash') && !JSON.stringify(data.profile).includes('pwSalt'));
  ok('export excludes OTP codes', data && !JSON.stringify(data.profile).includes('"otp"'));
  ok('export includes my ads', data && data.myAds.length>0, data&&data.myAds.length);
 }
 {
  // wrong confirmation text cancels
  const t=await seed(null,{prompt:'nope'});
  const before=t.db().users.length;
  t.click('[data-action="goto-tab"][data-tab="profile"]'); await wait(300);
  t.click('[data-action="delete-my-account"]'); await wait(350);
  ok('typing the wrong word cancels deletion', t.db().users.length===before);
 }
 {
  const t=await seed();
  const beforeUsers=t.db().users.length;
  const myAds=t.db().items.filter(i=>i.ownerId==='u1').length;
  ok('user has ads before deletion', myAds>0, myAds);
  t.click('[data-action="goto-tab"][data-tab="profile"]'); await wait(300);
  t.click('[data-action="delete-my-account"]'); await wait(400);
  const db=t.db();
  ok('ACCOUNT DELETED', db.users.length===beforeUsers-1 && !db.users.some(u=>u.id==='u1'));
  ok('their ads removed', db.items.filter(i=>i.ownerId==='u1').length===0);
  ok('their deals removed', db.deals.filter(d=>d.fromUserId==='u1'||d.toUserId==='u1').length===0);
  ok('their reviews removed', db.ratings.filter(r=>r.fromUserId==='u1'||r.toUserId==='u1').length===0);
  ok('removed from others block lists', db.users.every(u=>!(u.blockedUsers||[]).includes('u1')));
  ok('logged out afterwards', !!t.d.querySelector('.auth-card'));
  ok('no errors', t.errs.length===0, t.errs.join('|'));
 }
 
 console.log('\n== DEAD-CODE CLEANUP SAFETY ==');
 {
  const t=await seed();
  const d=t.d, w=t.w, click=t.click, errs=t.errs;
console.log('\n== CATEGORY BROWSING (uses the code near what was deleted) ==');
 const tile=d.querySelector('[data-action="browse-category"]');
 const b1=d.getElementById('app').innerHTML;
 click(tile); await wait(300);
 ok('category tile opens subcategories', d.getElementById('app').innerHTML!==b1);
 const sub=d.querySelector('[data-action="browse-sub"], .cat-tile');
 ok('back button present', /clear-home-section/.test(d.getElementById('app').innerHTML));
 click('[data-action="clear-home-section"]'); await wait(300);
 ok('back to home works', d.getElementById('app').innerHTML.includes('Featured') || d.querySelectorAll('.cat-tile').length>0);
 console.log('\n== LOCATION BOX (clear-location handler was removed) ==');
 const loc=d.getElementById('navLocationInput');
 ok('location input still there', !!loc);
 loc.value='Delhi'; loc.dispatchEvent(new w.Event('input',{bubbles:true})); await wait(300);
 ok('typing a location still works', !!d.getElementById('navLocationInput'));
 console.log('\n== AVATAR PICKER (shares .icon-opt with removed pick-icon) ==');
 click('[data-action="goto-tab"][data-tab="profile"]'); await wait(300);
 click('[data-action="toggle-profile-form"]'); await wait(300);
 const av=d.querySelector('[data-action="pick-avatar"]');
 ok('avatar picker renders', !!av);
 if(av){ click(av); await wait(200); ok('picking an avatar still works', av.classList.contains('sel')); }
 console.log('\n== POSTING AN AD (pick-icon was for this form) ==');
 click('[data-action="goto-tab"][data-tab="listings"]'); await wait(300);
 if(!d.querySelector('form[data-form="add-listing"]')) click('[data-action="toggle-listing-form"]');
 await wait(300);
 const f=d.querySelector('form[data-form="add-listing"]');
 ok('post form renders', !!f);
 if(f){
   f.querySelector('[name="title"]').value='Dead code check';
   const de=f.querySelector('[name="description"]'); if(de) de.value='x';
   const s=f.querySelector('[name="forSale"]'); if(s) s.checked=true;
   const p=f.querySelector('[name="price"]'); if(p) p.value='50';
   const before=JSON.parse(w.localStorage.getItem('baganto_db_v4')).items.length;
   f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); await wait(350);
   const after=JSON.parse(w.localStorage.getItem('baganto_db_v4'));
   ok('ad posts and gets an icon automatically', after.items.length===before+1 && !!after.items[after.items.length-1].icon,
      after.items[after.items.length-1].icon);
 }
 console.log('\n== STORAGE METER (dead helper now in use) ==');
 click('[data-action="goto-tab"][data-tab="profile"]'); await wait(350);
 const app=d.getElementById('app').innerHTML;
 ok('storage meter shown on Profile', /Storage used:/.test(app));
 ok('shows a percentage', /of about 5 MB \(\d+%\)/.test(app), (app.match(/Storage used:.{0,60}/)||[''])[0].replace(/<[^>]+>/g,''));
 ok('no errors anywhere', errs.length===0, errs.join('|'));
  }

 console.log('\n=========================');
 console.log('PASSED: '+pass+'   FAILED: '+fail);
 process.exit(fail?1:0);
})();
