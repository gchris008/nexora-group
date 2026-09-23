const themeKey='nexora_theme';const applyTheme=()=>{const t=localStorage.getItem(themeKey)||'dark';document.documentElement.dataset.theme=t;document.querySelectorAll('[data-theme-toggle]').forEach(b=>b.textContent=t==='dark'?'☼ / ☾':'☾ / ☼');};applyTheme();document.querySelectorAll('[data-theme-toggle]').forEach(x=>x.addEventListener('click',()=>{localStorage.setItem(themeKey,(localStorage.getItem(themeKey)||'dark')==='dark'?'light':'dark');applyTheme();}));
const money=(c,currency)=>((Number(c)||0)/100).toFixed(2)+' '+currency;
let currentCustomer=null;
let pendingProfile=null;
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fillProfile(c){
 currentCustomer=c;
 document.getElementById('identity').textContent=c.name+' · @'+c.username+' · '+c.email;
 document.getElementById('balance').textContent='Solde : '+money(c.balance_cents||0,'HTG');
 document.getElementById('profileName').value=c.name||'';
 document.getElementById('profileUsername').value=c.username||'';
 document.getElementById('profileEmail').value=c.email||'';
 document.getElementById('profilePhone').value=c.phone||'';
 document.getElementById('profileAddress').value=c.address||'';
 document.getElementById('profileCity').value=c.city||'';

}
async function load(){
 try{
  const r=await fetch('/api/customer/me');
  if(!r.ok){document.getElementById('loading').hidden=true;document.getElementById('guest').hidden=false;return;}
  const d=await r.json();document.getElementById('loading').hidden=true;document.getElementById('account').hidden=false;fillProfile(d.customer);
  const o=await fetch('/api/customer/orders');const orders=await o.json();const el=document.getElementById('orders');
  if(!orders.length)el.innerHTML='<p>Aucune commande pour le moment.</p>';
  else{const statusLabel=s=>({pending:'En attente',confirmed:'Effectuée',processing:'En traitement',shipped:'Expédiée',delivered:'Effectuée',cancelled:'Annulée'}[s]||s);el.innerHTML=orders.map(x=>'<article class="card"><strong>Commande #'+x.id+'</strong><p>Statut : '+statusLabel(x.status)+' · '+money(x.total_cents,x.currency)+'</p><p>'+new Date(x.created_at).toLocaleString('fr-FR')+'</p><ul>'+x.items.map(i=>'<li>'+i.quantity+' × '+esc(i.name)+'</li>').join('')+'</ul></article>').join('');}
  const t=await fetch('/api/customer/transactions');const tx=await t.json();const tel=document.getElementById('transactions');
  tel.innerHTML=tx.length?tx.map(x=>'<div class="item"><strong>Commande #'+x.order_id+'</strong><span>'+money(x.total_cents,x.currency)+' · '+esc(x.payment_status||'non payée')+' · '+new Date(x.created_at).toLocaleString('fr-FR')+'</span></div>').join(''):'<p>Aucune transaction.</p>';
 }catch{document.getElementById('loading').hidden=true;document.getElementById('guest').hidden=false;}
}
document.getElementById('profileForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const msg=document.getElementById('profileMsg');msg.textContent='Envoi du code de vérification…';
 const data={name:profileName.value.trim(),username:profileUsername.value.trim(),email:profileEmail.value.trim(),phone:profilePhone.value.replace(/[\s().-]/g,''),address:profileAddress.value.trim(),city:profileCity.value.trim(),currentPassword:profilePassword.value};
 try{const r=await fetch('/api/customer/profile/request-verification',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const d=await r.json();if(!r.ok){msg.textContent=d.error||'Modification impossible.';return;}pendingProfile=d;document.getElementById('profileVerification').hidden=false;document.getElementById('profileVerificationText').textContent=d.message+' Téléphone : '+d.phoneMasked+(d.emailVerificationRequired?' · E-mail : '+d.emailMasked:'')+'.';document.getElementById('emailVerificationField').hidden=!d.emailVerificationRequired;document.getElementById('profileCode').focus();msg.textContent='';}catch{msg.textContent='Impossible de contacter le serveur.';}
});
document.getElementById('profileVerificationForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const msg=document.getElementById('profileVerificationMsg');msg.textContent='Vérification…';
 try{const r=await fetch('/api/customer/profile/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({purpose:pendingProfile.purpose,phone:pendingProfile.targetPhone,phoneCode:profileCode.value.trim(),emailCode:document.getElementById('profileEmailCode').value.trim()})});const d=await r.json();if(!r.ok){msg.textContent=d.error||'Code incorrect.';return;}fillProfile(d.customer);profilePassword.value='';profileCode.value='';document.getElementById('profileEmailCode').value='';document.getElementById('emailVerificationField').hidden=true;document.getElementById('profileVerification').hidden=true;msg.textContent='';document.getElementById('profileMsg').textContent='Profil mis à jour et vérifié.';}catch{msg.textContent='Impossible de contacter le serveur.';}
});
document.getElementById('logout')?.addEventListener('click',async()=>{await fetch('/api/customer/logout',{method:'POST'});location.href='/';});
load();
