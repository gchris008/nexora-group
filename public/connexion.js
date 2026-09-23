const form=document.getElementById('login');
let pending=null;
form.addEventListener('submit',async e=>{
 e.preventDefault();const msg=document.getElementById('msg');msg.textContent='Connexion…';
 try{
  const r=await fetch('/api/customer/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:document.getElementById('identifier').value,password:document.getElementById('password').value})});
  const d=await r.json();
  if(r.status===403&&d.verificationRequired){
   pending={customerId:d.customerId,phone:d.phone};document.getElementById('verificationBox').hidden=false;document.getElementById('verificationText').textContent='Un code a été envoyé au '+d.phoneMasked+'.';document.getElementById('verificationCode').focus();msg.textContent='Vérification du téléphone requise.';return;
  }
  if(!r.ok){msg.textContent=d.error||'Connexion impossible.';return;}location.href='/compte';
 }catch{msg.textContent='Impossible de contacter le serveur.';}
});
document.getElementById('verificationForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const msg=document.getElementById('verificationMsg');msg.textContent='Vérification…';
 try{const r=await fetch('/api/customer/verify-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer_id:pending.customerId,phone:pending.phone,code:document.getElementById('verificationCode').value.trim()})});const d=await r.json();if(!r.ok){msg.textContent=d.error||'Code incorrect.';return;}location.href='/compte';}catch{msg.textContent='Impossible de contacter le serveur.';}
});
