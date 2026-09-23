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

let currentAccount=null;
async function openAccount(){
  const d=document.getElementById('accountDrawer'), body=document.getElementById('accountDrawerBody');
  if(!d||!body)return;
  d.classList.add('open');d.setAttribute('aria-hidden','false');document.getElementById('cartBackdrop').hidden=false;document.body.classList.add('cart-open');
  body.innerHTML='<p class="drawer-empty">Chargement de votre espace…</p>';
  try{
    const me=await fetch('/api/customer/me',{credentials:'same-origin'});
    if(!me.ok){body.innerHTML='<div class="account-guest"><h3>Votre espace client</h3><p>Connectez-vous ou créez votre compte pour consulter votre solde, vos commandes et vos transactions.</p><div class="account-drawer-actions"><a class="btn gold" href="/connexion">Connexion</a><a class="btn" href="/inscription">Inscription</a></div></div>';return;}
    const data=await me.json();currentAccount=data.customer;
    const [or,tx]=await Promise.all([fetch('/api/customer/orders'),fetch('/api/customer/transactions')]);
    const orders=or.ok?await or.json():[], transactions=tx.ok?await tx.json():[];
    const status=s=>({pending:'En attente',confirmed:'Confirmée',processing:'En traitement',shipped:'Expédiée',delivered:'Livrée',cancelled:'Annulée'}[s]||s);
    body.innerHTML='<div class="account-summary"><strong>@'+escapeHtml(currentAccount.username)+'</strong><span>'+escapeHtml(currentAccount.email)+'</span><b>Solde : '+((Number(currentAccount.balance_cents||0)/100).toFixed(2))+' HTG</b></div>'+
      '<section class="account-mini-section"><h3>Mes informations</h3><div class="account-info-list"><span><b>Nom</b>'+escapeHtml(currentAccount.name)+'</span><span><b>E-mail</b>'+escapeHtml(currentAccount.email)+'</span><span><b>Téléphone</b>'+escapeHtml(currentAccount.phone||'—')+'</span><span><b>Adresse</b>'+escapeHtml(currentAccount.address||'—')+'</span><span><b>Ville</b>'+escapeHtml(currentAccount.city||'—')+'</span></div><a class="btn account-edit-btn" href="/compte">Modifier mes informations</a></section>'+
      '<section class="account-mini-section"><h3>Commandes</h3>'+(orders.length?orders.slice(0,5).map(x=>'<div class="account-line"><span>Commande #'+x.id+'<small>'+new Date(x.created_at).toLocaleString('fr-FR')+'</small></span><b>'+((Number(x.total_cents||0)/100).toFixed(2))+' '+escapeHtml(x.currency)+'</b><em>'+status(x.status)+'</em></div>').join(''):'<p class="drawer-empty">Aucune commande.</p>')+'</section>'+
      '<section class="account-mini-section"><h3>Transactions</h3>'+(transactions.length?transactions.slice(0,5).map(x=>'<div class="account-line"><span>Commande #'+x.order_id+'<small>'+new Date(x.created_at).toLocaleString('fr-FR')+'</small></span><b>'+((Number(x.total_cents||0)/100).toFixed(2))+' '+escapeHtml(x.currency)+'</b><em>'+escapeHtml(x.payment_status||'Non payée')+'</em></div>').join(''):'<p class="drawer-empty">Aucune transaction.</p>')+'</section>'+
      '<div class="account-drawer-actions"><a class="btn gold" href="/compte">Ouvrir mon espace</a></div>';
  }catch{body.innerHTML='<p class="drawer-empty">Impossible de charger votre espace client.</p>';}
}
function closeAccount(){const d=document.getElementById('accountDrawer');if(!d)return;d.classList.remove('open');d.setAttribute('aria-hidden','true');document.getElementById('cartBackdrop').hidden=true;document.body.classList.remove('cart-open');}

async function updateAccountNav(){
  const el=document.getElementById('accountLinks');if(!el)return;
  try{const r=await fetch('/api/customer/me',{credentials:'same-origin'});if(r.ok){const d=await r.json();if(d?.customer){el.innerHTML='<a class="account-primary" href="#compte" data-account-open>Compte</a>';return;}}}catch{}
  el.innerHTML='<a href="/connexion">Connexion</a><span aria-hidden="true"> / </span><a href="/inscription">Inscription</a>';
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
  const image=p.image_url&&(/^(https:\/\/|data:image\/)/i.test(p.image_url))?'<img class="product-image" src="'+escapeHtml(p.image_url)+'" alt="'+escapeHtml(p.name)+'" loading="lazy">':'<div class="product-image placeholder" aria-hidden="true">NEXORA</div>';
  const target='/'+(['commerce','distribution','technologie','international'].includes(p.domain)?p.domain:productDomain(p));
  return '<article class="product-card" data-product-link="'+escapeHtml(target)+'" role="link" tabindex="0">'+image+'<div class="product-body">'+
    (p.category?'<span class="product-category">'+escapeHtml(p.category)+'</span>':'')+
    '<h3>'+escapeHtml(p.name)+'</h3>'+
    (p.sku?'<small>Réf. '+escapeHtml(p.sku)+'</small>':'')+
    '<p>'+escapeHtml(p.description)+'</p>'+
    '<div class="product-meta"><strong>'+money(p.price_cents,p.currency)+'</strong><span class="'+(stock>0?'in-stock':'out-stock')+'">'+(stock>0?stock+' en stock':'Rupture de stock')+'</span></div>'+
    '<div class="quantity-row"><label>Quantité <input class="product-quantity" data-quantity-for="'+Number(p.id)+'" type="number" min="1" max="'+stock+'" value="1" '+(stock>0?'':'disabled')+'></label>'+
    '<button class="btn gold" data-add-product="'+encodeURIComponent(JSON.stringify(p))+'" '+(stock>0?'':'disabled')+'>'+(stock>0?'Ajouter au panier':'Indisponible')+'</button></div>'+
    '</div></article>';
}

function productDomain(p){
  const text=((p.category||'')+' '+(p.name||'')+' '+(p.description||'')).toLowerCase();
  if(/technolog|informat|logiciel|software|app|application|ordinateur|laptop|pc|smartphone|telephone|phone|tablette|tablet|electron|accessoire tech|gaming|serveur|réseau|network|ia|intelligence artificielle/.test(text))return 'technologie';
  if(/distribution|grossiste|wholesale|logistique|logistic|stockage|entrepôt|entrepot|approvisionnement|sourcing/.test(text))return 'distribution';
  if(/international|import|export|global/.test(text))return 'international';
  return 'commerce';
}
async function loadCatalogue(target='catalogueList',domain='commerce'){
  const el=document.getElementById(target);if(!el)return;
  try{
    const r=await fetch('/api/products');if(!r.ok)throw new Error();
    const items=(await r.json()).filter(p=>(p.domain||productDomain(p))===domain);
    el.innerHTML=items.length?items.map(productCard).join(''):'<p class="empty-state">Aucun produit dans ce domaine pour le moment.</p>';
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

async function loadFeatured(){
  const el=document.getElementById('featuredProducts'); if(!el)return;
  try{const r=await fetch('/api/products/featured');if(!r.ok)throw new Error();const items=await r.json();el.innerHTML=items.length?items.map(productCard).join(''):'<p class="empty-state">Aucun produit en vogue pour le moment.</p>';}catch{el.innerHTML='<p class="empty-state">Impossible de charger les produits en vogue.</p>';}
}

function pageTemplate(route){
  const d=pageData[route]||pageData.home;

  if(route==='home')return '<section class="hero"><div class="hero-glow hero-glow-one"></div><div class="hero-glow hero-glow-two"></div><div class="wrap hero-content"><div class="hero-copy"><p class="eyebrow">'+d.eyebrow+'</p><h1>'+d.heading+'</h1><p>'+d.intro+'</p><div class="actions"><a class="btn gold" href="/commerce" data-route="commerce">Découvrir le commerce</a><a class="btn" href="#contact" data-contact-link>Nous contacter</a></div></div><div class="hero-panel"><span>01</span><strong>COMMERCE</strong><p>Une plateforme conçue pour connecter produits, clients et opérations.</p><div class="hero-line"></div><small>Commerce · Distribution · Technologie</small></div></div></section><section class="wrap intro-section"><div><p class="eyebrow">UN GROUPE. PLUSIEURS ACTIVITÉS.</p><h2>Construire, distribuer et développer.</h2></div><p>NEXORA réunit commerce, distribution et technologie dans une même vision internationale.</p></section><section class="wrap grid business-grid"><a class="business-card-link" href="/commerce" data-route="commerce"><article><b>01</b><h2>Commerce & E-commerce</h2><p>Une plateforme commerciale moderne pour vendre, présenter et développer des offres sur plusieurs marchés.</p></article></a><a class="business-card-link" href="/distribution" data-route="distribution"><article><b>02</b><h2>Distribution</h2><p>Sourcing, distribution et développement de flux commerciaux internationaux.</p></article></a><a class="business-card-link" href="/technologie" data-route="technologie"><article><b>03</b><h2>Technologie</h2><p>Applications, services numériques et outils conçus pour accompagner la croissance du groupe.</p></article></a><a class="business-card-link" href="/international" data-route="international"><article><b>04</b><h2>International</h2><p>Une architecture pensée pour plusieurs pays, devises et opérations.</p></article></a></section><section class="wrap contact catalogue-section featured-section"><p class="eyebrow">EN VOGUE</p><div class="section-heading"><div><h2>Produits en vogue</h2><p>Les produits sélectionnés dans l'administration apparaissent ici.</p></div></div><div id="featuredProducts" class="product-grid"></div></section><section class="security"><div class="wrap"><p class="eyebrow">NEXORA SECURITY</p><h2>Une plateforme conçue avec la sécurité côté serveur.</h2><p>Authentification, sessions sécurisées, contrôle des rôles, validation des données et protection des opérations.</p></div></section><section id="contact" class="wrap contact"><p class="eyebrow">CONTACT</p><h2>Parlons de votre projet.</h2>'+contactFormHtml()+'</section>';
  if(['commerce','distribution','technologie','international'].includes(route))return '<section class="page-hero"><div class="wrap"><p class="eyebrow">'+d.eyebrow+'</p><h1>'+d.heading+'</h1><p>'+d.intro+'</p></div></section><section class="wrap info-grid"><article><b>'+d.eyebrow+'</b><h2>Produits et activités du domaine</h2><p>Les produits sont automatiquement orientés vers leur domaine selon leur catégorie, leur nom et leur description.</p></article><article><b>NEXORA GROUP</b><h2>Un espace dédié</h2><p>Chaque domaine possède son propre catalogue pour garder une navigation claire.</p></article></section><section class="wrap contact catalogue-section"><p class="eyebrow">CATALOGUE</p><div class="section-heading"><div><h2>Produits disponibles</h2><p>Choisissez la quantité avant d’ajouter un produit à votre panier.</p></div><a class="btn" href="/checkout">Ouvrir le panier</a></div><div id="catalogueList" class="product-grid"></div></section><section id="contact" class="wrap contact"><p class="eyebrow">CONTACT</p><h2>Parlons de votre projet.</h2>'+contactFormHtml()+'</section>';
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
  if(['commerce','distribution','technologie','international'].includes(route))loadCatalogue('catalogueList',route);
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
  if(e.target.closest('[data-account-open]')){e.preventDefault();openAccount();return;}
  if(e.target.closest('#closeAccount')){closeAccount();return;}
  if(e.target.closest('#closeCart')){closeCart();return;}
  if(e.target.id==='cartBackdrop'){closeCart();closeAccount();return;}
  const card=e.target.closest('[data-product-link]');if(card&&!e.target.closest('button,input,a')){navigate(card.dataset.productLink.slice(1));return;}\n  if(e.target.closest('[data-theme-toggle]'))NexoraTheme.toggle();
  const form=e.target.closest('.contact-form');if(form&&e.target.matches('button')){e.preventDefault();sendContact(form);}
});

document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeCart();closeAccount();}});
window.addEventListener('popstate',()=>renderRoute(location.pathname.slice(1)||'home'));
updateCartCount();updateAccountNav();renderRoute(location.pathname.slice(1)||'home',true);loadSite();loadFeatured();
