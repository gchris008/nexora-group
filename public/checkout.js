const CART_KEY='nexora_cart';
const summary=document.getElementById('summary');
const checkout=document.getElementById('checkout');
const status=document.getElementById('status');
const method=document.getElementById('paymentMethod');

function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function getCart(){try{return JSON.parse(localStorage.getItem(CART_KEY)||'[]');}catch{return [];}}
function saveCart(cart){localStorage.setItem(CART_KEY,JSON.stringify(cart));}
function money(cents,currency){return (Number(cents)/100).toFixed(2)+' '+esc(currency);}

let cart=getCart();

async function refreshCartFromServer(){
  const r=await fetch('/api/products');
  if(!r.ok)throw new Error('Impossible de vérifier le catalogue.');
  const products=await r.json();
  const byId=new Map(products.map(p=>[Number(p.id),p]));
  const next=[];
  const warnings=[];
  for(const item of cart){
    const p=byId.get(Number(item.product_id));
    if(!p){warnings.push(item.name+' n’est plus disponible.');continue;}
    const stock=Math.max(0,Number(p.stock_quantity)||0);
    if(stock<1){warnings.push(item.name+' est en rupture de stock.');continue;}
    const quantity=Math.min(Math.max(1,Number(item.quantity)||1),stock);
    if(quantity!==Number(item.quantity))warnings.push(item.name+' : quantité ajustée à '+quantity+'.');
    next.push({product_id:Number(p.id),name:p.name,price_cents:Number(p.price_cents),currency:p.currency,quantity,sku:p.sku||'',category:p.category||'',image_url:p.image_url||'',stock_quantity:stock});
  }
  cart=next;
  saveCart(cart);
  return warnings;
}

function renderSummary(){
  if(!cart.length){
    summary.innerHTML='<div class="empty-cart"><h2>Votre panier est vide.</h2><p>Retournez au catalogue pour ajouter un produit.</p><a class="btn gold" href="/#catalogue">Voir le catalogue</a></div>';
    checkout.hidden=true;
    return;
  }
  checkout.hidden=false;
  const currency=cart[0].currency;
  const total=cart.reduce((sum,x)=>sum+(Number(x.price_cents)*Number(x.quantity)),0);
  summary.innerHTML='<div class="cart-summary"><h2>Votre panier</h2>'+cart.map(x=>'<div class="cart-row"><div><strong>'+esc(x.quantity)+' × '+esc(x.name)+'</strong>'+(x.sku?'<small>Réf. '+esc(x.sku)+'</small>':'')+'</div><strong>'+money(Number(x.price_cents)*Number(x.quantity),x.currency)+'</strong></div>').join('')+'<div class="cart-total"><span>Total estimé</span><strong>'+money(total,currency)+'</strong></div><p class="cart-note">Le total final est recalculé et vérifié côté serveur au moment de la commande.</p></div>';
}

async function loadPaymentMethods(){
  const r=await fetch('/api/payments/methods');
  if(!r.ok)throw new Error('Impossible de charger les moyens de paiement.');
  const methods=await r.json();
  method.innerHTML=methods.map(m=>'<option value="'+esc(m.id)+'" '+(m.available?'':'disabled')+'>'+esc(m.label)+(m.available?'':' — configuration requise')+'</option>').join('');
  if(!methods.some(m=>m.available))status.textContent='Les moyens de paiement seront activés après configuration des comptes marchands.';
}

checkout.onsubmit=async e=>{
  e.preventDefault();
  status.textContent='Création de la commande…';
  try{
    if(!cart.length)throw new Error('Votre panier est vide.');
    const customer={
      name:document.getElementById('name').value,email:document.getElementById('email').value,
      phone:document.getElementById('phone').value,address:document.getElementById('address').value,
      city:document.getElementById('city').value,country:document.getElementById('country').value
    };
    const r=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer,items:cart.map(x=>({product_id:Number(x.product_id),quantity:Number(x.quantity)}))})});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Création de commande impossible.');
    const p=await fetch('/api/payments/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({order_id:d.order.id,method:method.value})});
    const pd=await p.json();
    if(!p.ok)throw new Error(pd.error||'Préparation du paiement impossible.');
    localStorage.removeItem(CART_KEY);
    cart=[];
    renderSummary();
    status.textContent='Commande #'+d.order.id+' créée. '+(pd.message||'Paiement en attente.');
    if(pd.checkout_url)window.location.href=pd.checkout_url;
  }catch(err){status.textContent=err.message||'Une erreur est survenue.';}
};

(async()=>{
  try{
    const warnings=await refreshCartFromServer();
    renderSummary();
    if(warnings.length)status.textContent=warnings.join(' ');
    if(cart.length)await loadPaymentMethods();
  }catch(err){
    renderSummary();
    status.textContent=err.message||'Impossible de charger la commande.';
  }
})();