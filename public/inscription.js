const form=document.getElementById('register');
const fields={
 name:document.getElementById('name'),username:document.getElementById('username'),
 email:document.getElementById('email'),password:document.getElementById('password')
};
const rules={
 name:v=>/^[\p{Lu}][\p{L}'’-]*(?:\s+[\p{Lu}][\p{L}'’-]*){1,5}$/u.test(v.trim()),
 username:v=>/^[A-Za-z0-9](?:[A-Za-z0-9._-]{2,29})$/.test(v),
 email:v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
 password:v=>v.length>=12&&/[A-ZÀ-ÖØ-Þ]/.test(v)&&/[a-zà-öø-ÿ]/.test(v)&&/[0-9]/.test(v)&&/[^A-Za-zÀ-ÖØ-öø-ÿ0-9]/.test(v)
};
function setValid(id,ok,active){const el=document.getElementById(id+'Valid');el.textContent=active&&ok?'✓':'';el.classList.toggle('show',active&&ok);fields[id].classList.toggle('valid',active&&ok);fields[id].classList.toggle('invalid',active&&!ok);}
function validate(id){const v=fields[id].value;setValid(id,rules[id](v),v.length>0);return rules[id](v);}
Object.keys(fields).forEach(id=>fields[id].addEventListener('input',()=>validate(id)));
form.addEventListener('submit',async e=>{
 e.preventDefault(); const msg=document.getElementById('msg');
 const ok=Object.keys(fields).map(validate).every(Boolean);
 if(!ok){msg.textContent='Veuillez corriger les champs indiqués.';return;}
 msg.textContent='Création du compte…';
 try{
  const r=await fetch('/api/customer/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:fields.name.value.trim(),username:fields.username.value.trim(),email:fields.email.value.trim(),password:fields.password.value})});
  const d=await r.json(); if(!r.ok){msg.textContent=d.error||'Inscription impossible.';return;}
  location.href='/compte';
 }catch{msg.textContent='Impossible de contacter le serveur.';}
});