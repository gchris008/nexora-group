const form=document.getElementById('login');
form.addEventListener('submit',async e=>{
 e.preventDefault();const msg=document.getElementById('msg');msg.textContent='Connexion…';
 try{
  const r=await fetch('/api/customer/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:document.getElementById('identifier').value,password:document.getElementById('password').value})});
  const d=await r.json();if(!r.ok){msg.textContent=d.error||'Connexion impossible.';return;}location.href='/compte';
 }catch{msg.textContent='Impossible de contacter le serveur.';}
});