const form=document.getElementById('register');
form.addEventListener('submit',async e=>{
 e.preventDefault(); const msg=document.getElementById('msg'); msg.textContent='Création du compte…';
 try{
  const r=await fetch('/api/customer/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('name').value,username:document.getElementById('username').value,email:document.getElementById('email').value,password:document.getElementById('password').value})});
  const d=await r.json(); if(!r.ok){msg.textContent=d.error||'Inscription impossible.';return;}
  location.href='/compte';
 }catch{msg.textContent='Impossible de contacter le serveur.';}
});