const CART_KEY='nexora_cart';

function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function getCart(){try{return JSON.parse(localStorage.getItem(CART_KEY)||'[]');}catch{return [];}}
function saveCart(cart){localStorage.setItem(CART_KEY,JSON.stringify(cart));updateCartCount();renderCartDrawer();}
function money(cents,currency){return (Number(cents||0)/100).toFixed(2)+' '+escapeHtml(currency||'USD');}

const NexoraTheme={
  get(){return localStorage.getItem('nexora_theme')||'dark'},
  apply(){const t=this.get();document.documentElement.dataset.theme=t;document.querySelectorAll('[data-theme-toggle]').forEach(b=>b.textContent=t==='dark'?'☼ / ☾':'☾ / ☼');},
  toggle(){localStorage.setItem('nexora_theme',this.get()==='dark'?'light':'dark');this.apply();}
};
window.NexoraTheme=NexoraTheme;NexoraTheme.apply();

function openCart(){const d=document.getElementById('cartDrawer');if(!d)return;d.classList.add('open');d.setAttribute('aria-hidden','false');document.getElementById('cartBackdrop').hidden=false;document.body.classList.add('cart-open');renderCartDrawer();}
function closeCart(){const d=document.getElementById('cartDrawer');if(!d)return;d.classList.remove('open');d.setAttribute('aria-hidden','true');document.getElementById('cartBackdrop').hidden=true;document.body.classList.remove('cart-open');}

function renderCartDrawer(){
  const items=document.getElementById('drawerCartItems'),totalEl=document.getElementById('drawerCartTotal');if(!items)return;
  const cart=getCart(),count=cart.reduce((s,x)=>s+Math.max(0,Number(x.quantity)||0),0);
  const floating=document.getElementById('floatingCartCount');if(floating)floating.textContent=count;
  if(!cart.length){items.innerHTML='<div class="drawer-empty"><strong>Votre panier est vide.</strong><p>Ajoutez un produit depuis le catalogue.</p></div>';if(totalEl)totalEl.textContent='0.00';return;}
  const currency=cart[0].currency||'USD',total=cart.reduce((s,x)=>s+Number(x.price_cents||0)*Number(x.quantity||0),0);
  items.innerHTML=cart.map((x,i)=>'<div class="drawer-row"><div><strong>'+escapeHtml(x.name)+'</strong><small>'+x.quantity+' × '+money(x.price_cents,x.currency)+'</small></div><div class="drawer-row-actions"><b>'+money(Number(x.price_cents)*Number(x.quantity),x.currency)+'</b><button type="button" data-remove-cart="'+i+'" aria-label="Retirer">×</button></div></div>').join('');
  if(totalEl)totalEl.textContent=money(total,currency);
}
function updateCartCount(){const count=getCart().reduce((s,x)=>s+Math.max(0,Number(x.quantity)||0),0);const link=document.getElementById('cartLink');if(link)link.textContent='Panier ('+count+')';renderCartDrawer();}

async function updateAccountNav(){
  const el=document.getElementById('accountLinks');if(!el)return;
  try{const r=await fetch('/api/customer/me',{credentials:'same-origin'});if(r.ok){const d=await r.json();if(d?.customer){el.innerHTML='<a class="account-primary" href="/compte">@'+escapeHtml(d.customer.username)+'</a>';return;}}}catch{}
  el.innerHTML='<a href="/connexion">Connexion</a>';
}

const pageData={
  home:{
    title:'NEXORA GROUP',
    eyebrow:'NEXORA GROUP • GLOBAL COMMERCE',
    heading:'L’infrastructure mondiale du commerce intelligent.',
    intro:'Commerce, distribution et technologie réunis dans une plateforme pensée pour l’expansion internationale.',
    body:'home'
  },
  commerce:{
    title:'Commerce & E-commerce — NEXORA GROUP',
    eyebrow:'01 • COMMERCE & E-COMMERCE',
    heading:'Une plateforme pour vendre, acheter et développer.',
    intro:'NEXORA Commerce rassemble catalogue, commandes, clients et opérations commerciales dans une expérience simple et moderne.',
    body:'commerce'
  },
  distribution:{
    title:'Distribution — NEXORA GROUP',
    eyebrow:'02 • DISTRIBUTION',
    heading:'Du sourcing à la distribution.',
    intro:'Une activité orientée import, export, approvisionnement et circulation des produits entre marchés.',
    body:'distribution'
  },
  technologie:{
    title:'Technologie — NEXORA GROUP',
    eyebrow:'03 • TECHNOLOGIE',
    heading:'La technologie au service du commerce.',
    intro:'Des outils numériques pour automatiser, gérer et faire évoluer les opérations du groupe.',
    body:'technologie'
  },
  international:{
    title:'International — NEXORA GROUP',
    eyebrow:'04 • INTERNATIONAL',
    heading:'Préparer NEXORA à plusieurs marchés.',
    intro:'Une vision conçue pour accompagner l’expansion vers de nouveaux pays, clients, partenaires et devises.',
    body:'international'
  },
  partenaires:{
    title:'Partenaires — NEXORA GROUP',
    eyebrow:'05 • PARTENAIRES',
    heading:'Construire avec des partenaires.',
    intro:'NEXORA développe des relations commerciales avec fournisseurs, distributeurs, prestataires et partenaires technologiques.',
    body:'partenaires'
  }
};

function productCard(p){
  const stock=Math.max(0,Number(p.stock_quantity)||0);
  const image=p.image_url&&/^https:\/\//i.test(p.image_url)?'<img class="product-image" src="'+escapeHtml(p.image_url)+'" alt="'+escapeHtml(p.name)+'" loading="lazy">':'<div class="product-image placeholder" aria-hidden="true">NEXORA</div>';
  return '<article class="product-card">'+image+'<div class="product-body">'+
    (p.category?'<span class="product-category">'+escapeHtml(p.category)+'</span>':'')+
    '<h3>'+escapeHtml(p.name)+'</h3>'+
    (p.sku?'<small>Réf. '+escapeHtml(p.sku)+'</small>':'')+
    '<p>'+escapeHtml(p.description)+'</p>'+
    '<div class="product-meta"><strong>'+money(p.price_cents,p.currency)+'</strong><span class="'+(stock>0?'in-stock':'out-stock')+'">'+(stock>0?stock+' en stock':'Rupture de stock')+'</span></div>'+
    '<div class="quantity-row"><label>Quantité <input class="product-quantity" data-quantity-for="'+Number(p.id)+'" type="number" min="1" max="'+stock+'" value="1" '+(stock>0?'':'disabled')+'></label>'+
    '<button class="btn gold" data-add-product="'+encodeURIComponent(JSON.stringify(p))+'" '+(stock>0?'':'disabled')+'>'+(stock>0?'Ajouter au panier':'Indisponible')+'</button></div>'+
    '</div></article>';
}

async function loadCatalogue(target='catalogueList'){
  const el=document.getElementById(target);if(!el)return;
  try{
    const r=await fetch('/api/products');if(!r.ok)throw new Error();
    const items=await r.json();
    el.innerHTML=items.length?items.map(productCard).join(''):'<p class="empty-state">Catalogue en préparation.</p>';
  }catch{el.innerHTML='<p class="empty-state">Le catalogue est temporairement indisponible.</p>';}
}

function addToCart(product,requestedQuantity=1){
  const stock=Math.max(0,Number(product.stock_quantity)||0);
  let quantity=Math.max(1,Math.floor(Number(requestedQuantity)||1));
  const cart=getCart(),index=cart.findIndex(x=>x.product_id===Number(product.id));
  const existing=index>=0?Math.max(0,Number(cart[index].quantity)||0):0;
  if(!stock||existing+quantity>stock){alert('La quantité demandée dépasse le stock disponible.');return;}
  if(index>=0){cart[index].quantity=existing+quantity;cart[index].stock_quantity=stock;}
  else cart.push({product_id:Number(product.id),name:product.name,price_cents:Number(product.price_cents),currency:product.currency,quantity,sku:product.sku||'',category:product.category||'',image_url:product.image_url||'',stock_quantity:stock});
  saveCart(cart);openCart();
}

function pageTemplate(route){
  const d=pageData[route]||pageData.home;
  if(route==='home')return '<section class="hero"><div class="hero-glow hero-glow-one"></div><div class="hero-glow hero-glow-two"></div><div class="wrap hero-content"><div class="hero-copy"><p class="eyebrow">'+d.eyebrow+'</p><h1>'+d.heading+'</h1><p>'+d.intro+'</p><div class="actions"><a class="btn gold" href="/commerce" data-route="commerce">Découvrir le commerce</a><a class="btn" href="#contact" data-contact-link>Nous contacter</a></div></div><div class="hero-panel"><span>01</span><strong>COMMERCE</strong><p>Une plateforme conçue pour connecter produits, clients et opérations.</p><div class="hero-line"></div><small>Commerce · Distribution · Technologie</small></div></div></section><section class="wrap intro-section"><div><p class="eyebrow">UN GROUPE. PLUSIEURS ACTIVITÉS.</p><h2>Construire, distribuer et développer.</h2></div><p>NEXORA réunit commerce, distribution et technologie dans une même vision internationale.</p></section><section class="wrap grid business-grid"><a class="business-card-link" href="/commerce" data-route="commerce"><article><b>01</b><h2>Commerce & E-commerce</h2><p>Une plateforme commerciale moderne pour vendre, présenter et développer des offres sur plusieurs marchés.</p></article></a><a class="business-card-link" href="/distribution" data-route="distribution"><article><b>02</b><h2>Distribution</h2><p>Sourcing, distribution et développement de flux commerciaux internationaux.</p></article></a><a class="business-card-link" href="/technologie" data-route="technologie"><article><b>03</b><h2>Technologie</h2><p>Applications, services numériques et outils conçus pour accompagner la croissance du groupe.</p></article></a><a class="business-card-link" href="/international" data-route="international"><article><b>04</b><h2>International</h2><p>Une architecture pensée pour plusieurs pays, devises et opérations.</p></article></a></section><section class="security"><div class="wrap"><p class="eyebrow">NEXORA SECURITY</p><h2>Une plateforme conçue avec la sécurité côté serveur.</h2><p>Authentification, sessions sécurisées, contrôle des rôles, validation des données et protection des opérations.</p></div></section><section id="contact" class="wrap contact"><p class="eyebrow">CONTACT</p><h2>Parlons de votre projet.</h2>'+contactFormHtml()+'</section>';
  if(route==='commerce')return '<section class="page-hero"><div class="wrap"><p class="eyebrow">'+d.eyebrow+'</p><h1>'+d.heading+'</h1><p>'+d.intro+'</p></div></section><section class="wrap info-grid"><article><b>VENTE EN LIGNE</b><h2>Catalogue et commandes</h2><p>Les produits peuvent être présentés avec leur prix, stock et quantité. Le client choisit directement combien d’unités il souhaite ajouter au panier.</p></article><article><b>EXPÉRIENCE CLIENT</b><h2>Un parcours simple</h2><p>Découverte, panier, compte client et commande sont réunis dans une expérience continue.</p></article></section><section class="wrap contact catalogue-section"><p class="eyebrow">E-COMMERCE</p><div class="section-heading"><div><h2>Produits disponibles</h2><p>Choisissez la quantité avant d’ajouter un produit à votre panier.</p></div><a class="btn" href="/checkout">Ouvrir le panier</a></div><div id="catalogueList" class="product-grid"></div></section><section id="contact" class="wrap contact"><p class="eyebrow">CONTACT</p><h2>Parlons de votre projet.</h2>'+contactFormHtml()+'</section>';
  const labels={distribution:['IMPORT / EXPORT','Approvisionnement et flux','NEXORA peut organiser son activité autour du sourcing, de l’importation, de l’exportation et de la distribution de produits.'],technologie:['SOLUTIONS NUMÉRIQUES','Services et outils','La technologie accompagne les opérations commerciales grâce à des applications, services et outils numériques.'],international:['EXPANSION INTERNATIONALE','Plusieurs marchés','NEXORA est pensée pour évoluer avec de nouveaux pays, partenaires, devises et marchés.'],partenaires:['RÉSEAU DE PARTENAIRES','Relations commerciales','NEXORA peut collaborer avec des fournisseurs, distributeurs, prestataires logistiques et partenaires technologiques.']};
  const x=labels[route];
  return '<section class="page-hero"><div class="wrap"><p class="eyebrow">'+d.eyebrow+'</p><h1>'+d.heading+'</h1><p>'+d.intro+'</p></div></section><section class="wrap info-grid"><article><b>'+x[0]+'</b><h2>'+x[1]+'</h2><p>'+x[2]+'</p></article><article><b>NEXORA GROUP</b><h2>Une vision connectée</h2><p>Commerce, distribution, technologie et internationalisation peuvent évoluer ensemble au sein du groupe.</p></article></section><section id="contact" class="wrap contact"><p class="eyebrow">CONTACT</p><h2>Parlons de votre projet.</h2>'+contactFormHtml()+'</section>';
}

function contactFormHtml(){return '<form class="contact-form"><input class="contact-name" maxlength="80" placeholder="Nom" required><input class="contact-email" type="email" maxlength="160" placeholder="E-mail" required><textarea class="contact-message" maxlength="2000" placeholder="Votre projet" required></textarea><button class="btn gold">Envoyer</button><p class="contact-status" role="status"></p></form>';}

function renderRoute(route,replace=false){
  if(!pageData[route])route='home';
  const view=document.getElementById('appView');if(!view)return;
  view.innerHTML=pageTemplate(route);
  document.title=pageData[route].title;
  document.querySelectorAll('[data-route]').forEach(a=>a.classList.toggle('active',a.dataset.route===route));
  if(route==='commerce')loadCatalogue();
  window.scrollTo({top:0,behavior:'smooth'});
  if(replace)history.replaceState({route},'',route==='home'?'/':'/'+route);
}

function navigate(route){history.pushState({route},'',route==='home'?'/':'/'+route);renderRoute(route);}
function contactTarget(){
  const target=document.getElementById('contact');
  if(target){target.scrollIntoView({behavior:'smooth',block:'start'});return;}
  navigate('home');setTimeout(()=>document.getElementById('contact')?.scrollIntoView({behavior:'smooth'}),50);
}

async function loadSite(){
  try{const r=await fetch('/api/site');if(!r.ok)return;const d=await r.json();const hero=document.querySelector('.hero h1');const intro=document.querySelector('.hero-copy>p:not(.eyebrow)');if(hero)hero.textContent=d.tagline;if(intro)intro.textContent=d.hero_text;}catch{}
}

async function sendContact(form){
  const status=form.querySelector('.contact-status');status.textContent='Envoi…';
  try{const body={name:form.querySelector('.contact-name').value,email:form.querySelector('.contact-email').value,message:form.querySelector('.contact-message').value};const r=await fetch('/api/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();status.textContent=d.message||d.error||'Une erreur est survenue.';if(r.ok)form.reset();}catch{status.textContent='Impossible de contacter le serveur.';}
}

document.addEventListener('click',e=>{
  const routeLink=e.target.closest('[data-route]');
  if(routeLink){e.preventDefault();navigate(routeLink.dataset.route);return;}
  if(e.target.closest('[data-contact-link]')){e.preventDefault();contactTarget();return;}
  const button=e.target.closest('[data-add-product]');
  if(button){try{const product=JSON.parse(decodeURIComponent(button.dataset.addProduct));const input=document.querySelector('[data-quantity-for="'+Number(product.id)+'"]');addToCart(product,input?.value||1);}catch{}return;}
  const remove=e.target.closest('[data-remove-cart]');
  if(remove){const cart=getCart();cart.splice(Number(remove.dataset.removeCart),1);saveCart(cart);return;}
  if(e.target.closest('#floatingCart,#cartLink')){e.preventDefault();openCart();return;}
  if(e.target.closest('#closeCart,#cartBackdrop')){closeCart();return;}
  if(e.target.closest('[data-theme-toggle]'))NexoraTheme.toggle();
  const form=e.target.closest('.contact-form');if(form&&e.target.matches('button')){e.preventDefault();sendContact(form);}
});

document.addEventListener('keydown',e=>{if(e.key==='Escape')closeCart();});
window.addEventListener('popstate',()=>renderRoute(location.pathname.slice(1)||'home'));
updateCartCount();updateAccountNav();renderRoute(location.pathname.slice(1)||'home',true);loadSite();
