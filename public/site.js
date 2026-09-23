const CART_KEY='nexora_cart';

function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function getCart(){
  try{return JSON.parse(localStorage.getItem(CART_KEY)||'[]');}catch{return [];}
}

function saveCart(cart){
  localStorage.setItem(CART_KEY,JSON.stringify(cart));
  updateCartCount();
}

async function updateAccountNav(){
  const el=document.getElementById('accountLinks');
  if(!el)return;
  try{
    const r=await fetch('/api/customer/me',{credentials:'same-origin'});
    if(r.ok){
      const d=await r.json();
      if(d?.customer){el.innerHTML='<a class="account-primary" href="/compte">Mon compte</a>';return;}
    }
  }catch{}
  el.innerHTML='<a href="/connexion">Connexion</a><a class="account-primary" href="/inscription">Créer un compte</a>';
}

function updateCartCount(){
  const count=getCart().reduce((sum,item)=>sum+Math.max(0,Number(item.quantity)||0),0);
  const link=document.getElementById('cartLink');
  if(link) link.textContent='Panier ('+count+')';
}

async function loadSite(){
  try{
    const r=await fetch('/api/site');
    if(!r.ok)return;
    const d=await r.json();
    document.title=d.company_name+' — '+d.tagline;
    document.getElementById('tagline').textContent=d.tagline;
    document.getElementById('heroText').textContent=d.hero_text;
  }catch{}
}

async function loadCatalogue(){
  const el=document.getElementById('catalogueList');
  if(!el)return;
  try{
    const r=await fetch('/api/products');
    if(!r.ok)throw new Error();
    const items=await r.json();
    if(!items.length){el.innerHTML='<p class="empty-state">Catalogue en préparation.</p>';return;}
    el.innerHTML=items.map(p=>{
      const stock=Number(p.stock_quantity)||0;
      const image=p.image_url&&/^https:\/\//i.test(p.image_url)
        ? '<img class="product-image" src="'+escapeHtml(p.image_url)+'" alt="'+escapeHtml(p.name)+'" loading="lazy">'
        : '<div class="product-image placeholder" aria-hidden="true">NEXORA</div>';
      return '<article class="product-card">'+image+
        '<div class="product-body">'+
        (p.category?'<span class="product-category">'+escapeHtml(p.category)+'</span>':'')+
        '<h3>'+escapeHtml(p.name)+'</h3>'+
        (p.sku?'<small>Réf. '+escapeHtml(p.sku)+'</small>':'')+
        '<p>'+escapeHtml(p.description)+'</p>'+
        '<div class="product-meta"><strong>'+(Number(p.price_cents)/100).toFixed(2)+' '+escapeHtml(p.currency)+'</strong><span class="'+(stock>0?'in-stock':'out-stock')+'">'+(stock>0?(stock+' en stock'):'Rupture de stock')+'</span></div>'+
        '<button class="btn gold" data-product="'+encodeURIComponent(JSON.stringify(p))+'" '+(stock>0?'':'disabled')+'>'+(stock>0?'Ajouter au panier':'Indisponible')+'</button>'+
        '</div></article>';
    }).join('');
  }catch{el.innerHTML='<p class="empty-state">Le catalogue est temporairement indisponible.</p>';}
}

function addToCart(product){
  const cart=getCart();
  const stock=Math.max(0,Number(product.stock_quantity)||0);
  const index=cart.findIndex(x=>x.product_id===Number(product.id));
  if(index>=0){
    if(cart[index].quantity>=stock){alert('La quantité disponible pour ce produit est atteinte.');return;}
    cart[index].quantity+=1;
    cart[index].stock_quantity=stock;
  }else{
    cart.push({
      product_id:Number(product.id),name:product.name,price_cents:Number(product.price_cents),
      currency:product.currency,quantity:1,sku:product.sku||'',category:product.category||'',
      image_url:product.image_url||'',stock_quantity:stock
    });
  }
  saveCart(cart);
  alert('Produit ajouté au panier.');
}

const contactForm=document.getElementById('contactForm');
if(contactForm)contactForm.addEventListener('submit',async e=>{
  e.preventDefault();
  const status=document.getElementById('status');
  status.textContent='Envoi…';
  try{
    const body={name:document.getElementById('name').value,email:document.getElementById('email').value,message:document.getElementById('message').value};
    const r=await fetch('/api/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    status.textContent=d.message||d.error||'Une erreur est survenue.';
    if(r.ok)e.target.reset();
  }catch{status.textContent='Impossible de contacter le serveur.';}
});

document.addEventListener('click',e=>{
  const button=e.target.closest('[data-product]');
  if(!button)return;
  try{addToCart(JSON.parse(decodeURIComponent(button.dataset.product)));}catch{}
});

updateCartCount();
updateAccountNav();
loadSite();
loadCatalogue();