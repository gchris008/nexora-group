const form=document.getElementById('register');
const verificationBox=document.getElementById('verificationBox');
const verificationForm=document.getElementById('verificationForm');
const fields={
 name:document.getElementById('name'),username:document.getElementById('username'),
 email:document.getElementById('email'),phone:document.getElementById('phone'),password:document.getElementById('password')
};
const rules={
 name:v=>/^[\p{Lu}][\p{L}'’-]*(?:\s+[\p{Lu}][\p{L}'’-]*){1,5}$/u.test(v.trim()),
 username:v=>/^[A-Za-z0-9](?:[A-Za-z0-9._-]{2,29})$/.test(v),
 email:v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
 phone:v=>/^\+[1-9]\d{7,14}$/.test(v.replace(/[\s().-]/g,'')),
 password:v=>v.length>=12&&/[A-ZÀ-ÖØ-Þ]/.test(v)&&/[a-zà-öø-ÿ]/.test(v)&&/[0-9]/.test(v)&&/[^A-Za-zÀ-ÖØ-öø-ÿ0-9]/.test(v)
};
let pending=null;
function setValid(id,ok,active){const el=document.getElementById(id+'Valid');el.textContent=active&&ok?'✓':'';el.classList.toggle('show',active&&ok);fields[id].classList.toggle('valid',active&&ok);fields[id].classList.toggle('invalid',active&&!ok);}
function validate(id){const v=fields[id].value;setValid(id,rules[id](v),v.length>0);return rules[id](v);}
Object.keys(fields).forEach(id=>fields[id].addEventListener('input',()=>validate(id)));
form.addEventListener('submit',async e=>{
 e.preventDefault(); const msg=document.getElementById('msg');
 const ok=Object.keys(fields).map(validate).every(Boolean);
 if(!ok){msg.textContent='Veuillez corriger les champs indiqués.';return;}
 msg.textContent='Création du compte et envoi du code…';
 try{
  const payload={name:fields.name.value.trim(),username:fields.username.value.trim(),email:fields.email.value.trim(),phone:fields.phone.value.replace(/[\s().-]/g,''),password:fields.password.value};
  const r=await fetch('/api/customer/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const d=await r.json(); if(!r.ok){msg.textContent=d.error||'Inscription impossible.';return;}
  pending={customerId:d.customerId,phone:d.phone};
  verificationBox.hidden=false; form.hidden=true;
  document.getElementById('verificationText').textContent='Un code a été envoyé au '+d.phoneMasked+'. Saisissez-le pour activer votre compte.';
  document.getElementById('verificationCode').focus();
 }catch{msg.textContent='Impossible de contacter le serveur.';}
});
verificationForm.addEventListener('submit',async e=>{
 e.preventDefault();const msg=document.getElementById('verificationMsg');msg.textContent='Vérification…';
 try{
  const r=await fetch('/api/customer/verify-registration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer_id:pending.customerId,phone:pending.phone,code:document.getElementById('verificationCode').value.trim()})});
  const d=await r.json();if(!r.ok){msg.textContent=d.error||'Code incorrect.';return;}location.href='/compte';
 }catch{msg.textContent='Impossible de contacter le serveur.';}
});
document.getElementById('resendCode').addEventListener('click',async()=>{
 if(!pending)return;const msg=document.getElementById('verificationMsg');msg.textContent='Envoi…';
 try{const r=await fetch('/api/customer/resend-registration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer_id:pending.customerId,phone:pending.phone})});const d=await r.json();msg.textContent=d.message||d.error||'Demande terminée.';}catch{msg.textContent='Impossible de contacter le serveur.';}
});
document.querySelector('[data-theme-toggle]')?.addEventListener('click',()=>window.NexoraTheme?.toggle());
