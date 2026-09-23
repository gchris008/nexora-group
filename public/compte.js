const money=(c,currency)=>((Number(c)||0)/100).toFixed(2)+' '+currency;
async function load(){
 try{
  const r=await fetch('/api/customer/me');
  if(!r.ok){document.getElementById('loading').hidden=true;document.getElementById('guest').hidden=false;return;}
  const d=await r.json();document.getElementById('loading').hidden=true;document.getElementById('account').hidden=false;
  document.getElementById('identity').textContent=d.customer.name+' · @'+d.customer.username+' · '+d.customer.email;
  document.getElementById('balance').textContent='Solde : '+money(d.customer.balance_cents||0,'USD');
  const o=await fetch('/api/customer/orders');const orders=await o.json();const el=document.getElementById('orders');
  if(!orders.length){el.innerHTML='<p>Aucune commande pour le moment.</p>';return;}
  const statusLabel=s=>({pending:'En attente',confirmed:'Effectuée',processing:'En traitement',shipped:'Expédiée',delivered:'Effectuée',cancelled:'Annulée'}[s]||s); el.innerHTML=orders.map(x=>'<article class="card"><strong>Commande #'+x.id+'</strong><p>Statut : '+statusLabel(x.status)+' · '+money(x.total_cents,x.currency)+'</p><p>'+new Date(x.created_at).toLocaleString('fr-FR')+'</p><ul>'+x.items.map(i=>'<li>'+i.quantity+' × '+String(i.name).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</li>').join('')+'</ul></article>').join('');
 }catch{document.getElementById('loading').hidden=true;document.getElementById('guest').hidden=false;}
}
document.getElementById('logout').addEventListener('click',async()=>{await fetch('/api/customer/logout',{method:'POST'});location.href='/';});load();