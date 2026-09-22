import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase, ref, set, onValue, push, remove, get } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

/* ══════════════════════════════════════════════════════════════
   AGORA — tronc commun aux trois commissions.
   Aucune valeur propre à une commission ici : tout ce qui varie est
   lu dans window.AGORA_CONFIG, défini par config-<commission>.js,
   chargé AVANT ce fichier.
   Base : Affaires Scolaires (version la plus avancée au 22/09/2026),
   plus le bouton « Supprimer les cochées » corrigé de Cadre de Vie.
   ══════════════════════════════════════════════════════════════ */
const CFG = window.AGORA_CONFIG;
if (!CFG) throw new Error("AGORA : configuration absente. Charger config-<commission>.js avant agora-core.js.");
const LOGP = '[' + CFG.logPrefix + '] ';


const COMMISSION = CFG.branch;
const FB_PRESET = {
  apiKey:      "AIzaSyBkIqarLb7CmCwuricfLv3iBwQ1IcGKHm4",
  authDomain:  "mairie-lestiac-2026.firebaseapp.com",
  databaseURL: "https://mairie-lestiac-2026-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:   "mairie-lestiac-2026"
};
const K_PWD   = CFG.keys.pwd;
const K_USER  = 'lestiac_user';
const K_FB    = 'lestiac_fb';
const K_LOCAL = CFG.keys.local;
const K_EJS   = CFG.keys.ejs;
const K_VISITED = CFG.keys.visited;

const ALL_MEMBERS = ['Daniel','Catherine','Corinne','Sylvain','Vivien','Anthony','Rose','Michel','Roger','Lalie','Claire','Sophie'];
// Super-admins pouvant assigner à n'importe qui
const SUPER_ADMINS = ['Daniel','Catherine','Corinne','Sylvain'];
const MEMBER_EMAILS = {'Daniel':'daniel.bouchet@lestiac.fr','Catherine':'catherine.penard@lestiac.fr','Corinne':'corinne.eeckeman@lestiac.fr','Sylvain':'sylvain.kornowski@lestiac.fr','Vivien':'vivien.bomont@lestiac.fr','Anthony':'anthony.benoit@lestiac.fr','Rose':'rose.adjei@lestiac.fr','Michel':'michel.jorge@lestiac.fr','Roger':'roger.carteau@lestiac.fr','Lalie':'lalie.deredin@lestiac.fr','Claire':'claire.gaston@lestiac.fr','Sophie':'sophie.larrieumanan@free.fr'};

const AXE_LABELS = CFG.axeLabels;
const AXE_CLASSES = CFG.axeClasses;

/* ════ SOUS-COMMISSIONS ════
   Modèle : { id, nom (librement modifiable), commissions[], membres[], devis[], decisions[] }
   Persistance locale pour l'instant (clé K_SUBCOM) ; à brancher sur Firebase
   (/subcommissions) ultérieurement — partagé entre les 3 fichiers pour le transversal. */
const COMMISSIONS = {cdv:'Cadre de Vie', adm:'Administration Générale', sco:'Affaires Scolaires'};
const COMMISSION_COURANTE = CFG.code;
const DEVIS_STATUS = {demande:{label:'Demandé',cls:'ds-demande'},recu:{label:'Reçu',cls:'ds-recu'},valide:{label:'Validé',cls:'ds-valide'},refuse:{label:'Refusé',cls:'ds-refuse'}};
// Amorces reprises des libellés d'axe — noms 100% renommables, ids stables
const SUBCOM_DEFAULTS = CFG.subcomDefaults;
const K_SUBCOM = CFG.keys.subcom;
const SUBCOM_NODE='subcommissions'; // ⚠ nœud PARTAGÉ entre les 3 commissions (hors COMMISSION) — c'est lui qui rend le transversal réel
const ELODIE_EMAIL='accueil-lestiac@lestiac.fr'; // secrétariat mairie — destinataire rebouclage
const TRASH_NODE='subcommissions_trash'; // ⚠ nœud PARTAGÉ — corbeille des sous-commissions supprimées (toutes commissions)
const TRASH_RETENTION_DAYS=30;
const TRASH_RETENTION_MS=TRASH_RETENTION_DAYS*24*60*60*1000;
let _subcomData=null;                // peuplé en temps réel par subscribeSubcoms() dès que Firebase est connecté
let _trashData=null;                 // peuplé en temps réel par subscribeTrash() dès que Firebase est connecté
/* Normalise une sous-commission lue depuis Firebase : ce backend NE STOCKE PAS les tableaux
   vides, donc membres/devis/decisions/commissions peuvent revenir `undefined`. Sans cette
   garde, tout accès `.length`/`...spread` plante (ex : ajout de décision sans effet). */
function _normSub(id,raw){
  const base=SUBCOM_DEFAULTS[id]||{id,nom:id,commissions:[COMMISSION_COURANTE]};
  const o={...base,...(raw||{})};
  o.id=o.id||id;
  o.commissions=Array.isArray(o.commissions)?o.commissions:(base.commissions||[COMMISSION_COURANTE]);
  o.membres=Array.isArray(o.membres)?o.membres:[];
  o.devis=Array.isArray(o.devis)?o.devis:[];
  o.decisions=Array.isArray(o.decisions)?o.decisions:[];
  return o;
}
function getSubcoms(){
  const src=_subcomData?{...SUBCOM_DEFAULTS,..._subcomData}:_localSubcoms();
  const out={};
  Object.keys(src).forEach(id=>{out[id]=_normSub(id,src[id])});
  return out;
}
function _localSubcoms(){
  try{const o=JSON.parse(localStorage.getItem(K_SUBCOM));return o&&typeof o==='object'?{...SUBCOM_DEFAULTS,...o}:{...SUBCOM_DEFAULTS}}catch{return {...SUBCOM_DEFAULTS}}
}
let _subcomSub=false, _trashSub=false;
/* Phase 1 — amorçage différé : on n'écrit les amorces par défaut qu'une fois les DEUX flux
   (sous-commissions + corbeille) chargés, et seulement si l'amorce n'a jamais été supprimée
   explicitement par un admin (présente dans la corbeille). Corrige l'auto-création silencieuse. */
function maybeSeedDefaults(){
  if(_subcomData===null||_trashData===null)return; // attendre les deux flux avant d'agir
  Object.keys(SUBCOM_DEFAULTS).forEach(id=>{
    if(_subcomData[id])return;   // déjà existante (amorce ou confirmée) — jamais écrasée
    if(_trashData[id])return;    // supprimée explicitement par un admin — ne pas la ré-amorcer
    fbSet(SUBCOM_NODE+'/'+id,{...SUBCOM_DEFAULTS[id],_draft:true});
  });
}
function purgeOldTrash(){
  if(!_trashData)return;
  const now=Date.now();
  Object.entries(_trashData).forEach(([id,item])=>{
    if(item&&item._deletedAt&&(now-item._deletedAt)>TRASH_RETENTION_MS)fbRemove(TRASH_NODE+'/'+id);
  });
}
function subscribeSubcoms(){
  if(!fbDb||_subcomSub)return;_subcomSub=true;
  onValue(ref(fbDb,SUBCOM_NODE),snap=>{
    _subcomData=snap.val()||{};
    maybeSeedDefaults();
    if(typeof renderProjects==='function')renderProjects();
    if(typeof _refreshOpenBabs==='function')_refreshOpenBabs();
    if(typeof renderSubcomAdmin==='function')renderSubcomAdmin();
  },()=>{});
  subscribeTrash();
}
function subscribeTrash(){
  if(!fbDb||_trashSub)return;_trashSub=true;
  onValue(ref(fbDb,TRASH_NODE),snap=>{
    _trashData=snap.val()||{};
    purgeOldTrash();
    maybeSeedDefaults();
    if(typeof renderSubcomAdmin==='function')renderSubcomAdmin();
  },()=>{});
}
function getProjSubcomIds(p){const ids=[];if(p.axe)ids.push(p.axe);(Array.isArray(p.subcoms)?p.subcoms:[]).forEach(id=>{if(id&&!ids.includes(id))ids.push(id)});return ids}
const _scEur=n=>{const v=parseFloat(n)||0;return v.toLocaleString('fr-FR')+' €'};
const _scInit=n=>(n||'?').slice(0,2).toUpperCase();
const _scDate=d=>{try{return new Date(d+'T00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'})}catch{return d}};

const DEFAULT_PROJECTS = CFG.defaultProjects;

const DEFAULT_TASKS = {court:[],moyen:[],long:[]};

// ── STATE ──
let isAdmin=false, fbApp=null, fbDb=null, fbConnected=false;
let _currentProjId=null, _notesTimer=null, _pendingJoin=null;
let localData={projects:null,tasks:null,reunions:null,log:[],cr:[],budget:null,quickTasks:null};
let _ptAssignee=null; // assigné sélectionné dans le form tâche projet
let _newProjChefs=[]; // porteurs sélectionnés dans le formulaire ajout projet
let _filterAxe='tous'; // filtre sous-commission actif
let _showArchived=false; // bascule : afficher les projets archivés au lieu des actifs
let _editingChefs=[]; // porteurs en cours d'édition dans la modale détail


// ── LOCAL HELPERS ──
function getLocal(){try{return JSON.parse(localStorage.getItem(K_LOCAL))||{};}catch{return{}}}
function saveLocal(d){localStorage.setItem(K_LOCAL,JSON.stringify(d))}
function getPwd(){return localStorage.getItem(K_PWD)||'lestiac2026'}
function getCurrentUser(){return localStorage.getItem(K_USER)||null}
function isSuperAdmin(){const me=getCurrentUser();return isAdmin||(me&&SUPER_ADMINS.includes(me))}
function getFbConfig(){try{return JSON.parse(localStorage.getItem(K_FB))||null;}catch{return null}}
function getEjsConfig(){try{return JSON.parse(localStorage.getItem(K_EJS))||null;}catch{return null}}

// ── VISITED ──
function getVisited(){try{return JSON.parse(localStorage.getItem(K_VISITED))||{};}catch{return{}}}
function markVisited(projId){const v=getVisited();v[projId]=Date.now();localStorage.setItem(K_VISITED,JSON.stringify(v))}
function hasNew(p){
  const v=getVisited();const lastVisit=v[p.id]||0;
  const lastComment=(p.comments&&typeof p.comments==="object"&&!Array.isArray(p.comments))?Math.max(...Object.values(p.comments).map(c=>c.ts||0)):0;
  const lastNote=p.notesTs||0;
  const lastPtask=(p.project_tasks&&typeof p.project_tasks==="object"&&!Array.isArray(p.project_tasks))?Math.max(...Object.values(p.project_tasks).map(t=>t.ts||0)):0;
  return Math.max(lastComment,lastNote,lastPtask)>lastVisit;
}

// ── FIREBASE ──
function safeValues(obj){
  if(!obj||typeof obj!=='object'||Array.isArray(obj))return null;
  return Object.values(obj);
}
function initFirebase(config){
  if(!config||!config.apiKey||!config.databaseURL){
    console.warn(LOGP+'initFirebase: config manquante ou incomplète');
    return;
  }
  try{
    console.log(LOGP+'Firebase init start');
    setBanner('connecting','⏳ Connexion Firebase…');
    fbApp=initializeApp(config,CFG.branch+'-'+Date.now());
    fbDb=getDatabase(fbApp);
    onValue(ref(fbDb,COMMISSION),(snap)=>{
      if(!fbConnected){
        fbConnected=true;subscribeSubcoms();
        document.getElementById('fb-config-status').textContent='✅ Connecté : '+config.projectId;
        console.log(LOGP+'Firebase connected');
      }
      const raw=snap.val();
      if(raw===null){
        // Branche Firebase vide — pas une erreur, juste pas encore de données distantes
        console.log(LOGP+'No remote data found — branche '+COMMISSION+' vide, fallback sur defaults');
        setBanner('empty','ℹ️ Firebase connecté — aucune donnée pour cette commission');
        if(!localData.projects)localData.projects=null;
        if(!localData.tasks)localData.tasks=null;
        if(!localData.reunions)localData.reunions=null;
        renderAll();
        return;
      }
      const data=raw;
      setBanner('ok','✅ Firebase connecté');
      const rawProjects=safeValues(data.projects);
      localData.projects=rawProjects?rawProjects.filter(p=>p&&p.id):null;
      localData.tasks=data.tasks&&typeof data.tasks==='object'?data.tasks:null;
      const rawReunions=safeValues(data.reunions);
      localData.reunions=rawReunions?rawReunions.filter(r=>r&&r.id):null;
      const rawLog=safeValues(data.log);
      localData.log=rawLog?rawLog.filter(Boolean).sort((a,b)=>b.ts-a.ts):[];
      const rawCr=safeValues(data.cr);
      localData.cr=rawCr?rawCr.filter(Boolean).sort((a,b)=>b.ts-a.ts):[];
      localData.budget=data.budget&&typeof data.budget==='object'?data.budget:null;
      const rawQt=safeValues(data.quickTasks);
      localData.quickTasks=rawQt?rawQt.filter(Boolean).sort((a,b)=>(b.ts||0)-(a.ts||0)):[];
      if(data.config&&data.config.driveUrl)applyDriveUrl(data.config.driveUrl);
      if(data.config&&data.config.emailjs)applyEmailJSConfig(data.config.emailjs);
      renderAll();
      // Démarrer le suivi des messages non lus dès la connexion
      if(typeof trackUnread==='function')trackUnread();
      // Si modal projet ouvert, rafraîchir tâches
      if(_currentProjId){
        const p=getProjects().find(x=>x.id===_currentProjId);
        if(p)renderPtasks(_currentProjId,p.project_tasks||{});
      }
      onValue(ref(fbDb,'finances/global'),(snap2)=>{
        const gb=snap2.val();
        if(gb&&typeof gb==='object'){const el=document.getElementById('budget-global-display');if(el)el.textContent=`Budget global commune : ${gb.total||'—'} € · Consommé : ${gb.consomme||'—'} €`;}
      });
    },(err)=>{
      console.error(LOGP+'Firebase init error:',err.message);
      setBanner('err','❌ Erreur Firebase : '+err.message);
      fbConnected=false;
    });
  }catch(e){
    console.error(LOGP+'Firebase init error (exception):',e.message);
    setBanner('err','❌ Config Firebase invalide');
  }
}
function fbSet(path,val){
  if(!fbDb){showToast('⚠ Hors-ligne : modification non enregistrée','warn');return Promise.reject(new Error('no-db'));}
  return set(ref(fbDb,path),val).catch(e=>{
    console.error(LOGP+'fbSet error:',e);
    showToast('❌ Échec d\'enregistrement : '+(e&&e.message?e.message:'permission refusée ?'),'warn');
    throw e;
  });
}
function fbPush(path,val){if(!fbDb)return;push(ref(fbDb,path),val).catch(e=>console.error(LOGP+'fbPush error:',e))}
function fbRemove(path){if(!fbDb)return;remove(ref(fbDb,path)).catch(e=>console.error(LOGP+'fbRemove error:',e))}
function setBanner(type,msg){const b=document.getElementById('fb-banner');if(!b)return;b.className=type;b.textContent=msg;if(type==='ok')setTimeout(()=>{b.style.opacity='0';setTimeout(()=>{b.style.display='none';b.style.opacity=''},600)},3000);else{b.style.display='';b.style.opacity=''}}

// ── DATA ACCESS ──
function getProjects(){if(localData.projects)return localData.projects;return getLocal().projects||JSON.parse(JSON.stringify(DEFAULT_PROJECTS))}
function getTasks(){if(localData.tasks)return localData.tasks;const l=getLocal();return l.tasks||JSON.parse(JSON.stringify(DEFAULT_TASKS))}
function getReunions(){if(localData.reunions)return localData.reunions;return getLocal().reunions||[]}
function getCRs(){return localData.cr||(getLocal().crs||[])}
function getLog(){return localData.log||(getLocal().log||[])}
function getBudget(){return localData.budget||(getLocal().budget||null)}

function writeProjects(arr){const obj={};arr.forEach(p=>{obj[p.id]=p});if(fbDb)fbSet(COMMISSION+'/projects',obj);else{const d=getLocal();d.projects=arr;saveLocal(d)}}
function writeTasks(t){if(fbDb)fbSet(COMMISSION+'/tasks',t);else{const d=getLocal();d.tasks=t;saveLocal(d)}}
function writeReunions(arr){const obj={};arr.forEach((r,i)=>{obj[r.id||('r'+i)]=r});if(fbDb)fbSet(COMMISSION+'/reunions',obj);else{const d=getLocal();d.reunions=arr;saveLocal(d)}}
function writeLog(e){if(fbDb)fbPush(COMMISSION+'/log',e);else{const d=getLocal();if(!d.log)d.log=[];d.log.unshift(e);saveLocal(d);localData.log=d.log;renderLog()}}
function deleteCR(idOrIdx){
  if(!confirm('Supprimer ce compte rendu ?'))return;
  // Sécurisation NaN : parseInt peut échouer si idOrIdx est une string 'crXXX'
  const numIdx = parseInt(idOrIdx, 10);
  const hasNumIdx = !isNaN(numIdx) && numIdx >= 0;
  if(fbDb){
    const crs=getCRs();
    // Chercher d'abord par id string, ensuite par index numérique si valide
    const cr=crs.find(c=>c.id===idOrIdx)||(hasNumIdx?crs[numIdx]:null);
    if(cr&&cr.fbKey){
      fbRemove(COMMISSION+'/cr/'+cr.fbKey);
    } else if(cr){
      // CR trouvé mais sans fbKey — fallback local
      const d=getLocal();
      if(d.crs)d.crs=d.crs.filter(c=>c.id!==idOrIdx);
      saveLocal(d);localData.cr=d.crs||[];renderCRs();
    } else {
      console.warn('[deleteCR] CR introuvable pour id/idx:', idOrIdx);
    }
  } else {
    const d=getLocal();
    if(d.crs){
      // Filtrer par id string ET par index numérique (si valide)
      d.crs=d.crs.filter((c,i)=>c.id!==idOrIdx&&(!hasNumIdx||i!==numIdx));
      saveLocal(d);localData.cr=d.crs;renderCRs();
    }
  }
}
window.deleteCR = deleteCR; // correctif 22/07/2026 : fonction jamais exposée à window → bouton 🗑 des CR inopérant
function writeCR(cr){if(fbDb)fbPush(COMMISSION+'/cr',cr);else{const d=getLocal();if(!d.crs)d.crs=[];d.crs.unshift(cr);saveLocal(d);localData.cr=d.crs;renderCRs()}}
function writeBudget(b){if(fbDb)fbSet(COMMISSION+'/budget',b);else{const d=getLocal();d.budget=b;saveLocal(d);localData.budget=b}}
function logAction(action,detail){const who=getCurrentUser()||'Anonyme';writeLog({who,action,detail,ts:Date.now(),time:new Date().toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})})}

// ── NAV ──
function nav(id,btn){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn,[data-page]').forEach(b=>b.classList.remove('active'));
  const pg=document.getElementById('page-'+id);if(pg)pg.classList.add('active');
  document.querySelectorAll(`[data-page="${id}"]`).forEach(b=>b.classList.add('active'));
  if(btn)btn.classList.add('active');
  if(id==='journal')renderLog();
  if(id==='finances')renderFinances();
  if(id==='chat')initDMPage();
  if(id==='admin')renderSubcomAdmin();
}
window.nav=nav;

// ── AUTH ──
function requestAdmin(){if(isAdmin){logout();return}document.getElementById('gate').classList.add('show');setTimeout(()=>document.getElementById('gate-pwd').focus(),100)}
window.requestAdmin=requestAdmin;
function doLogin(){
  const pwd=document.getElementById('gate-pwd').value;
  if(pwd===getPwd()){
    isAdmin=true;document.body.classList.add('is-admin');
    document.getElementById('gate').classList.remove('show');
    document.getElementById('gate-err').style.display='none';
    document.getElementById('gate-pwd').value='';
    document.getElementById('btn-mode').classList.add('admin');
    document.getElementById('mode-label').textContent='Admin';
    document.getElementById('nav-locked').style.display='none';
    const cfg=getFbConfig()||FB_PRESET;
    ['apiKey','databaseURL','projectId'].forEach(k=>{const el=document.getElementById('fb-'+k);if(el&&cfg[k])el.value=cfg[k]});
    const ejs=getEjsConfig();
    // EmailJS config pré-remplie via applyEmailJSConfig au chargement Firebase
    if(!fbConnected)initFirebase(cfg);
    renderAll();
  }else{document.getElementById('gate-err').style.display='block'}
}
window.doLogin=doLogin;
function closeGate(){document.getElementById('gate').classList.remove('show');document.getElementById('gate-pwd').value='';document.getElementById('gate-err').style.display='none'}
window.closeGate=closeGate;
function logout(){isAdmin=false;document.body.classList.remove('is-admin');document.getElementById('btn-mode').classList.remove('admin');document.getElementById('mode-label').textContent='Participants';document.getElementById('nav-locked').style.display='';nav(CFG.homePage,document.querySelector('[data-page="'+CFG.homePage+'"]'));renderAll()}
window.logout=logout;

// ── IDENTITY ──
function openIdModal(){const me=getCurrentUser();document.querySelectorAll('.id-pick-btn').forEach(b=>b.classList.toggle('selected',b.textContent.trim()===me));document.getElementById('id-modal-bg').classList.add('open')}
window.openIdModal=openIdModal;
function closeIdModal(){document.getElementById('id-modal-bg').classList.remove('open');_pendingJoin=null}
window.closeIdModal=closeIdModal;
function pickIdentity(name){localStorage.setItem(K_USER,name);closeIdModal();updateIdentityBtn();if(_pendingJoin){_doToggleMember(_pendingJoin,name);_pendingJoin=null}renderProjects();initDMPage()}
window.pickIdentity=pickIdentity;
function pickCustomIdentity(){const name=document.getElementById('id-custom-name').value.trim();if(!name)return;pickIdentity(name);document.getElementById('id-custom-name').value=''}
window.pickCustomIdentity=pickCustomIdentity;
function updateIdentityBtn(){const me=getCurrentUser();document.getElementById('identity-label').textContent=me?'👤 '+me:"M'identifier";document.getElementById('btn-identity').classList.toggle('identified',!!me)}
document.getElementById('id-modal-bg').addEventListener('click',e=>{if(e.target===document.getElementById('id-modal-bg'))closeIdModal()});

// ── MODALS ──
function openModal(id){document.getElementById(id).classList.add('open');if(id==='m-reunion')populateReunionProjSelect();if(id==='m-proj'){_newProjChefs=[];renderChefChips('p-chefs-chips',[])}}
function closeModal(id){document.getElementById(id).classList.remove('open');}
function closeOverlay(e,id){if(e.target===document.getElementById(id))closeModal(id)}
window.openModal=openModal;window.closeModal=closeModal;window.closeOverlay=closeOverlay;

// ── RENDER ALL ──
function renderAll(){
  // Guard défensif : ne pas rendre si gate encore visible (auth non établie)
  const gate = document.getElementById('gate');
  if (gate && gate.classList.contains('show')) return;
  // Guard : vérifier que les conteneurs principaux existent
  if (!document.getElementById('proj-grid')) return;
  renderProjects();
  renderReunions();
  renderTasks();
  renderCRs();
  updateStats();
  if(typeof renderQuickTasks==='function') renderQuickTasks();
  if(typeof updateDashShortcuts==='function') updateDashShortcuts();
}

// ── STATS ──
function updateStats(){
  const p=getProjects(),t=getTasks(),r=getReunions(),c=getCRs();
  const done=[...(t.court||[]),...(t.moyen||[]),...(t.long||[])].filter(x=>x.done).length;
  // Guard défensif : les stats peuvent ne pas être dans le DOM actif
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('s-ct', p.filter(x=>x.horizon==='court'&&!x.archived).length);
  set('s-mt', p.filter(x=>x.horizon==='moyen'&&!x.archived).length);
  set('s-lt', p.filter(x=>x.horizon==='long'&&!x.archived).length);
  set('s-rdv', r.length);
  set('s-cr', c.length);
  set('s-tasks', done);
}

// ── PROJECTS ──
function getMembersArr(p){if(!p.members)return[];if(Array.isArray(p.members))return p.members;return p.members.split(',').map(s=>s.trim()).filter(Boolean)}
function renderMemberChips(projId,membersArr){
  const me=getCurrentUser();
  return ALL_MEMBERS.map(name=>{
    const active=membersArr.includes(name),isMe=name===me;
    return `<span class="mchip${active?' active':''}${active&&isMe?' is-me':''}" onclick="toggleMember('${projId}','${name}')"><span class="chip-check">✓</span>${name}</span>`;
  }).join('');
}

function renderProjects(){
  const grid=document.getElementById('proj-grid');if(!grid)return;grid.innerHTML='';
  let projs=getProjects();
  if(!projs){grid.innerHTML='<div class="empty-state"><div class="ei">📋</div><p>Aucun projet.</p></div>';return}
  if(!Array.isArray(projs))projs=Object.values(projs);
  projs=projs.filter(p=>p&&p.id&&(_showArchived?p.archived:!p.archived)&&(_filterAxe==='tous'||!p.axe||p.axe===_filterAxe));
  if(!projs.length){grid.innerHTML='<div class="empty-state"><div class="ei">📦</div><p>'+(_showArchived?'Aucun projet archivé.':'Aucun projet.')+'</p></div>';return}
  const hL={court:'Court terme · 2026',moyen:'Moyen terme · 2027',long:'Long terme · 2028+'};
  const hB={court:'h-court',moyen:'h-moyen',long:'h-long'};
  const aC={env:'',vie:'purple',gouv:'navy'};
  const sL={'s-lancer':'À lancer','s-cours':'En cours','s-attente':'En attente','s-fait':'Réalisé'};
  const me=getCurrentUser();
  projs=[...projs.filter(p=>p.priority==='urgent'),...projs.filter(p=>p.priority!=='urgent')];
  projs.forEach(p=>{
    const m=getMembersArr(p),j=me&&m.includes(me);
    const newActivity=hasNew(p);
    // Compter tâches projet actives
    const ptasks=p.project_tasks?Object.values(p.project_tasks):[];
    const openPtasks=ptasks.filter(t=>t.status!=='done').length;
    const overduePtasks=ptasks.filter(t=>t.status!=='done'&&t.deadline&&new Date(t.deadline)<new Date()).length;
    const card=document.createElement('div');
    card.className=`proj-card ${aC[p.axe]||''}${p.archived?' archived':''}`;card.dataset.horizon=p.horizon;card.dataset.id=p.id;
    card.innerHTML=`
      <div class="notif-dot${newActivity?' show':''}"></div>
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:6px">
        <span class="proj-horizon ${hB[p.horizon]}">${hL[p.horizon]}</span>
        <span class="proj-cat-badge ${AXE_CLASSES[p.axe]||''}">${AXE_LABELS[p.axe]||p.axe}</span>
        ${p.priority==='urgent'?'<span class="priority-banner">🔴 Prioritaire</span>':''}
        ${p.archived?'<span class="proj-horizon" style="background:#8a949f;color:#fff">📦 Archivé</span>':''}
      </div>
      <div class="proj-chefs">
        <span class="proj-chefs-label">👑 Chef${getChefsArr(p).length>1?'s':''} :</span>
        ${getChefsArr(p).length
          ? getChefsArr(p).map(c=>`<span class="chef-badge">${escapeHtml(c)}</span>`).join('')
          : '<span style="font-size:11px;color:var(--softer);font-style:italic">— Non défini</span>'}
      </div>
      ${isSuperAdmin()?`<button class="btn-icon" style="position:absolute;top:10px;right:${isAdmin?'48':'22'}px" title="${p.archived?'Désarchiver':'Archiver'}" onclick="event.stopPropagation();toggleArchiveProj('${p.id}')">${p.archived?'♻️':'📦'}</button>`:''}
      ${isAdmin?`<button class="btn-icon" style="position:absolute;top:10px;right:22px" onclick="event.stopPropagation();deleteProj('${p.id}')">🗑</button>`:''}
      <div class="proj-title" onclick="openProjDetail('${p.id}')">${escapeHtml(p.title)}</div>
      <div class="proj-desc" onclick="openProjDetail('${p.id}')">${escapeHtml(p.desc||"")}</div>
      ${renderSubAttach(p)}
      <div class="proj-meta"><span class="status-pill ${p.status}">${sL[p.status]}</span>
        ${isAdmin?`<select class="form-control" style="padding:2px 6px;font-size:11px;width:auto" onchange="changeStatus('${p.id}',this.value)"><option value="s-lancer"${p.status==='s-lancer'?' selected':''}>À lancer</option><option value="s-cours"${p.status==='s-cours'?' selected':''}>En cours</option><option value="s-attente"${p.status==='s-attente'?' selected':''}>En attente</option><option value="s-fait"${p.status==='s-fait'?' selected':''}>Réalisé</option></select>`:''}</div>
      <div style="margin-top:10px"><div class="members-zone-label">👥 Participants</div>
        <div class="member-chips-proj" id="chips-${p.id}">${renderMemberChips(p.id,m)}</div>
        <button class="btn-join${j?' joined':''}" onclick="joinProject('${p.id}')">${j?'✓ Inscrit·e':'+ Rejoindre'}</button></div>
      <div class="proj-budget">💶 ${p.budget}${p.subs&&p.subs!=='—'?' · '+p.subs:''}</div>
      ${p.sophie?`<div style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;background:#FFF3E0;color:#E65100;padding:3px 9px;border-radius:20px;margin-top:4px">📣 Sophie sollicitée</div>`:''}
      ${p.source?`<div class="proj-source">${escapeHtml(p.source)}</div>`:''}
      <div style="margin-top:8px;display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap">
        ${openPtasks>0?`<span style="font-size:11px;font-weight:700;background:${overduePtasks>0?'var(--terra)':'var(--teal)'};color:white;padding:2px 8px;border-radius:20px">${overduePtasks>0?'⚠ ':'✅ '}${openPtasks} tâche${openPtasks>1?'s':''}</span>`:''}
        <button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="openProjDetail('${p.id}')">
          Détail${newActivity?' 🔴':''} →
        </button>
      </div>
      <div class="bab-mount" id="bab-${p.id}"></div>`;
    grid.appendChild(card);
  });
  // ré-affiche les panneaux Babouchka restés ouverts après un re-render
  Object.keys(_babState).forEach(pid=>{ if(document.getElementById('bab-'+pid)) renderBab(pid); });
}

function filterProj(h,btn){document.querySelectorAll('#page-projets .tab').forEach(b=>b.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('#proj-grid .proj-card').forEach(c=>{c.style.display=(h==='tous'||c.dataset.horizon===h)?'':'none'})}
window.filterProj=filterProj;

function saveProj(){
  const title=document.getElementById('p-title').value.trim();if(!title)return;
  const me=getCurrentUser()||'';
  const chefsArr=[..._newProjChefs];const piloteVal=chefsArr[0]||me;
  const sophieChecked=document.getElementById('p-sophie')?.checked||false;const p={id:'a'+Date.now(),horizon:document.getElementById('p-horizon').value,axe:document.getElementById('p-axe').value,title,pilote:piloteVal,chefs:chefsArr,status:document.getElementById('p-status').value,desc:document.getElementById('p-desc').value.trim(),members:chefsArr.length?[...chefsArr]:[],budget:document.getElementById('p-budget').value.trim(),subs:document.getElementById('p-subs').value.trim(),source:'Ajouté manuellement',sophie:sophieChecked};
  const arr=getProjects();arr.push(p);writeProjects(arr);logAction('Nouveau projet','«'+title+'»'+(sophieChecked?' [Sophie]':''));if(sophieChecked)notifySophie(title);closeModal('m-proj');if(document.getElementById('p-sophie'))document.getElementById('p-sophie').checked=false;_newProjChefs=[];renderChefChips('p-chefs-chips',[]);
  if(!fbConnected)renderAll()
}
window.saveProj=saveProj;
function deleteProj(id){if(!confirm('Supprimer ?'))return;const arr=getProjects().filter(p=>p.id!==id);writeProjects(arr);logAction('Projet supprimé','ID:'+id);if(!fbConnected)renderAll()}
window.deleteProj=deleteProj;
function toggleArchiveProj(id){const arr=getProjects(),p=arr.find(x=>x.id===id);if(!p)return;p.archived=!p.archived;if(p.archived){p.archivedTs=Date.now();p.archivedBy=getCurrentUser()||'';}else{delete p.archivedTs;delete p.archivedBy;}writeProjects(arr);logAction(p.archived?'Projet archivé':'Projet désarchivé','«'+p.title+'»');if(!fbConnected)renderAll();else renderProjects();}
window.toggleArchiveProj=toggleArchiveProj;
function toggleArchiveView(btn){_showArchived=!_showArchived;if(btn){btn.textContent=_showArchived?'← Projets actifs':'📦 Voir les archives';btn.classList.toggle('active',_showArchived);}renderProjects();}
window.toggleArchiveView=toggleArchiveView;
function changeStatus(id,val){const arr=getProjects(),p=arr.find(x=>x.id===id);if(p){p.status=val;writeProjects(arr);logAction('Statut','«'+p.title+'» → '+val)}if(!fbConnected)renderAll()}
window.changeStatus=changeStatus;
function changePriority(id,val){const arr=getProjects(),p=arr.find(x=>x.id===id);if(p){p.priority=val;writeProjects(arr);logAction('Priorité','«'+p.title+'» → '+val)}if(!fbConnected)renderAll()}
window.changePriority=changePriority;

// Member chips
function toggleMember(projId,name){const me=getCurrentUser();if(!isAdmin&&name!==me){if(!me){_pendingJoin=projId;openIdModal()}return}if(!me&&!isAdmin){_pendingJoin=projId;openIdModal();return}_doToggleMember(projId,name)}
window.toggleMember=toggleMember;
function _doToggleMember(projId,memberName){const arr=getProjects(),p=arr.find(x=>x.id===projId);if(!p)return;let m=getMembersArr(p);const j=!m.includes(memberName);m=j?[...m,memberName]:m.filter(x=>x!==memberName);p.members=m;writeProjects(arr);logAction(j?'Inscription':'Désinscription','«'+p.title+'» — '+memberName);const el=document.getElementById('chips-'+projId);if(el)el.innerHTML=renderMemberChips(projId,m);const btn=document.querySelector(`.proj-card[data-id="${projId}"] .btn-join`);if(btn&&getCurrentUser()){const jj=m.includes(getCurrentUser());btn.textContent=jj?'✓ Inscrit·e':'+ Rejoindre';btn.className='btn-join'+(jj?' joined':'')}updateStats()}
function joinProject(projId){const me=getCurrentUser();if(!me){_pendingJoin=projId;openIdModal();return}_doToggleMember(projId,me)}
window.joinProject=joinProject;

// ── DETAIL TAB SWITCH ──
function switchDetailTab(panel,btn){
  document.querySelectorAll('.detail-tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.detail-panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-'+panel).classList.add('active');
}
window.switchDetailTab=switchDetailTab;

// ═══════════════════════════════════════════
// ── PROJECT TASKS (tâches par projet) ──
// ═══════════════════════════════════════════

function deadlineBadge(deadline,status){
  if(status==='done')return`<span class="ptask-deadline dl-ok">✓ Terminé</span>`;
  if(!deadline)return`<span class="ptask-deadline dl-none">Pas de date</span>`;
  const now=new Date();now.setHours(0,0,0,0);
  const dl=new Date(deadline);dl.setHours(0,0,0,0);
  const diff=Math.ceil((dl-now)/(1000*60*60*24));
  const label=dl.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
  if(diff<0)return`<span class="ptask-deadline dl-overdue">🔴 En retard · ${label}</span>`;
  if(diff===0)return`<span class="ptask-deadline dl-soon">⚠ Aujourd'hui · ${label}</span>`;
  if(diff<=3)return`<span class="ptask-deadline dl-soon">⏰ ${diff}j · ${label}</span>`;
  return`<span class="ptask-deadline dl-ok">📅 ${label}</span>`;
}

function getStatusLabel(s){return{todo:'À faire',doing:'En cours',done:'Terminé'}[s]||'À faire'}

function renderPtasks(projId,obj){
  const me=getCurrentUser();
  const list=document.getElementById('ptask-list');
  list.innerHTML='';
  const tasks=Object.entries(obj||{}).sort((a,b)=>(a[1].ts||0)-(b[1].ts||0));
  // Update badge count
  const openCount=tasks.filter(([,t])=>t.status!=='done').length;
  const badge=document.getElementById('ptask-count-badge');
  if(openCount>0){badge.textContent=openCount;badge.style.display=''}else{badge.style.display='none'}

  if(!tasks.length){
    list.innerHTML='<div class="ptask-empty">Aucune tâche pour ce projet.<br>Cliquez sur « + Ajouter une tâche » pour commencer.</div>';
    return;
  }
  tasks.forEach(([key,t])=>{
    const isOverdue=t.status!=='done'&&t.deadline&&new Date(t.deadline)<new Date();
    const isDueSoon=!isOverdue&&t.status!=='done'&&t.deadline&&Math.ceil((new Date(t.deadline)-new Date())/(1000*60*60*24))<=3;
    const isMe=t.assignee===me;
    const row=document.createElement('div');
    row.className=`ptask-row status-${t.status||'todo'}${isOverdue?' overdue':''}${isDueSoon?' due-soon':''}`;

    // Droits de modification : propriétaire de la tâche ou super-admin
    const canEdit=isAdmin||isSuperAdmin()||isMe;
    const statusSel=canEdit
      ?`<select class="ptask-status-sel" onchange="updatePtaskStatus('${projId}','${key}',this.value)">
          <option value="todo"${(t.status||'todo')==='todo'?' selected':''}>À faire</option>
          <option value="doing"${t.status==='doing'?' selected':''}>En cours</option>
          <option value="done"${t.status==='done'?' selected':''}>Terminé</option>
        </select>`
      :`<span style="font-size:11px;color:var(--soft)">${getStatusLabel(t.status)}</span>`;

    const delBtn=canEdit
      ?`<button class="ptask-del" onclick="deletePtask('${projId}','${key}')" title="Supprimer">✕</button>`:'';
    const editBtn=canEdit
      ?`<button class="ptask-del" onclick="editPtask('${projId}','${key}')" title="Modifier" style="margin-right:2px">✎</button>`:'';

    row.innerHTML=`
      <div class="ptask-main">
        <div class="ptask-title">${t.title}</div>
        <div class="ptask-meta">
          ${t.assignee?`<span class="ptask-assignee${isMe?' is-me':''}">👤 ${t.assignee}</span>`:'<span class="ptask-assignee" style="opacity:.6">Non assigné</span>'}
          ${deadlineBadge(t.deadline,t.status||'todo')}
          ${statusSel}
        </div>
      </div>
      ${editBtn}${delBtn}`;
    list.appendChild(row);
  });
}

function updatePtaskStatus(projId,key,newStatus){
  const arr=getProjects(),p=arr.find(x=>x.id===projId);if(!p)return;
  if(!p.project_tasks)p.project_tasks={};
  if(!p.project_tasks[key])return;
  p.project_tasks[key].status=newStatus;
  writeProjects(arr);
  logAction('Tâche projet','Statut → '+newStatus+' · «'+p.project_tasks[key].title+'»');
  renderPtasks(projId,p.project_tasks);
  renderProjects();
  if(!fbConnected)localData.projects=arr;
}
window.updatePtaskStatus=updatePtaskStatus;

function deletePtask(projId,key){
  if(!confirm('Supprimer cette tâche ?'))return;
  const arr=getProjects(),p=arr.find(x=>x.id===projId);if(!p||!p.project_tasks)return;
  const title=p.project_tasks[key]?.title||'';
  delete p.project_tasks[key];
  writeProjects(arr);
  logAction('Tâche projet supprimée','«'+title+'»');
  renderPtasks(projId,p.project_tasks);
  renderProjects();
  if(!fbConnected)localData.projects=arr;
}
window.deletePtask=deletePtask;
function editPtask(projId,key){const arr=getProjects(),p=arr.find(x=>x.id===projId);if(!p||!p.project_tasks||!p.project_tasks[key])return;const v=prompt('Modifier la tâche :',p.project_tasks[key].title||'');if(v===null)return;const nv=v.trim();if(!nv)return;p.project_tasks[key].title=nv;p.project_tasks[key].ts=Date.now();writeProjects(arr);logAction('Tâche projet modifiée','«'+nv.substring(0,50)+'»');renderPtasks(projId,p.project_tasks);renderProjects();if(!fbConnected)localData.projects=arr;}
window.editPtask=editPtask;

function showPtaskForm(){
  const me=getCurrentUser();
  // Remplir chips assignation
  const chipsEl=document.getElementById('pt-assign-chips');
  chipsEl.innerHTML='';
  // Qui peut assigner ?
  const canAssignOthers=isAdmin||isSuperAdmin();
  const members=canAssignOthers?ALL_MEMBERS:(me?[me]:[]);
  _ptAssignee=me||null; // pré-sélectionner soi-même
  members.forEach(name=>{
    const chip=document.createElement('button');
    chip.className='ptask-assign-chip'+(name===_ptAssignee?' selected':'');
    chip.textContent=name;
    chip.onclick=()=>{
      _ptAssignee=name;
      document.querySelectorAll('.ptask-assign-chip').forEach(c=>c.classList.remove('selected'));
      chip.classList.add('selected');
    };
    chipsEl.appendChild(chip);
  });
  // Afficher form
  document.getElementById('ptask-add-form').style.display='block';
  document.getElementById('ptask-add-btn-wrap').style.display='none';
  document.getElementById('pt-title').focus();
}
window.showPtaskForm=showPtaskForm;

function cancelAddPtask(){
  document.getElementById('ptask-add-form').style.display='none';
  document.getElementById('ptask-add-btn-wrap').style.display='';
  document.getElementById('pt-title').value='';
  document.getElementById('pt-deadline').value='';
  _ptAssignee=null;
}
window.cancelAddPtask=cancelAddPtask;

function savePtask(){
  if(!_currentProjId)return;
  const title=document.getElementById('pt-title').value.trim();
  if(!title){alert('Le titre est obligatoire.');return}
  const deadline=document.getElementById('pt-deadline').value;
  const assignee=_ptAssignee||null;
  const me=getCurrentUser();
  // Droit : peut-on assigner à quelqu'un d'autre ?
  if(assignee&&assignee!==me&&!isAdmin&&!isSuperAdmin()){
    alert('Vous ne pouvez vous assigner qu\'à vous-même.');return;
  }
  const arr=getProjects(),p=arr.find(x=>x.id===_currentProjId);if(!p)return;
  if(!p.project_tasks)p.project_tasks={};
  const key='pt'+Date.now();
  p.project_tasks[key]={title,assignee,deadline,status:'todo',ts:Date.now(),by:me||'Anonyme'};
  writeProjects(arr);
  logAction('Tâche projet ajoutée','«'+title+'»'+(assignee?' → '+assignee:''));
  cancelAddPtask();
  renderPtasks(_currentProjId,p.project_tasks);
  renderProjects();
  if(!fbConnected)localData.projects=arr;
}
window.savePtask=savePtask;

// ── PROJET DETAIL ──
function openProjDetail(projId){
  _currentProjId=projId;
  markVisited(projId);
  const p=getProjects().find(x=>x.id===projId);if(!p)return;
  const sL={'s-lancer':'À lancer','s-cours':'En cours','s-attente':'En attente','s-fait':'Réalisé'};
  const hL={court:'Court terme · 2026',moyen:'Moyen terme · 2027',long:'Long terme · 2028+'};
  const hB={court:'h-court',moyen:'h-moyen',long:'h-long'};
  document.getElementById('proj-detail-title').textContent=p.title;
  document.getElementById('proj-detail-meta').innerHTML=
    `<span class="proj-horizon ${hB[p.horizon]}">${hL[p.horizon]}</span>
     <span class="status-pill ${p.status}">${sL[p.status]}</span>
     <span class="proj-cat-badge inline ${AXE_CLASSES[p.axe]||''}">${AXE_LABELS[p.axe]||p.axe}</span>`;
  // En charge du projet
  renderDetailChefs(p);
  document.getElementById('proj-detail-desc').textContent=p.desc||'';
  document.getElementById('proj-detail-budget').innerHTML=`💶 ${escapeHtml(p.budget||'')}${p.subs&&p.subs!=='—'?' · '+escapeHtml(p.subs):''}`;
  document.getElementById('proj-detail-source').textContent=p.source?'Source : '+p.source:'';
  renderElodieStatus(p);
  const m=getMembersArr(p),me=getCurrentUser(),j=me&&m.includes(me);
  document.getElementById('proj-detail-chips').innerHTML=renderMemberChips(projId,m);
  const jb=document.getElementById('proj-detail-join');jb.textContent=j?'✓ Inscrit·e':'+ Rejoindre';jb.className='btn-join'+(j?' joined':'');
  // Notes
  const notesText=typeof p.notes==='object'&&p.notes?p.notes.text:(p.notes||'');
  const notesWho=typeof p.notes==='object'&&p.notes?p.notes.who:null;
  const notesTs=typeof p.notes==='object'&&p.notes?p.notes.ts:null;
  document.getElementById('proj-detail-notes').value=notesText;
  const authorEl=document.getElementById('proj-notes-author');
  if(notesWho){const d=notesTs?new Date(notesTs).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';authorEl.style.display='flex';authorEl.innerHTML=`✏️ Dernière note par <strong>${notesWho}</strong>${d?' · '+d:''}`;
  }else{authorEl.style.display='none'}
  document.getElementById('proj-notes-status').textContent='';
  // Commentaires
  renderComments(projId,p.comments||{});
  // Tâches projet
  renderPtasks(projId,p.project_tasks||{});
  // Reset form tâche
  cancelAddPtask();
  // Reset onglet → Notes par défaut
  document.querySelectorAll('.detail-tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.detail-panel').forEach(pn=>pn.classList.remove('active'));
  document.querySelector('.detail-tab').classList.add('active');
  document.getElementById('panel-notes').classList.add('active');
  // Init Drive link
  if(_driveUrl)document.getElementById('drive-folder-link').href=_driveUrl;
  // Mettre à jour dot carte
  const dot=document.querySelector(`.proj-card[data-id="${projId}"] .notif-dot`);
  if(dot)dot.classList.remove('show');
  // Bouton renommage visible uniquement en super-admin
  const renameBtn=document.getElementById('btn-rename-proj');
  if(renameBtn)renameBtn.style.display=(isSuperAdmin()||isAdmin)?'':'none';
  document.getElementById('rename-proj-bar').style.display='none';
  // Reset édition inline
  const inlineEdit=document.getElementById('proj-inline-edit');
  if(inlineEdit)inlineEdit.style.display='none';
  const editBtn=document.getElementById('proj-edit-btn');
  if(editBtn)editBtn.style.display='';
  openModal('m-proj-detail');
}
window.openProjDetail=openProjDetail;

function renderComments(projId,obj){
  const cont=document.getElementById('proj-detail-comments');
  if(!cont)return;
  cont.innerHTML='';
  const me=getCurrentUser();
  const entries=Object.entries(obj||{}).sort((a,b)=>(a[1].ts||0)-(b[1].ts||0));
  if(!entries.length){
    cont.innerHTML='<div style="text-align:center;color:var(--softer);font-size:13px;margin-top:20px">Aucun message sur ce projet.</div>';
    return;
  }
  let lastDate='';
  entries.forEach(([key,x])=>{
    const mine=x.who===me;
    const canDel=isAdmin||isSuperAdmin()||(me&&me===x.who);
    const d=new Date(x.ts||0);
    const dateStr=x.ts?d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'}):'';
    const timeStr=x.ts?d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'';
    // Séparateur de date
    if(dateStr&&dateStr!==lastDate){
      const sep=document.createElement('div');
      sep.style.cssText='text-align:center;font-size:11px;color:var(--softer);margin:8px 0;display:flex;align-items:center;gap:8px';
      sep.innerHTML=`<hr style="flex:1;border:none;border-top:1px solid var(--mid)"><span>${escapeHtml(dateStr)}</span><hr style="flex:1;border:none;border-top:1px solid var(--mid)">`;
      cont.appendChild(sep);
      lastDate=dateStr;
    }
    const wrap=document.createElement('div');
    wrap.style.cssText=`display:flex;flex-direction:column;max-width:75%;align-self:${mine?'flex-end':'flex-start'};align-items:${mine?'flex-end':'flex-start'}`;
    const meta=document.createElement('div');
    meta.style.cssText='font-size:10.5px;color:var(--softer);margin-bottom:2px;display:flex;align-items:center;gap:6px';
    meta.innerHTML=(!mine?`<strong>${escapeHtml(x.who||'?')}</strong>`:'')
      +`<span>${escapeHtml(timeStr)}</span>`
      +(canDel?`<button onclick="deleteComment('${projId}','${key}')" title="Supprimer" style="background:none;border:none;color:var(--softer);font-size:11px;cursor:pointer;padding:0 2px" onmouseover="this.style.color='var(--terra)'" onmouseout="this.style.color='var(--softer)'">🗑</button>`:'');
    const bubble=document.createElement('div');
    bubble.style.cssText=`padding:9px 14px;border-radius:${mine?'18px 18px 4px 18px':'18px 18px 18px 4px'};font-size:13px;line-height:1.5;word-break:break-word;`
      +(mine?'background:var(--accent);color:white':'background:var(--light);border:1px solid var(--mid);color:var(--text)');
    bubble.textContent=x.text||'';
    wrap.appendChild(meta);
    wrap.appendChild(bubble);
    cont.appendChild(wrap);
  });
  cont.scrollTop=cont.scrollHeight;
}

function deleteComment(projId,key){
  if(!confirm('Supprimer ce commentaire ?'))return;
  const arr=getProjects(),p=arr.find(x=>x.id===projId);if(!p||!p.comments)return;
  delete p.comments[key];
  writeProjects(arr);
  logAction('Commentaire supprimé','Projet: '+p.title);
  renderComments(projId,p.comments);
  if(!fbConnected)localData.projects=arr;
}
window.deleteComment=deleteComment;

function addComment(){
  if(!_currentProjId)return;
  const inp=document.getElementById('proj-comment-input');const text=(inp?.value||'').trim();if(!text)return;
  const who=getCurrentUser()||'Anonyme';
  const time=new Date().toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  const c={who,text,time,ts:Date.now()};
  const arr=getProjects(),p=arr.find(x=>x.id===_currentProjId);if(!p)return;
  if(!p.comments)p.comments={};
  p.comments['c'+Date.now()]=c;
  writeProjects(arr);logAction('Commentaire','«'+p.title+'»');inp.value='';
  renderComments(_currentProjId,p.comments);
  if(!fbConnected)localData.projects=arr;
  // Notifier les membres du projet
  notifyCommentToMembers(p, c);
}
window.addComment=addComment;

function autoSaveNotes(){
  if(!_currentProjId)return;clearTimeout(_notesTimer);
  document.getElementById('proj-notes-status').textContent='✏️ En cours…';
  _notesTimer=setTimeout(()=>{
    const text=document.getElementById('proj-detail-notes').value;
    const who=getCurrentUser()||'Anonyme';const ts=Date.now();
    const arr=getProjects(),p=arr.find(x=>x.id===_currentProjId);if(!p)return;
    p.notes={text,who,ts};p.notesTs=ts;
    writeProjects(arr);logAction('Notes','«'+p.title+'»');
    document.getElementById('proj-notes-status').textContent='✅ Sauvegardé';
    const d=new Date(ts).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    const authorEl=document.getElementById('proj-notes-author');
    authorEl.style.display='flex';authorEl.innerHTML=`✏️ Dernière note par <strong>${who}</strong> · ${d}`;
    setTimeout(()=>document.getElementById('proj-notes-status').textContent='',2000);
    if(!fbConnected)localData.projects=arr;
  },1200)
}
window.autoSaveNotes=autoSaveNotes;

function joinFromDetail(){if(!_currentProjId)return;joinProject(_currentProjId);const p=getProjects().find(x=>x.id===_currentProjId);if(p){const m=getMembersArr(p),me=getCurrentUser();document.getElementById('proj-detail-chips').innerHTML=renderMemberChips(_currentProjId,m);const jb=document.getElementById('proj-detail-join');const j=me&&m.includes(me);jb.textContent=j?'✓ Inscrit·e':'+ Rejoindre';jb.className='btn-join'+(j?' joined':'')}}
window.joinFromDetail=joinFromDetail;
function deleteProjFromDetail(){if(!_currentProjId)return;closeModal('m-proj-detail');deleteProj(_currentProjId)}
window.deleteProjFromDetail=deleteProjFromDetail;

// ── RÉUNIONS ──
function renderReunions(){
  const list=document.getElementById('reunion-list'),empty=document.getElementById('reunion-empty'),arr=getReunions();
  if(!list||!empty)return;
  list.innerHTML='';empty.style.display=arr.length===0?'':'none';
  arr.forEach((r,i)=>{
    const hd=r.date&&r.date.trim();let day='À',mon='FIXER',yr='',cls='empty';
    if(hd){const d=new Date(r.date);day=d.getDate();mon=d.toLocaleString('fr-FR',{month:'short'}).toUpperCase();yr=d.getFullYear();cls=''}
    const tags=(r.tags||'').split(',').filter(t=>t.trim()).map(t=>`<span class="mtag">${t.trim()}</span>`).join('');
    const card=document.createElement('div');card.className='meeting-card';
    card.innerHTML=`<div class="m-date-col ${cls}"><div class="m-day">${day}</div><div class="m-month">${mon}</div>${yr?`<div class="m-year">${yr}</div>`:''}</div>
      <div class="m-body"><div class="m-title">${r.title}</div>
        <div class="m-meta">${hd?new Date(r.date).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'}):'Date à fixer'}${r.heure?' · '+r.heure:''} · ${r.lieu||'Mairie'}</div>
        <div class="m-tags">${tags}</div>${r.participants?`<div class="m-parts">👥 ${escapeHtml(r.participants||"")}</div>`:''}${r.notes?`<div class="m-notes">${r.notes}</div>`:''}</div>
      <div class="m-actions">${hd?`<button class="btn btn-cal btn-sm" onclick='exportGcal(${JSON.stringify(r)})'>📅 Google</button><button class="btn btn-apple btn-sm" onclick='exportIcal(${JSON.stringify(r)})'>🍎 Apple</button>`:'<span style="font-size:11px;color:var(--soft)">Date à fixer</span>'}
        ${isAdmin?`<button class="btn btn-ghost-red btn-sm" onclick="deleteReunion(${i})">🗑</button>`:''}</div>`;
    list.appendChild(card);
  });updateStats();
}
function saveReunion(){const title=document.getElementById('r-title').value.trim();if(!title)return;const projSelect=document.getElementById('r-projet');const linkedProjId=projSelect?projSelect.value:'';const r={id:'r'+Date.now(),title,date:document.getElementById('r-date').value,heure:document.getElementById('r-heure').value,lieu:document.getElementById('r-lieu').value.trim()||'Mairie de Lestiac',participants:document.getElementById('r-parts').value.trim(),tags:document.getElementById('r-tags').value.trim(),notes:document.getElementById('r-notes').value.trim(),createdBy:getCurrentUser()||'Anonyme',linkedProjId};const arr=getReunions();arr.push(r);writeReunions(arr);logAction('Réunion planifiée','«'+title+'»');notifyMeetingToParticipants(r);closeModal('m-reunion');['r-title','r-date','r-tags','r-notes'].forEach(id=>document.getElementById(id).value='');if(!fbConnected)renderAll()}
window.saveReunion=saveReunion;
function deleteReunion(i){
  const arr=getReunions();const r=arr[i];
  const me=getCurrentUser();
  if(!isAdmin&&!isSuperAdmin()&&r.createdBy&&r.createdBy!==me){alert('Seul le créateur ou un admin peut supprimer cette réunion.');return}
  if(!confirm('Supprimer cette réunion ?'))return;
  arr.splice(i,1);writeReunions(arr);logAction('Réunion supprimée',r.title||'');if(!fbConnected)renderAll()
}
window.deleteReunion=deleteReunion;
function exportGcal(r){if(!r.date)return;const d=new Date(r.date),fmt=n=>String(n).padStart(2,'0'),ds=`${d.getFullYear()}${fmt(d.getMonth()+1)}${fmt(d.getDate())}`,hs=(r.heure||'18:30').replace(':',''),he=String(parseInt(hs.slice(0,2))+2).padStart(2,'0')+hs.slice(2);window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(r.title)}&dates=${ds}T${hs}00/${ds}T${he}00&location=${encodeURIComponent(r.lieu||'')}`),'_blank'}
window.exportGcal=exportGcal;
function exportIcal(r){if(!r.date)return;const d=new Date(r.date),fmt=n=>String(n).padStart(2,'0'),ds=`${d.getFullYear()}${fmt(d.getMonth()+1)}${fmt(d.getDate())}`,hs=(r.heure||'18:30').replace(':',''),he=String(parseInt(hs.slice(0,2))+2).padStart(2,'0')+hs.slice(2);const ic=['BEGIN:VCALENDAR','VERSION:2.0',`PRODID:-//${CFG.logPrefix} Lestiac//FR`,'BEGIN:VEVENT',`UID:${CFG.code}-${Date.now()}@lestiac`,`SUMMARY:${r.title}`,`DTSTART:${ds}T${hs}00`,`DTEND:${ds}T${he}00`,`LOCATION:${r.lieu||'Mairie'}`,`DESCRIPTION:Commission ${CFG.label}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([ic],{type:'text/calendar'}));a.download=r.title.replace(/\s+/g,'_')+'.ics';a.click()}
window.exportIcal=exportIcal;
function exportAllIcal(){const arr=getReunions().filter(r=>r.date&&r.date.trim());if(!arr.length){alert('Aucune réunion avec date.');return}const fmt=n=>String(n).padStart(2,'0');let lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//'+CFG.logPrefix+' Lestiac//FR'];arr.forEach((r,i)=>{const d=new Date(r.date),ds=`${d.getFullYear()}${fmt(d.getMonth()+1)}${fmt(d.getDate())}`,hs=(r.heure||'18:30').replace(':',''),he=String(parseInt(hs.slice(0,2))+2).padStart(2,'0')+hs.slice(2);lines.push('BEGIN:VEVENT',`UID:${CFG.code}-${i}-${Date.now()}@lestiac`,`SUMMARY:${r.title}`,`DTSTART:${ds}T${hs}00`,`DTEND:${ds}T${he}00`,`LOCATION:${r.lieu||'Mairie'}`,`DESCRIPTION:Commission ${CFG.label}`,'END:VEVENT')});lines.push('END:VCALENDAR');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([lines.join('\r\n')],{type:'text/calendar'}));a.download='Reunions-'+CFG.slug+'.ics';a.click()}
window.exportAllIcal=exportAllIcal;

// ── COMPTES RENDUS ──
// ── Pièce jointe CR ──
const MAX_CR_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8 Mo
let _crPendingAttachment = null;

function handleCRAttachmentChange(input){
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  if (file.size > MAX_CR_ATTACHMENT_BYTES) {
    alert(`Fichier trop volumineux (${Math.round(file.size/1024/1024*10)/10} Mo). Limite actuelle : ${MAX_CR_ATTACHMENT_BYTES/1024/1024} Mo.\n\nPour un fichier plus lourd, indiquez plutôt un lien vers le dossier Drive de la commission dans le corps du CR.`);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    _crPendingAttachment = { name: file.name, mime: file.type || 'application/octet-stream', size: file.size, dataUrl: reader.result };
    renderCRPendingAttachment();
  };
  reader.onerror = () => alert('Impossible de lire ce fichier.');
  reader.readAsDataURL(file);
}
window.handleCRAttachmentChange = handleCRAttachmentChange;

function renderCRPendingAttachment(){
  const bar = document.getElementById('cr-pending-att');
  if (!bar) return;
  if (!_crPendingAttachment) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  const sizeKb = Math.round(_crPendingAttachment.size / 1024);
  bar.style.display = 'flex';
  bar.innerHTML = `<span class="dm-pending-ico">📎</span><span class="dm-pending-name">${escapeHtml(_crPendingAttachment.name)}</span><span class="dm-pending-size">${sizeKb} Ko</span><button type="button" class="dm-pending-remove" onclick="clearCRPendingAttachment()" title="Retirer">✕</button>`;
}

function clearCRPendingAttachment(){
  _crPendingAttachment = null;
  renderCRPendingAttachment();
}
window.clearCRPendingAttachment = clearCRPendingAttachment;

function publishCR(){
  const title=document.getElementById('cr-title').value.trim(),body=document.getElementById('cr-body').value.trim(),date=document.getElementById('cr-date').value;
  if(!title||!body){alert('Titre et contenu requis.');return}
  const who=getCurrentUser()||'Admin';const time=new Date().toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const cr={id:'cr'+Date.now(),title,body,date,who,time,ts:Date.now()};
  if(_crPendingAttachment) cr.file = {..._crPendingAttachment};
  writeCR(cr);logAction('CR publié','«'+title+'»');sendCRByEmail(cr);closeModal('m-cr');
  ['cr-title','cr-body','cr-date'].forEach(id=>document.getElementById(id).value='');
  clearCRPendingAttachment();
  if(!fbConnected)renderCRs();
}
window.publishCR=publishCR;
function sendCRByEmail(cr){
  const ejs=getEjsConfig();if(!ejs||!ejs.pubkey||!ejs.service||!ejs.template){alert('⚠️ EmailJS non configuré. CR publié mais non envoyé.');return}
  emailjs.init(ejs.pubkey);
  const emails=(ejs.emails||'').split(',').map(e=>e.trim()).filter(Boolean);if(!emails.length){alert('⚠️ Aucune adresse configurée.');return}
  // Note : la pièce jointe n'est pas transmise dans l'e-mail (EmailJS n'accepte pas de fichier
  // en pièce jointe via send()) — elle reste disponible dans AGORA, on le signale dans le message.
  const messageWithAtt = cr.body + (cr.file ? `\n\n📎 Pièce jointe disponible dans AGORA : ${cr.file.name}` : '');
  Promise.all(emails.map(to=>emailjs.send(ejs.service,ejs.template,{to_email:to,subject:cr.title,message:messageWithAtt,from_name:'Commission '+CFG.label+' — Lestiac',date:cr.date||''}))).then(()=>{alert('✅ CR envoyé à '+emails.length+' membre(s).');logAction('CR envoyé','«'+cr.title+'»')}).catch(e=>{alert('❌ Erreur envoi : '+e.text)})
}
function renderCRs(){
  const list=document.getElementById('cr-list'),empty=document.getElementById('cr-empty');
  if(!list||!empty)return;
  const crs=getCRs();list.innerHTML='';empty.style.display=crs.length===0?'':'none';
  crs.forEach((cr,idx)=>{
  const me=getCurrentUser();
  const canDel=isAdmin||isSuperAdmin()||(cr.who&&cr.who===me);
  const card=document.createElement('div');card.className='cr-card';
  const attHtml = cr.file ? `<div style="margin-top:10px">${renderAttachmentHtml(cr.file)}</div>` : '';
  card.innerHTML=`<div class="cr-card-head"><div><div class="cr-title">${escapeHtml(cr.title||"")}</div><div class="cr-meta">Publié par ${escapeHtml(cr.who||"?")} · ${cr.time}${cr.date?' · Réunion du '+new Date(cr.date).toLocaleDateString('fr-FR'):''}</div></div><div style="display:flex;align-items:center;gap:8px"><span class="cr-sent">✓ Publié</span>${canDel?`<button class="btn btn-ghost-red btn-sm" onclick="deleteCR('${cr.id||idx}')">🗑</button>`:''}</div></div><div class="cr-body">${escapeHtml(cr.body||"")}</div>${attHtml}`;
  list.appendChild(card);
});updateStats();
}

// ── TÂCHES (page globale) ──
function renderTasks(){
  const tasks=getTasks();
  ['court','moyen','long'].forEach(h=>{
    const cont=document.getElementById('tasks-'+h);if(!cont)return;cont.innerHTML='';
    (tasks[h]||[]).forEach((t,i)=>{
      const div=document.createElement('div');div.className='task-item'+(t.done?' done':'');div.onclick=()=>toggleTask(h,i);
      const tagIco=CFG.taskTags.icons[(t.tag||CFG.taskTags.default).replace('-','_')]||CFG.taskTags.icons[CFG.taskTags.default.replace('-','_')];
      div.innerHTML=`<input type="checkbox" ${t.done?'checked':''} onclick="event.stopPropagation();toggleTask('${h}',${i})"><span class="task-label">${escapeHtml(t.text||"")}</span><span class="task-tag ${t.tag||'tt-hab'}">${tagIco}</span><button class="btn-icon" onclick="event.stopPropagation();editTask('${h}',${i})" title="Modifier" style="font-size:13px;color:rgba(0,0,0,.25)" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='rgba(0,0,0,.25)'">✏️</button><button class="btn-icon" onclick="event.stopPropagation();deleteTask('${h}',${i})" title="Supprimer" style="font-size:13px;color:rgba(0,0,0,.25)" onmouseover="this.style.color='var(--terra)'" onmouseout="this.style.color='rgba(0,0,0,.25)'">🗑</button>`;
      cont.appendChild(div);
    });
    if((isAdmin||isSuperAdmin())&&(tasks[h]||[]).some(t=>t.done)){
      const doneCount=(tasks[h]||[]).filter(t=>t.done).length;
      const btnWrap=document.createElement('div');
      btnWrap.style.cssText='text-align:right;margin-top:8px;padding-top:6px;border-top:1px dashed var(--mid)';
      btnWrap.innerHTML=`<button class="btn btn-ghost-red btn-sm" style="font-size:11px" onclick="deleteCheckedTasks('${h}')">🗑 Supprimer les ${doneCount} tâche${doneCount>1?'s':''} cochée${doneCount>1?'s':''}</button>`;
      cont.appendChild(btnWrap);
    }
  });updateStats();
}
function toggleTask(h,i){const t=getTasks();if(!t[h]||!t[h][i])return;t[h][i].done=!t[h][i].done;writeTasks(t);logAction(t[h][i].done?'Tâche cochée':'Tâche décochée','«'+t[h][i].text.substring(0,50)+'»');if(!fbConnected)renderTasks()}
window.toggleTask=toggleTask;
function editTask(h,i){const t=getTasks();if(!t[h]||!t[h][i])return;const v=prompt('Modifier la tâche :',t[h][i].text||'');if(v===null)return;const nv=v.trim();if(!nv)return;t[h][i].text=nv;writeTasks(t);logAction('Tâche modifiée','«'+nv.substring(0,50)+'»');if(!fbConnected)renderTasks()}
window.editTask=editTask;
function deleteTask(h,i){if(!confirm('Supprimer cette tâche ?'))return;const t=getTasks();t[h].splice(i,1);writeTasks(t);logAction('Tâche supprimée','');if(!fbConnected)renderTasks()}
window.deleteTask=deleteTask;
function deleteCheckedTasks(h){
  const t=getTasks();
  const count=(t[h]||[]).filter(x=>x.done).length;
  if(!count)return;
  if(!confirm(`Supprimer les ${count} tâche${count>1?'s':''} cochée${count>1?'s':''} ?`))return;
  t[h]=(t[h]||[]).filter(x=>!x.done);
  writeTasks(t);
  logAction('Tâches cochées supprimées',h+' ('+count+')');
  if(!fbConnected)renderTasks();
}
window.deleteCheckedTasks=deleteCheckedTasks;
function addTask(h){const inp=document.getElementById('new-task-'+h),tag=document.getElementById('new-task-'+h+'-tag').value,text=inp.value.trim();if(!text)return;const t=getTasks();t[h].push({id:'at'+Date.now(),text,tag,done:false});writeTasks(t);logAction('Tâche ajoutée','«'+text+'»');inp.value='';if(!fbConnected)renderTasks()}
window.addTask=addTask;

// ── FINANCES ──
function renderFinances(){
  if(!document.getElementById('fin-total'))return;
  const b=getBudget();
  if(!b){document.getElementById('fin-total').textContent='Budget : à renseigner';document.getElementById('fin-consomme').textContent='0 € consommé';document.getElementById('fin-bar').style.width='0%';return}
  const pct=b.total>0?Math.min(100,Math.round(b.consomme/b.total*100)):0;
  document.getElementById('fin-total').textContent='Budget : '+b.total+' €';
  document.getElementById('fin-consomme').textContent=b.consomme+' € consommé ('+pct+'%)';
  document.getElementById('fin-bar').style.width=pct+'%';
  if(b.annee)document.getElementById('fin-annee').textContent='Exercice '+b.annee;
  const cont=document.getElementById('fin-lignes');cont.innerHTML='';
  if(b.comment){const card=document.createElement('div');card.className='fin-card';card.style.borderColor='var(--navy)';card.innerHTML=`<div class="fin-title" style="font-size:14px">Dernière mise à jour</div><div class="fin-meta">${escapeHtml(b.comment||"")}</div>`;cont.appendChild(card)}
}
function saveBudget(){
  const b={total:parseFloat(document.getElementById('fin-total-input').value)||0,consomme:parseFloat(document.getElementById('fin-consomme-input').value)||0,annee:new Date().getFullYear(),comment:document.getElementById('fin-comment').value.trim(),ts:Date.now()};
  writeBudget(b);logAction('Budget',b.total+'€ total');renderFinances();
  if(fbDb)fbSet('finances/'+COMMISSION,b);
}
window.saveBudget=saveBudget;

// ── JOURNAL ──
function renderLog(){const list=document.getElementById('log-list');if(!list)return;const logs=getLog();if(!logs||!logs.length){list.innerHTML='<div class="empty-state"><div class="ei">📋</div><p>Aucune modification.</p></div>';return}list.innerHTML='';logs.forEach(l=>{const d=document.createElement('div');d.className='log-item';d.innerHTML=`<strong>${escapeHtml(l.who||'?')}</strong> — ${escapeHtml(l.action||'')} : ${escapeHtml(l.detail||'')} <span class="log-time">${escapeHtml(l.time||'')} </span>`;list.appendChild(d)})}
function clearLog(){if(!confirm('Vider ?'))return;if(fbDb)fbRemove(COMMISSION+'/log');else{const d=getLocal();d.log=[];saveLocal(d);localData.log=[]}renderLog()}
window.clearLog=clearLog;

// ── ADMIN PARAMS ──
function saveFbConfig(){const cfg={apiKey:document.getElementById('fb-apiKey').value.trim(),authDomain:'mairie-lestiac-2026.firebaseapp.com',databaseURL:document.getElementById('fb-databaseURL').value.trim(),projectId:document.getElementById('fb-projectId').value.trim()};if(!cfg.apiKey||!cfg.databaseURL){alert('apiKey et databaseURL requis.');return}localStorage.setItem(K_FB,JSON.stringify(cfg));initFirebase(cfg)}
window.saveFbConfig=saveFbConfig;
function saveEmailJS(){
  const cfg={pubkey:document.getElementById('ejs-pubkey').value.trim(),service:document.getElementById('ejs-service').value.trim(),template:document.getElementById('ejs-template').value.trim(),emails:document.getElementById('ejs-emails').value.trim()};
  const statusEl=document.getElementById('ejs-status');
  applyEmailJSConfig(cfg); // cache local immédiat (pré-remplissage + envoi possible tout de suite)
  if(fbDb){
    // Écrire dans Firebase — partagé entre tous les membres ET persistant après chaque push/deploy
    fbSet(COMMISSION+'/config/emailjs',cfg)
      .then(()=>{
        if(statusEl){statusEl.textContent='\u2705 Configuration EmailJS enregistrée dans Firebase (persistante).';setTimeout(()=>statusEl.textContent='',4000);}
        logAction('Config EmailJS enregistrée','partagée Firebase');
      })
      .catch(e=>{
        if(statusEl)statusEl.textContent='\u274c Échec d\'écriture Firebase : '+(e&&e.message?e.message:'permission ?');
        alert('\u274c La configuration EmailJS n\'a PAS pu être enregistrée durablement dans Firebase.\n\nMessage : '+(e&&e.message?e.message:'permission refusée ?')+'\n\nVérifiez que les règles Firebase autorisent l\'écriture sur la branche « config ». Tant que ce n\'est pas réglé, la configuration sera perdue au prochain rechargement.');
      });
  } else {
    // Firebase pas connecté : la config ne vivra QUE dans ce navigateur et sera perdue au push
    localStorage.setItem(K_EJS,JSON.stringify(cfg));
    if(statusEl)statusEl.textContent='\u26a0 Enregistré localement uniquement (Firebase non connecté) — sera perdu au prochain déploiement.';
    alert('\u26a0\ufe0f Firebase n\'est pas connecté pour le moment.\n\nLa configuration a été gardée seulement dans CE navigateur — elle sera perdue au prochain push/déploiement, et les autres membres ne la verront pas.\n\nRechargez la page (pour rétablir la connexion Firebase), puis ré-enregistrez la configuration.');
  }
}
window.saveEmailJS=saveEmailJS;

// Appliquer la config EmailJS reçue (Firebase ou localStorage)
function applyEmailJSConfig(cfg){
  if(!cfg)return;
  // Mémoriser en localStorage comme cache local
  localStorage.setItem(K_EJS,JSON.stringify(cfg));
  // Pré-remplir les champs dans la page Paramètres si ouverte
  ['pubkey','service','template'].forEach(k=>{const el=document.getElementById('ejs-'+k);if(el&&cfg[k])el.value=cfg[k]});
  if(cfg.emails){const el=document.getElementById('ejs-emails');if(el)el.value=cfg.emails;}
}
window.applyEmailJSConfig=applyEmailJSConfig;
function changePwd(){const p1=document.getElementById('new-pwd').value,p2=document.getElementById('new-pwd2').value;if(!p1||p1!==p2){alert('Mots de passe incorrects.');return}localStorage.setItem(K_PWD,p1);alert('Mot de passe mis à jour.');document.getElementById('new-pwd').value='';document.getElementById('new-pwd2').value=''}
window.changePwd=changePwd;
async function exportJSON(){
  // Inclut désormais l'intégralité de l'historique de messagerie (DM + groupes, partagés
  // entre les 3 commissions) — mémorisation garantie et exportable, indépendamment de Firebase.
  let dmData = null, groupsData = null;
  if (fbDb) {
    try {
      const [dmSnap, groupsSnap] = await Promise.all([get(ref(fbDb, 'dm')), get(ref(fbDb, 'groups'))]);
      dmData = dmSnap.val();
      groupsData = groupsSnap.val();
    } catch (e) {
      console.error(LOGP+'Backup — lecture de la messagerie échouée :', e);
    }
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    exportedBy: getCurrentUser() || 'inconnu',
    projects: getProjects(),
    tasks: getTasks(),
    reunions: getReunions(),
    comptesRendus: getCRs(),
    messagerie: { dm: dmData, groupes: groupsData }
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Sauvegarde-'+CFG.slug+'.json';a.click();
}
window.exportJSON=exportJSON;
function makeEditable(el){if(!isAdmin)return;el.contentEditable='true';el.style.background='#fffde7';el.focus();el.onblur=()=>{el.contentEditable='false';el.style.background=''}}
window.makeEditable=makeEditable;

// ── QUICK TASKS (tâches du quotidien) ──
function getQuickTasks(){
  if(localData.quickTasks)return localData.quickTasks;
  return getLocal().quickTasks||[];
}
function writeQuickTasks(arr){
  const obj={};arr.forEach((t,i)=>{obj[t.id||('qt'+i)]=t});
  if(fbDb)fbSet(COMMISSION+'/quickTasks',obj);
  else{const d=getLocal();d.quickTasks=arr;saveLocal(d)}
}
function saveQuickTask(){
  const title=document.getElementById('qt-title').value.trim();if(!title)return;
  const qt={id:'qt'+Date.now(),title,assignee:document.getElementById('qt-assignee').value,deadline:document.getElementById('qt-deadline').value,note:document.getElementById('qt-note').value.trim(),status:'todo',createdBy:getCurrentUser()||'Anonyme',ts:Date.now()};
  const arr=getQuickTasks();arr.unshift(qt);writeQuickTasks(arr);
  logAction('Tâche quotidien','«'+title+'»'+(qt.assignee?' → '+qt.assignee:''));
  if(qt.assignee)notifyQTAssignee(qt);
  closeModal('m-quick-task');
  ['qt-title','qt-deadline','qt-note'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('qt-assignee').value='';
  renderQuickTasks();
}
window.saveQuickTask=saveQuickTask;

function renderQuickTasks(){
  const cont=document.getElementById('quick-tasks-list');if(!cont)return;
  const tasks=getQuickTasks();
  if(!tasks.length){cont.innerHTML='<div class="empty-state" style="padding:16px"><div class="ei" style="font-size:24px">📋</div><p>Aucune tâche du quotidien.</p></div>';return}
  const me=getCurrentUser();
  cont.innerHTML='';
  tasks.forEach((t,i)=>{
    const canDel=isAdmin||isSuperAdmin()||(t.createdBy&&t.createdBy===me)||(t.assignee&&t.assignee===me);
    const now=new Date();now.setHours(0,0,0,0);
    let dlHtml='';
    if(t.deadline){
      const dl=new Date(t.deadline);dl.setHours(0,0,0,0);
      const diff=Math.ceil((dl-now)/(1000*60*60*24));
      const lbl=dl.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
      if(diff<0)dlHtml=`<span class="qt-deadline dl-overdue">🔴 ${lbl}</span>`;
      else if(diff<=3)dlHtml=`<span class="qt-deadline dl-soon">⏰ ${lbl}</span>`;
      else dlHtml=`<span class="qt-deadline dl-ok">📅 ${lbl}</span>`;
    }
    const row=document.createElement('div');
    row.className='quick-task-row'+(t.status==='done'?' done-qt':'');
    row.style.cursor='pointer';
    row.onclick=(e)=>{if(!e.target.closest('button'))openQTDetail(i);};
    row.innerHTML=`<div style="flex:1">
      <div class="qt-title">${t.title}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
        ${t.assignee?`<span class="qt-assignee">👤 ${t.assignee}</span>`:''}
        ${dlHtml}
        ${t.note?`<span style="font-size:11px;color:var(--soft);font-style:italic">${t.note}</span>`:''}
      </div>
    </div>
    <div style="display:flex;gap:4px;align-items:center">
      ${t.status!=='done'?`<button class="btn btn-accent btn-sm" style="font-size:11px" onclick="doneQuickTask(${i})">✓</button>`:'<span style="font-size:11px;color:#2e7d32;font-weight:700">✓</span>'}
      ${canDel?`<button class="btn-icon" onclick="deleteQuickTask(${i})" style="font-size:13px">🗑</button>`:''}
    </div>`;
    cont.appendChild(row);
  });
}
function doneQuickTask(i){const arr=getQuickTasks();arr[i].status='done';writeQuickTasks(arr);logAction('Tâche quotidien ✓',arr[i].title);renderQuickTasks()}
function deleteQuickTask(i){
  const arr=getQuickTasks();const t=arr[i];
  const me=getCurrentUser();
  if(!isAdmin&&!isSuperAdmin()&&t.createdBy!==me&&t.assignee!==me){alert('Vous ne pouvez pas supprimer cette tâche.');return}
  if(!confirm('Supprimer ?'))return;
  arr.splice(i,1);writeQuickTasks(arr);renderQuickTasks();
}
window.doneQuickTask=doneQuickTask;window.deleteQuickTask=deleteQuickTask;

function updateDashShortcuts(){
  const p=getProjects(),t=getTasks(),r=getReunions(),c=getCRs();
  const el=id=>document.getElementById(id);
  if(el('ds-projets'))el('ds-projets').textContent=p.filter(x=>!x.archived).length;
  const taskCount=[...(t.court||[]),...(t.moyen||[]),...(t.long||[])].filter(x=>!x.done).length;
  if(el('ds-taches'))el('ds-taches').textContent=taskCount||'0';
  if(el('ds-reunions'))el('ds-reunions').textContent=r.length;
  if(el('ds-cr'))el('ds-cr').textContent=c.length;
}


// ── NOTIFICATIONS COMMENTAIRE ──
function notifyCommentToMembers(proj, comment) {
  const ejs = getEjsConfig();
  if (!ejs || !ejs.pubkey || !ejs.service || !ejs.template) return; // EmailJS pas configuré, silencieux
  emailjs.init(ejs.pubkey);
  const members = getMembersArr(proj);
  const me = getCurrentUser();
  const recipients = members.filter(name => name !== me && MEMBER_EMAILS[name]);
  if (!recipients.length) return;
  const subject = `💬 Nouveau commentaire — ${proj.title}`;
  const message = `${comment.who} a posté un commentaire sur le projet « ${proj.title} » :\n\n"${comment.text}"\n\nDate : ${comment.time}\n\n— Commission ${CFG.label} · Lestiac`;
  recipients.forEach(name => {
    const to = MEMBER_EMAILS[name];
    emailjs.send(ejs.service, ejs.template, {
      to_email: to,
      subject,
      message,
      from_name: 'AGORA · '+CFG.label,
      date: new Date().toLocaleDateString('fr-FR')
    }).catch(() => {});
  });
}

// ── NOTIFICATIONS RÉUNION ──
function notifyMeetingToParticipants(r) {
  const ejs = getEjsConfig();
  if (!ejs || !ejs.pubkey || !ejs.service || !ejs.template) {
    // EmailJS non configuré — on prévient discrètement
    console.warn('EmailJS non configuré : notification réunion non envoyée.');
    return;
  }
  emailjs.init(ejs.pubkey);
  const partNames = (r.participants || '').split(',').map(s => s.trim()).filter(Boolean);
  // Si un projet est lié, ajouter ses membres
  let allNames = [...partNames];
  if (r.linkedProjId) {
    const proj = getProjects().find(p => p.id === r.linkedProjId);
    if (proj) {
      const projMembers = getMembersArr(proj);
      projMembers.forEach(m => { if (!allNames.includes(m)) allNames.push(m); });
    }
  }
  const me = getCurrentUser();
  const recipients = allNames.filter(name => MEMBER_EMAILS[name] && name !== me);
  if (!recipients.length) {
    console.info('Aucun destinataire identifié pour la notification réunion.');
    return;
  }
  const dateStr = r.date
    ? new Date(r.date).toLocaleDateString('fr-FR', {weekday:'long',day:'numeric',month:'long',year:'numeric'})
    : 'Date à fixer';
  const subject = `📅 Réunion planifiée — ${CFG.label}`;
  const message = `Bonjour,\n\nUne réunion a été planifiée pour la Commission ${CFG.label} :\n\n📅 Date : ${dateStr}${r.heure?' à '+r.heure:''}\n📍 Lieu : ${r.lieu||'Mairie de Lestiac'}\n👥 Participants : ${r.participants||'—'}\n${r.notes?'\n📋 Ordre du jour :\n'+r.notes+'\n':''}\nVous pouvez ajouter cette réunion à votre agenda depuis AGORA.\n\n— AGORA · Commission ${CFG.label} · Mairie de Lestiac`;
  const sends = recipients.map(name =>
    emailjs.send(ejs.service, ejs.template, {
      to_email: MEMBER_EMAILS[name],
      subject,
      message,
      from_name: 'AGORA · '+CFG.label,
      date: dateStr
    })
  );
  Promise.allSettled(sends).then(results => {
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const fail = results.filter(r => r.status === 'rejected').length;
    const msg = `✅ Notification envoyée à ${ok} participant${ok>1?'s':''}.${fail?' ⚠ '+fail+' échec(s).':''}`;
    // Afficher un toast non bloquant
    showToast(msg, fail ? 'warn' : 'ok');
    logAction('Notification réunion', ok+' envoi(s) · '+r.title);
  });
}

function showToast(msg, type='ok') {
  let t = document.getElementById('agora-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'agora-toast';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.2);transition:opacity .3s;white-space:nowrap;max-width:90vw;text-align:center';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background = type==='ok' ? '#1A5C6B' : '#D4880A';
  t.style.color = 'white';
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.style.opacity='0', 3500);
}
window.showToast = showToast;

// ── SOLLICITER SOPHIE ──
function notifySophie(projTitle, commissionLabel) {
  const ejs = getEjsConfig();
  if (!ejs || !ejs.pubkey || !ejs.service || !ejs.template) {
    showToast('⚠ EmailJS non configuré — notification non envoyée', 'warn');
    return;
  }
  emailjs.init(ejs.pubkey);
  const sophieEmail = MEMBER_EMAILS['Sophie'];
  if (!sophieEmail) return;
  const me = getCurrentUser() || 'Un membre';
  const comm = commissionLabel || CFG.label;
  emailjs.send(ejs.service, ejs.template, {
    to_email: sophieEmail,
    subject: `📣 [${comm}] Projet à communiquer — ${projTitle}`,
    message: `Bonjour Sophie,

${me} te sollicite pour préparer une communication sur le projet :

« ${projTitle} »
Commission : ${comm}

Merci de te rapprocher de l'équipe.

— AGORA · Mairie de Lestiac`,
    from_name: 'AGORA · ' + comm,
    date: new Date().toLocaleDateString('fr-FR')
  }).then(() => showToast('✅ Sophie notifiée par mail'))
     .catch(() => showToast('⚠ Envoi à Sophie échoué — vérifiez EmailJS', 'warn'));
}

function _elodiePayload(p){
  const comm=(typeof COMMISSIONS==='object'&&COMMISSIONS[COMMISSION_COURANTE])||'Commission';
  const statut=({'s-lancer':'À lancer','s-cours':'En cours','s-attente':'En attente','s-fait':'Réalisé'})[p.status]||p.status||'—';
  const chefsArr=(typeof getChefsArr==='function')?getChefsArr(p):[];
  const membersArr=(typeof getMembersArr==='function')?getMembersArr(p):[];
  const axe=(typeof AXE_LABELS==='object'&&AXE_LABELS[p.axe])?AXE_LABELS[p.axe].replace(/^\S+\s/,''):(p.axe||'—');
  const notes=(typeof p.notes==='object'&&p.notes)?(p.notes.text||''):(p.notes||'');
  return {comm,statut,chefs:chefsArr.length?chefsArr.join(', '):'—',members:membersArr.length?membersArr.join(', '):'—',axe,notes};
}
function _sendToElodie(subject,message,comm){
  const ejs=getEjsConfig();
  if(!ejs||!ejs.pubkey||!ejs.service||!ejs.template){
    alert('\u26a0\ufe0f EmailJS n\'est pas configur\u00e9.\n\nLe mail \u00e0 \u00c9lodie ne peut pas partir tant que les identifiants EmailJS ne sont pas renseign\u00e9s.\n\n\u2192 Allez dans \u2699\ufe0f Param\u00e8tres \u203a section \u00ab EmailJS \u00bb et remplissez la cl\u00e9 publique, le service et le template.');
    showToast('\u26a0 EmailJS non configur\u00e9 — voir Param\u00e8tres','warn');
    return false;
  }
  if(typeof emailjs==='undefined'){
    alert('\u26a0\ufe0f La librairie EmailJS n\'a pas pu se charger (probl\u00e8me de connexion internet ou bloqueur de publicit\u00e9s ?). R\u00e9essayez apr\u00e8s avoir recharg\u00e9 la page.');
    showToast('\u26a0 Librairie EmailJS indisponible','warn');
    return false;
  }
  try{
    emailjs.init(ejs.pubkey);
    emailjs.send(ejs.service,ejs.template,{to_email:ELODIE_EMAIL,subject,message,from_name:'AGORA · '+comm,date:new Date().toLocaleDateString('fr-FR')})
      .then(()=>showToast('\u2705 Mail envoy\u00e9 \u00e0 \u00c9lodie (secr\u00e9tariat mairie)'))
      .catch(err=>{
        const detail=(err&&(err.text||err.message))?(err.text||err.message):'cause inconnue';
        console.error('[\u00c9lodie] EmailJS send error:',err);
        alert('\u274c L\'envoi du mail \u00e0 \u00c9lodie a \u00e9chou\u00e9.\n\nMessage d\'EmailJS : '+detail+'\n\nV\u00e9rifiez dans \u2699\ufe0f Param\u00e8tres que la cl\u00e9 publique, le service et le template sont corrects, et que le template contient bien les variables {{to_email}}, {{subject}} et {{message}}.');
        showToast('\u274c Envoi \u00e0 \u00c9lodie \u00e9chou\u00e9 : '+detail,'warn');
      });
    return true;
  }catch(e){
    console.error('[\u00c9lodie] EmailJS init error:',e);
    showToast('\u26a0 Envoi \u00e0 \u00c9lodie \u00e9chou\u00e9 : '+(e&&e.message?e.message:'erreur'),'warn');
    return false;
  }
}
function notifyElodie(projId){
  const arr=getProjects(),p=arr.find(x=>x.id===projId);if(!p){alert('Projet introuvable.');return}
  if(!confirm('Informer Élodie (secrétariat de mairie) que le projet « '+p.title+' » est activé ?'))return;
  const pl=_elodiePayload(p),me=getCurrentUser()||'Un membre';
  const subject=`🏛 [${pl.comm}] Projet activé — ${p.title}`;
  const message=`Bonjour Élodie,

Le projet suivant vient d'être activé par la commission ${pl.comm} :

« ${p.title} »
Sous-commission : ${pl.axe}
Statut : ${pl.statut}
Porteur(s) : ${pl.chefs}
Budget : ${p.budget||'—'}${p.subs&&p.subs!=='—'?'\nFinancement : '+p.subs:''}

${p.desc?'Objet : '+p.desc+'\n\n':''}Merci d'en prendre note. Le résultat finalisé te sera transmis pour application le moment venu.

Informé par : ${me}
— AGORA · Mairie de Lestiac`;
  if(_sendToElodie(subject,message,pl.comm)){p.elodieInfoTs=Date.now();p.elodieInfoBy=me;writeProjects(arr);logAction('Élodie informée','«'+p.title+'»');if(!fbConnected)localData.projects=arr;renderElodieStatus(p)}
}
window.notifyElodie=notifyElodie;
function sendResultToElodie(projId){
  const arr=getProjects(),p=arr.find(x=>x.id===projId);if(!p){alert('Projet introuvable.');return}
  if(!confirm('Transmettre le résultat finalisé du projet « '+p.title+' » à Élodie pour application (devis validé, décisions…) ?'))return;
  const pl=_elodiePayload(p),me=getCurrentUser()||'Un membre';
  const ptasks=p.project_tasks?Object.values(p.project_tasks):[];
  const tasksDone=ptasks.filter(t=>t&&t.status==='done').map(t=>'  ✓ '+t.title).join('\n');
  const subject=`📤 [${pl.comm}] Résultat à appliquer — ${p.title}`;
  const message=`Bonjour Élodie,

Voici le résultat finalisé du projet, à appliquer (devis validé, décisions à mettre en œuvre, etc.) :

« ${p.title} »
Commission : ${pl.comm}
Sous-commission : ${pl.axe}
Statut : ${pl.statut}
Budget : ${p.budget||'—'}${p.subs&&p.subs!=='—'?'\nFinancement / devis : '+p.subs:''}
Porteur(s) : ${pl.chefs}
Participants : ${pl.members}
${tasksDone?'\nTâches réalisées :\n'+tasksDone+'\n':''}${pl.notes?'\nNotes / décisions :\n'+pl.notes+'\n':''}
Documents : ${(typeof _driveUrl!=='undefined'&&_driveUrl)?_driveUrl:'(Drive non configuré)'}

Merci d'assurer la mise en œuvre. Pour toute question, rapproche-toi de ${pl.chefs.split(',')[0]||me}.

Transmis par : ${me}
— AGORA · Mairie de Lestiac`;
  if(_sendToElodie(subject,message,pl.comm)){p.elodieResultTs=Date.now();p.elodieResultBy=me;writeProjects(arr);logAction('Résultat transmis à Élodie','«'+p.title+'»');if(!fbConnected)localData.projects=arr;renderElodieStatus(p)}
}
window.sendResultToElodie=sendResultToElodie;
function renderElodieStatus(p){
  const el=document.getElementById('elodie-status');if(!el)return;
  const fmt=ts=>new Date(ts).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'2-digit'});
  const parts=[];
  if(p&&p.elodieInfoTs)parts.push('📧 Informée le '+fmt(p.elodieInfoTs)+(p.elodieInfoBy?' · '+p.elodieInfoBy:''));
  if(p&&p.elodieResultTs)parts.push('📤 Résultat transmis le '+fmt(p.elodieResultTs)+(p.elodieResultBy?' · '+p.elodieResultBy:''));
  el.innerHTML=parts.length?parts.join('  ·  '):'Aucune notification envoyée à Élodie pour ce projet.';
}
window.renderElodieStatus=renderElodieStatus;
function notifyElodieTask(i){
  const arr=getQuickTasks();const t=(i!=null&&i>=0)?arr[i]:null;if(!t){alert('Tâche introuvable.');return}
  if(!confirm('Informer Élodie (secrétariat de mairie) au sujet de la tâche « '+t.title+' » ?'))return;
  const comm=(typeof COMMISSIONS==='object'&&COMMISSIONS[COMMISSION_COURANTE])||'Commission';
  const me=getCurrentUser()||'Un membre';
  const dl=t.deadline?new Date(t.deadline+'T00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'}):'—';
  const subject=`🏛 [${comm}] Tâche à suivre — ${t.title}`;
  const message=`Bonjour Élodie,

La commission ${comm} t'informe de la tâche suivante :

« ${t.title} »
Responsable : ${t.assignee||'—'}
Échéance : ${dl}${t.note?'\nNote : '+t.note:''}

Merci d'en prendre note.

Informé par : ${me}
— AGORA · Mairie de Lestiac`;
  if(_sendToElodie(subject,message,comm)){t.elodieInfoTs=Date.now();t.elodieInfoBy=me;writeQuickTasks(arr);logAction('Élodie informée (tâche)','«'+t.title+'»');renderQuickTasks()}
}
window.notifyElodieTask=notifyElodieTask;

// ── GOOGLE DRIVE ──
// Drive URL stockée dans Firebase — partagée entre tous les membres
let _driveUrl = CFG.driveUrl; // URL Drive partagée — hardcodée
const DEVIS_DRIVE_URL = 'https://drive.google.com/drive/folders/1u18BxPe794fHrCas1EGVNTad-QVApake?usp=share_link'; // sous-dossier "Factures" dédié aux PJ devis — partagé entre les 3 commissions
localStorage.setItem(CFG.keys.drive, _driveUrl);
function applyDriveUrl(url) {
  _driveUrl = url || '';
  // Mettre à jour tous les liens Drive dans la page
  ['drive-folder-link', 'qtd-drive-link', 'bord-drive-link'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.href = _driveUrl || '#';
  });
  // Stocker aussi en localStorage comme cache de session
  if (_driveUrl) localStorage.setItem('lestiac_drive_' + COMMISSION, _driveUrl);
}
function getDriveUrl() { return _driveUrl; }
function openDriveFolder(e) {
  if (_driveUrl) {
    // URL connue — ouvrir directement (ne pas bloquer le lien)
    return;
  }
  e.preventDefault();
  if (isAdmin || isSuperAdmin()) {
    document.getElementById('drive-folder-config').style.display = '';
    document.getElementById('drive-url-input').value = '';
  } else {
    showToast('⚠ Aucun dossier Drive configuré. Demandez à un administrateur.', 'warn');
  }
}
function saveDriveUrl() {
  const url = document.getElementById('drive-url-input').value.trim();
  if (!url) return;
  // Écrire dans Firebase sous commission/config/driveUrl
  fbSet(COMMISSION+'/config/driveUrl', url);
  applyDriveUrl(url);
  document.getElementById('drive-folder-config').style.display = 'none';
  window.open(url, '_blank');
  logAction('Drive configuré', url);
}
function copyDriveLink() {
  const url = getDriveUrl();
  if (!url) { alert('Aucun lien Drive configuré. Cliquez sur « Ouvrir le dossier Drive » pour en définir un.'); return; }
  navigator.clipboard?.writeText(url).then(() => alert('✅ Lien copié !')).catch(() => {
    prompt('Copier ce lien :', url);
  });
}
window.openDriveFolder = openDriveFolder;
window.saveDriveUrl = saveDriveUrl;
window.copyDriveLink = copyDriveLink;
window.notifySophie = notifySophie;


// ── RENOMMAGE PROJET (super-admin) ──
function startRenameProj(){
  const p=getProjects().find(x=>x.id===_currentProjId);if(!p)return;
  const bar=document.getElementById('rename-proj-bar');
  const inp=document.getElementById('rename-proj-input');
  inp.value=p.title;
  bar.style.display='flex';
  inp.focus();inp.select();
}
function confirmRenameProj(){
  const newTitle=document.getElementById('rename-proj-input').value.trim();
  if(!newTitle){alert('Le titre ne peut pas être vide.');return}
  const arr=getProjects(),p=arr.find(x=>x.id===_currentProjId);if(!p)return;
  const old=p.title;
  p.title=newTitle;
  writeProjects(arr);
  logAction('Projet renommé','«'+old+'» → «'+newTitle+'»');
  document.getElementById('proj-detail-title').textContent=newTitle;
  document.getElementById('rename-proj-bar').style.display='none';
  // Mettre à jour la carte dans la grille
  const card=document.querySelector(`.proj-card[data-id="${_currentProjId}"] .proj-title`);
  if(card)card.textContent=newTitle;
  if(!fbConnected)renderProjects();
  showToast('✅ Projet renommé');
}
function cancelRenameProj(){
  document.getElementById('rename-proj-bar').style.display='none';
}
window.startRenameProj=startRenameProj;
window.confirmRenameProj=confirmRenameProj;
window.cancelRenameProj=cancelRenameProj;


// Peupler le select projets dans le formulaire réunion
function populateReunionProjSelect(){
  const sel=document.getElementById('r-projet');if(!sel)return;
  const projs=getProjects();
  sel.innerHTML='<option value="">— Aucun projet spécifique —</option>';
  projs.forEach(p=>{ const opt=document.createElement('option');opt.value=p.id;opt.textContent=p.title;sel.appendChild(opt); });
}


// ── CHEFS DE PROJET ──
function getChefsArr(p){
  if(p.chefs&&Array.isArray(p.chefs)&&p.chefs.length) return p.chefs;
  if(p.pilote) return [p.pilote]; // compatibilité ancienne donnée
  return [];
}

// Render chips dans le formulaire ajout projet
function renderChefChips(containerId, selected){
  const cont=document.getElementById(containerId);if(!cont)return;
  cont.innerHTML='';
  ALL_MEMBERS.forEach(name=>{
    const isSel=selected.includes(name);
    const chip=document.createElement('span');
    chip.className='chef-chip'+(isSel?' selected':'');
    chip.textContent=name;
    chip.onclick=()=>{
      const cur=_newProjChefs||[];
      if(cur.includes(name)){
        _newProjChefs=cur.filter(x=>x!==name);
      } else {
        if(cur.length>=2){showToast('⚠ Maximum 2 en charge du projet','warn');return;}
        _newProjChefs=[...cur,name];
      }
      renderChefChips(containerId,_newProjChefs);
    };
    cont.appendChild(chip);
  });
}

// Affichage dans la modale détail
function renderDetailChefs(p){
  const display=document.getElementById('proj-chef-display');
  if(!display)return;
  const chefs=getChefsArr(p);
  const canEdit=isAdmin||isSuperAdmin();
  display.innerHTML='';
  if(chefs.length){
    const label=document.createElement('span');
    label.style.cssText='font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--softer);margin-right:2px';
    label.textContent='🎯 En charge'+(chefs.length>1?'s':'')+' :';
    display.appendChild(label);
    chefs.forEach(c=>{
      const badge=document.createElement('span');
      badge.className='chef-badge';badge.textContent=escapeHtml(c);
      display.appendChild(badge);
    });
  } else {
    const empty=document.createElement('span');
    empty.style.cssText='font-size:12px;color:var(--softer);font-style:italic';
    empty.textContent='Aucun en charge du projet défini';
    display.appendChild(empty);
  }
  if(canEdit){
    const editBtn=document.createElement('button');
    editBtn.className='btn btn-ghost btn-sm';
    editBtn.style.cssText='font-size:11px;margin-left:4px';
    editBtn.textContent='✏️ Modifier';
    editBtn.onclick=()=>openEditChefs(p);
    display.appendChild(editBtn);
  }
}

function openEditChefs(p){
  _editingChefs=[...getChefsArr(p)];
  const cont=document.getElementById('proj-chef-edit-chips');
  if(!cont)return;
  cont.innerHTML='';
  ALL_MEMBERS.forEach(name=>{
    const isSel=_editingChefs.includes(name);
    const chip=document.createElement('span');
    chip.className='chef-chip'+(isSel?' selected':'');
    chip.textContent=name;
    chip.onclick=()=>{
      if(_editingChefs.includes(name)){
        _editingChefs=_editingChefs.filter(x=>x!==name);
      } else {
        if(_editingChefs.length>=2){showToast('⚠ Maximum 2 en charge du projet','warn');return;}
        _editingChefs.push(name);
      }
      // Refresh chips
      cont.querySelectorAll('.chef-chip').forEach((ch,i)=>{
        ch.className='chef-chip'+(_editingChefs.includes(ALL_MEMBERS[i])?' selected':'');
      });
    };
    cont.appendChild(chip);
  });
  document.getElementById('proj-chef-edit').style.display='';
}

function saveChefs(){
  if(!_currentProjId)return;
  const arr=getProjects(),p=arr.find(x=>x.id===_currentProjId);if(!p)return;
  const chefs=[..._editingChefs];
  p.chefs=chefs;
  if(chefs.length)p.pilote=chefs[0]; // maintenir compatibilité
  writeProjects(arr);
  logAction('En charge du projet','«'+p.title+'» → '+chefs.join(', '));
  document.getElementById('proj-chef-edit').style.display='none';
  renderDetailChefs(p);
  renderProjects();
  if(!fbConnected)localData.projects=arr;
  showToast('✅ En charge'+(chefs.length>1?'s':'')+' du projet mis à jour');
}

function cancelEditChefs(){
  document.getElementById('proj-chef-edit').style.display='none';
}

window.renderChefChips=renderChefChips;
window.openEditChefs=openEditChefs;
window.saveChefs=saveChefs;

/* ════════════════════════════════════════════════════════════════
   SOUS-COMMISSIONS — badge de rattachement + panneau Babouchka
   édition entièrement in-place (Phase 1bis) : plus de modale séparée,
   tout se fait dans le panneau lui-même (infos, devis, décisions).
   ════════════════════════════════════════════════════════════════ */
function renderSubAttach(p){
  const store=getSubcoms();
  const subs=getProjSubcomIds(p).map(id=>store[id]).filter(Boolean)
    .filter(s=>!s._draft||isAdmin||isSuperAdmin()); // amorces non confirmées invisibles aux non-admins
  if(!subs.length) return '';
  return `<div class="sub-attach">`+subs.map(s=>{
    const foreign=Array.isArray(s.commissions)&&!s.commissions.includes(COMMISSION_COURANTE);
    const cross=(Array.isArray(s.commissions)&&s.commissions.length>1)||foreign;
    const other=(s.commissions||[]).filter(c=>c!==COMMISSION_COURANTE).map(c=>COMMISSIONS[c]).filter(Boolean);
    const icon=`<svg class="sb-icon" width="16" height="16" viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="9" height="9" rx="2"/><rect x="5.5" y="5.5" width="9" height="9" rx="2"/></svg>`;
    let badge=`<button class="sub-badge${cross?' transversal':''}${s._draft?' draft':''}" id="sb-${p.id}-${s.id}" onclick="event.stopPropagation();toggleBabouchka('${p.id}','${s.id}')">${icon}<span class="sb-label-wrap"><span class="sb-kicker">${s._draft?'🌱 Amorce · ':''}Porté par${cross?' · transversale':''}</span><span class="sb-name">${escapeHtml(s.nom)}</span></span><span class="sb-chev">›</span></button>`;
    if(cross&&other.length) badge+=`<span class="sub-cross">🔗 aussi <b>${other.map(escapeHtml).join(' · ')}</b></span>`;
    return badge;
  }).join('')+`</div>`;
}

const _babState={}; // panelId -> {subId, level}   panelId = projId (carte projet) ou 'settings-<subId>' (Paramètres)
const _babLevelLabel={root:"Vue d'ensemble",devis:'Devis',dec:'Décisions'};
const _babEditing={};   // subId -> bool : édition des infos (nom/commissions/membres) en cours
const _babEditWork={};  // subId -> {commissions:[],membres:[]} copie de travail pendant l'édition
const _babAddDevis={};  // subId -> bool : formulaire d'ajout de devis ouvert
const _babAddDec={};    // subId -> bool : formulaire d'ajout de décision ouvert
const _babDevisFile={}; // subId -> {name,data} fichier devis sélectionné, en attente d'ajout
const _canEditSub=()=>isAdmin||isSuperAdmin();

function toggleBabouchka(panelId,subId){
  const mount=document.getElementById('bab-'+panelId);if(!mount)return;
  const card=mount.closest('.proj-card'); // null hors carte projet (ex: liste Paramètres) — géré ci-dessous
  if(_babState[panelId]&&_babState[panelId].subId===subId){closeBabouchka(panelId);return;}
  _babState[panelId]={subId,level:'root'};
  if(card)card.classList.add('open-bab');
  renderBab(panelId);
}
window.toggleBabouchka=toggleBabouchka;
function closeBabouchka(panelId){
  const mount=document.getElementById('bab-'+panelId);
  if(mount){mount.innerHTML='';const c=mount.closest('.proj-card');if(c)c.classList.remove('open-bab');}
  delete _babState[panelId];
}
window.closeBabouchka=closeBabouchka;
function babGo(panelId,level){if(_babState[panelId]){_babState[panelId].level=level;renderBab(panelId);}}
window.babGo=babGo;
function babBack(panelId){const st=_babState[panelId];if(!st)return;if(st.level==='root')closeBabouchka(panelId);else babGo(panelId,'root');}
window.babBack=babBack;

function renderBab(panelId){
  const st=_babState[panelId];if(!st)return;
  const s=getSubcoms()[st.subId];const mount=document.getElementById('bab-'+panelId);
  if(!s||!mount){return;}
  const badge=document.getElementById('sb-'+panelId+'-'+st.subId);if(badge)badge.classList.add('is-open');
  let crumb=`<button class="bab-crumb-item ${st.level==='root'?'current':'link'}" ${st.level!=='root'?`onclick="babGo('${panelId}','root')"`:''}>Vue d'ensemble</button>`;
  if(st.level!=='root')crumb+=`<span class="bab-crumb-sep">›</span><span class="bab-crumb-item current">${_babLevelLabel[st.level]}</span>`;
  mount.innerHTML=`<div class="babouchka">
    <div class="bab-head">
      <button class="bab-back" onclick="babBack('${panelId}')">← ${st.level==='root'?'Fermer':'Retour'}</button>
      <div class="bab-crumb">${crumb}</div>
      <button class="bab-close" title="Fermer" onclick="closeBabouchka('${panelId}')">✕</button>
    </div>
    <div class="bab-body">${_babRoot(panelId,s)}${_babDevis(s)}${_babDec(s)}</div>
  </div>`;
  mount.querySelectorAll('.bab-level').forEach(l=>l.classList.toggle('active',l.dataset.level===st.level));
  if(st.level==='root'&&_babEditing[st.subId])_babRenderEditChips(st.subId);
}

function _babRoot(panelId,s){
  const enAtt=s.devis.filter(d=>d.statut==='demande').length;
  const draftBanner=s._draft?`<div class="bab-draft-banner"><span>🌱 Amorce non confirmée — invisible aux non-admins.</span><button class="btn btn-accent btn-sm" onclick="confirmSubcomDraft('${s.id}')">✓ Confirmer</button></div>`:'';
  if(_babEditing[s.id]){
    if(!_babEditWork[s.id])_babEditWork[s.id]={commissions:[...s.commissions],membres:[...s.membres]};
    return `<div class="bab-level" data-level="root">
      ${draftBanner}
      <div class="form-group">
        <label class="form-label">Nom de la sous-commission</label>
        <input class="form-control" id="bab-name-${s.id}" value="${escapeHtml(s.nom)}">
        <div class="sc-helper">✏️ Nom librement modifiable à tout moment.</div>
      </div>
      <div class="form-group">
        <label class="form-label">Commissions rattachées <span style="text-transform:none;font-weight:600;color:var(--softer)">(plusieurs = transversale)</span></label>
        <div class="member-chips-proj" id="bab-commissions-${s.id}" style="gap:6px"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Membres <span style="text-transform:none;font-weight:600;color:var(--softer)">(élus AGORA uniquement)</span></label>
        <div class="member-chips-proj" id="bab-members-${s.id}" style="gap:5px"></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
        <button class="btn btn-ghost-red btn-sm" style="margin-right:auto" onclick="babDeleteSubcom('${s.id}')">🗑 Supprimer</button>
        <button class="btn btn-ghost btn-sm" onclick="babCancelEdit('${s.id}')">Annuler</button>
        <button class="btn btn-accent btn-sm" onclick="babSaveInfos('${s.id}')">Enregistrer</button>
      </div>
    </div>`;
  }
  return `<div class="bab-level" data-level="root">
    ${draftBanner}
    <div class="bab-sub-title">${escapeHtml(s.nom)}${_canEditSub()?`<button class="bab-edit-pencil" title="Modifier" onclick="babStartEdit('${s.id}')">✏️</button>`:''}</div>
    <div class="bab-sub-rattach">${s.commissions.length>1?'<span class="bab-pill">🔗 Transversale</span>':''}Rattachée à ${s.commissions.map(c=>COMMISSIONS[c]).filter(Boolean).map(escapeHtml).join(' · ')||'—'}</div>
    <div class="bab-block-label">Membres · ${s.membres.length}</div>
    ${s.membres.length?`<div class="bab-members">${s.membres.map(m=>`<span class="bab-mem"><span class="bab-av">${_scInit(m)}</span>${escapeHtml(m)}</span>`).join('')}</div>`:`<div class="bab-empty">Aucun membre défini.</div>`}
    <div class="bab-summary">
      <button class="bab-tile" onclick="babGo('${panelId}','devis')"><span class="bab-tile-ic">🧾</span><span><span class="bab-tile-num">${s.devis.length}</span><span class="bab-tile-lab">Devis</span>${enAtt?`<span class="bab-tile-sub">${enAtt} en attente</span>`:''}</span><span class="bab-tile-go">→</span></button>
      <button class="bab-tile" onclick="babGo('${panelId}','dec')"><span class="bab-tile-ic">⚖️</span><span><span class="bab-tile-num">${s.decisions.length}</span><span class="bab-tile-lab">Décisions</span></span><span class="bab-tile-go">→</span></button>
    </div>
  </div>`;
}

function _babRenderEditChips(subId){
  const work=_babEditWork[subId];if(!work)return;
  const cEl=document.getElementById('bab-commissions-'+subId);
  if(cEl){
    cEl.innerHTML='';
    Object.entries(COMMISSIONS).forEach(([id,nom])=>{
      const on=work.commissions.includes(id);
      const chip=document.createElement('span');
      chip.className='multi-chip'+(on?' on':'');chip.textContent=(on?'✓ ':'')+nom;
      chip.onclick=()=>{work.commissions=on?work.commissions.filter(x=>x!==id):[...work.commissions,id];_babRenderEditChips(subId);};
      cEl.appendChild(chip);
    });
  }
  const mEl=document.getElementById('bab-members-'+subId);
  if(mEl){
    mEl.innerHTML='';
    ALL_MEMBERS.forEach(name=>{
      const on=work.membres.includes(name);
      const chip=document.createElement('span');
      chip.className='chef-chip'+(on?' selected':'');chip.textContent=name;
      chip.onclick=()=>{work.membres=on?work.membres.filter(x=>x!==name):[...work.membres,name];_babRenderEditChips(subId);};
      mEl.appendChild(chip);
    });
  }
}

function babStartEdit(subId){
  if(!_canEditSub()){showToast('Réservé aux adjoints (mode admin)','warn');return;}
  const s=getSubcoms()[subId];if(!s)return;
  _babEditing[subId]=true;
  _babEditWork[subId]={commissions:[...s.commissions],membres:[...s.membres]};
  _refreshOpenBabs();
}
window.babStartEdit=babStartEdit;
function babCancelEdit(subId){
  delete _babEditing[subId];delete _babEditWork[subId];
  _refreshOpenBabs();
}
window.babCancelEdit=babCancelEdit;
function babSaveInfos(subId){
  const s=getSubcoms()[subId];if(!s)return;
  const nameEl=document.getElementById('bab-name-'+subId);
  const nom=nameEl?nameEl.value.trim():s.nom;
  if(!nom){showToast('Nom requis','warn');return;}
  const work=_babEditWork[subId]||{commissions:s.commissions,membres:s.membres};
  const updated={...s,nom,commissions:work.commissions.length?[...work.commissions]:[COMMISSION_COURANTE],membres:[...work.membres]};
  fbSet(SUBCOM_NODE+'/'+subId,updated);
  logAction('Sous-commission enregistrée',nom);
  delete _babEditing[subId];delete _babEditWork[subId];
  showToast('Enregistré ✓','ok');
  renderProjects();_refreshOpenBabs();
}
window.babSaveInfos=babSaveInfos;
function babDeleteSubcom(subId){
  if(!_canEditSub()){showToast('Réservé aux adjoints (mode admin)','warn');return;}
  const s=getSubcoms()[subId];if(!s)return;
  const cross=Array.isArray(s.commissions)&&s.commissions.length>1;
  const warn=cross?`\n\n⚠ Sous-commission TRANSVERSALE — rattachée à ${s.commissions.map(c=>COMMISSIONS[c]).filter(Boolean).join(' · ')}. Sa suppression la retire de TOUTES ces commissions.`:'';
  if(!confirm(`Supprimer « ${s.nom} » ?${warn}\n\nElle sera déplacée dans la corbeille, récupérable pendant ${TRASH_RETENTION_DAYS} jours.`))return;
  fbSet(TRASH_NODE+'/'+subId,{...s,_deletedAt:Date.now(),_deletedBy:getCurrentUser()||'?'});
  fbRemove(SUBCOM_NODE+'/'+subId);
  logAction('Sous-commission supprimée → corbeille',s.nom);
  showToast('Déplacée dans la corbeille','warn');
  delete _babEditing[subId];delete _babEditWork[subId];
  Object.keys(_babState).forEach(pid=>{if(_babState[pid]&&_babState[pid].subId===subId)closeBabouchka(pid);});
  renderProjects();
}
window.babDeleteSubcom=babDeleteSubcom;

function _babDevis(s){
  const total=s.devis.reduce((a,d)=>a+(parseFloat(d.montant)||0),0);
  const rows=s.devis.length?s.devis.map((d,i)=>{
    const st=DEVIS_STATUS[d.statut]||DEVIS_STATUS.demande;
    return `<div class="devis-row"><div class="devis-main"><div class="devis-four">${escapeHtml(d.four)}</div><div class="devis-date">${_scDate(d.date)}</div></div><span class="devis-amt">${_scEur(d.montant)}</span><span class="devis-status ${st.cls}">${st.label}</span>${d.fichier?`<a class="devis-file" href="${escapeHtml(d.fichier)}" target="_blank" rel="noopener">📎 ${escapeHtml(d.fichierNom||'Pièce')}</a>`:`<span class="devis-file none">— aucune</span>`}${_canEditSub()?`<button class="mini-del" title="Retirer" onclick="babDelDevis('${s.id}',${i})">🗑</button>`:''}</div>`;
  }).join('')+`<div class="devis-total"><span>Total devis</span><b>${_scEur(total)}</b></div>`:`<div class="bab-empty">Aucun devis enregistré.</div>`;
  let addZone='';
  if(_canEditSub()){
    if(_babAddDevis[s.id]){
      const fd=_babDevisFile[s.id];
      addZone=`<div class="bab-inline-form">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Fournisseur</label><input class="form-control" id="bab-dv-four-${s.id}" placeholder="Ex : SARL Toiture Garonne"></div>
          <div class="form-group"><label class="form-label">Montant (€)</label><input class="form-control" id="bab-dv-amt-${s.id}" type="number" placeholder="0"></div>
        </div>
        <div class="form-group"><label class="form-label">Statut</label>
          <select class="form-control" id="bab-dv-status-${s.id}"><option value="demande">Demandé</option><option value="recu">Reçu</option><option value="valide">Validé</option><option value="refuse">Refusé</option></select>
        </div>
        <div class="form-group">
          <label class="form-label">Pièce jointe</label>
          <input class="form-control" id="bab-dv-file-${s.id}" type="url" placeholder="Lien du devis (Google Drive, PDF en ligne…)">
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
            <label class="btn btn-ghost btn-sm" style="font-size:11px;cursor:pointer">📎 Choisir un fichier<input type="file" id="bab-dv-fileinput-${s.id}" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" style="display:none" onchange="babPickDevisFile(this,'${s.id}')"></label>
            ${DEVIS_DRIVE_URL?`<a class="btn btn-ghost btn-sm" style="font-size:11px" href="${escapeHtml(DEVIS_DRIVE_URL)}" target="_blank" rel="noopener">📂 Dossier Factures</a>`:''}
            <span style="font-size:11px;color:var(--soft)">${fd?'📎 '+escapeHtml(fd.name)+' prêt':''}</span>
          </div>
          <div style="font-size:10.5px;color:var(--softer);margin-top:5px;line-height:1.4">Collez un lien, ou choisissez un petit fichier (≤ 1 Mo, intégré directement). Pour un fichier volumineux : ouvrez le dossier Factures, déposez-y le fichier, puis collez son lien ici.</div>
        </div>
        <div style="display:flex;gap:8px"><button class="btn btn-ghost btn-sm" onclick="babToggleAddDevis('${s.id}',false)">Annuler</button><button class="btn btn-accent btn-sm" onclick="babAddDevis('${s.id}')">+ Ajouter le devis</button></div>
      </div>`;
    }else{
      addZone=`<button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="babToggleAddDevis('${s.id}',true)">+ Ajouter un devis</button>`;
    }
  }
  return `<div class="bab-level" data-level="devis">${rows}${addZone}</div>`;
}
function babToggleAddDevis(subId,open){_babAddDevis[subId]=open;if(!open)delete _babDevisFile[subId];_refreshOpenBabs();}
window.babToggleAddDevis=babToggleAddDevis;
function babPickDevisFile(input,subId){
  const f=input.files&&input.files[0];
  if(!f){delete _babDevisFile[subId];return}
  if(f.size>1024*1024){showToast('Fichier trop lourd (> 1 Mo) — collez plutôt un lien','warn');input.value='';delete _babDevisFile[subId];return}
  const r=new FileReader();
  r.onload=()=>{_babDevisFile[subId]={name:f.name,data:r.result};_refreshOpenBabs();};
  r.onerror=()=>{showToast('Lecture du fichier impossible','warn');delete _babDevisFile[subId]};
  r.readAsDataURL(f);
}
window.babPickDevisFile=babPickDevisFile;
function babAddDevis(subId){
  const fourEl=document.getElementById('bab-dv-four-'+subId);
  const four=fourEl?fourEl.value.trim():'';
  if(!four){showToast('Fournisseur requis','warn');return;}
  const amt=document.getElementById('bab-dv-amt-'+subId).value||0;
  const statut=document.getElementById('bab-dv-status-'+subId).value;
  const link=(document.getElementById('bab-dv-file-'+subId).value||'').trim();
  const fd=_babDevisFile[subId];
  const fichier=(fd&&fd.data)||link||null;
  const fichierNom=(fd&&fd.name)||(link?'Lien externe':null);
  const s=getSubcoms()[subId];if(!s)return;
  const devis=[...s.devis,{four,montant:amt,statut,date:new Date().toISOString().slice(0,10),fichier,fichierNom}];
  fbSet(SUBCOM_NODE+'/'+subId,{...s,devis});
  logAction('Devis ajouté','«'+four+'» → '+s.nom);
  delete _babDevisFile[subId];_babAddDevis[subId]=false;
  showToast('Devis ajouté ✓','ok');
  _refreshOpenBabs();
}
window.babAddDevis=babAddDevis;
function babDelDevis(subId,i){
  const s=getSubcoms()[subId];if(!s)return;
  const devis=[...s.devis];devis.splice(i,1);
  fbSet(SUBCOM_NODE+'/'+subId,{...s,devis});
  logAction('Devis retiré',s.nom);
  _refreshOpenBabs();
}
window.babDelDevis=babDelDevis;

function _babDec(s){
  const rows=s.decisions.length?s.decisions.map((d,i)=>`<div class="dec-row"><div class="dec-date">${_scDate(d.date)}</div><div class="dec-text">${escapeHtml(d.texte)}</div><div class="dec-foot"><span class="dec-by">👤 ${escapeHtml(d.par||'—')}</span>${d.cr?`<a class="dec-cr" href="${escapeHtml(d.cr)}" target="_blank" rel="noopener">📄 Compte-rendu</a>`:''}${_canEditSub()?`<button class="mini-del" title="Retirer" onclick="babDelDec('${s.id}',${i})">🗑</button>`:''}</div></div>`).join(''):`<div class="bab-empty">Aucune décision enregistrée.</div>`;
  let addZone='';
  if(_canEditSub()){
    if(_babAddDec[s.id]){
      addZone=`<div class="bab-inline-form">
        <div class="form-group"><label class="form-label">Texte de la décision</label><textarea class="form-control" id="bab-dc-text-${s.id}" placeholder="Ce qui a été décidé…"></textarea></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Date</label><input class="form-control" id="bab-dc-date-${s.id}" type="date"></div>
          <div class="form-group"><label class="form-label">Décidé par</label><input class="form-control" id="bab-dc-by-${s.id}" placeholder="Ex : Bureau du 12/03"></div>
        </div>
        <div class="form-group"><label class="form-label">Lien compte-rendu <span style="text-transform:none;font-weight:600;color:var(--softer)">(optionnel)</span></label><input class="form-control" id="bab-dc-cr-${s.id}" placeholder="https://…"></div>
        <div style="display:flex;gap:8px"><button class="btn btn-ghost btn-sm" onclick="babToggleAddDec('${s.id}',false)">Annuler</button><button class="btn btn-accent btn-sm" onclick="babAddDec('${s.id}')">+ Ajouter la décision</button></div>
      </div>`;
    }else{
      addZone=`<button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="babToggleAddDec('${s.id}',true)">+ Ajouter une décision</button>`;
    }
  }
  return `<div class="bab-level" data-level="dec">${rows}${addZone}</div>`;
}
function babToggleAddDec(subId,open){
  _babAddDec[subId]=open;
  _refreshOpenBabs();
  if(open){const dd=document.getElementById('bab-dc-date-'+subId);if(dd)dd.valueAsDate=new Date();}
}
window.babToggleAddDec=babToggleAddDec;
function babAddDec(subId){
  const textEl=document.getElementById('bab-dc-text-'+subId);
  const texte=textEl?textEl.value.trim():'';
  if(!texte){showToast('Texte requis','warn');return;}
  const date=document.getElementById('bab-dc-date-'+subId).value||new Date().toISOString().slice(0,10);
  const par=document.getElementById('bab-dc-by-'+subId).value.trim()||(getCurrentUser()||'—');
  const cr=document.getElementById('bab-dc-cr-'+subId).value.trim()||null;
  const s=getSubcoms()[subId];if(!s)return;
  const decisions=[{texte,date,par,cr},...s.decisions];
  fbSet(SUBCOM_NODE+'/'+subId,{...s,decisions});
  logAction('Décision ajoutée',s.nom);
  _babAddDec[subId]=false;
  showToast('Décision ajoutée ✓','ok');
  _refreshOpenBabs();
}
window.babAddDec=babAddDec;
function babDelDec(subId,i){
  const s=getSubcoms()[subId];if(!s)return;
  const decisions=[...s.decisions];decisions.splice(i,1);
  fbSet(SUBCOM_NODE+'/'+subId,{...s,decisions});
  logAction('Décision retirée',s.nom);
  _refreshOpenBabs();
}
window.babDelDec=babDelDec;
function _refreshOpenBabs(){Object.keys(_babState).forEach(pid=>{if(document.getElementById('bab-'+pid))renderBab(pid);});}


/* ── Phase 1 : confirmation d'amorce, restauration depuis la corbeille ── */
function confirmSubcomDraft(subId){
  if(!isSuperAdmin()&&!isAdmin){showToast('Réservé aux adjoints (mode admin)','warn');return;}
  const s=getSubcoms()[subId];if(!s)return;
  const updated={...s};delete updated._draft;
  fbSet(SUBCOM_NODE+'/'+subId,updated);
  logAction('Sous-commission confirmée',s.nom);
  showToast('Sous-commission confirmée ✓','ok');
  renderProjects();_refreshOpenBabs();
}
window.confirmSubcomDraft=confirmSubcomDraft;

function restoreSubcom(subId){
  if(!isSuperAdmin()&&!isAdmin){showToast('Réservé aux adjoints (mode admin)','warn');return;}
  const t=_trashData&&_trashData[subId];if(!t)return;
  const restored=_normSub(subId,t);delete restored._deletedAt;delete restored._deletedBy;
  fbSet(SUBCOM_NODE+'/'+subId,restored);
  fbRemove(TRASH_NODE+'/'+subId);
  logAction('Sous-commission restaurée',restored.nom||subId);
  showToast('Sous-commission restaurée ✓','ok');
}
window.restoreSubcom=restoreSubcom;

/* ── Vue d'ensemble admin (page Paramètres) — scopée à la commission courante,
   même si les nœuds Firebase (subcommissions / corbeille) sont partagés entre les 3 fichiers.
   "👁 Détails" rouvre la MÊME Babouchka que sur les cartes projet (panelId synthétique
   'settings-<id>') — un seul mécanisme d'édition dans toute l'appli. ── */
function renderSubcomAdmin(){
  const listEl=document.getElementById('subcom-admin-list');
  if(!listEl)return; // page admin pas montée dans ce fichier
  const store=getSubcoms();
  const ids=Object.keys(store).filter(id=>store[id]&&Array.isArray(store[id].commissions)&&store[id].commissions.includes(COMMISSION_COURANTE));
  listEl.innerHTML=ids.length?ids.map(id=>{
    const s=store[id];const draft=!!s._draft;
    const cross=Array.isArray(s.commissions)&&s.commissions.length>1;
    return `<div class="bab-settings-row">
      <div class="mini-list-row">
        <span style="flex:1">
          <b>${escapeHtml(s.nom)}</b>
          ${draft?'<span class="bab-pill" style="background:#fff3cd;color:#7a5800;margin-left:6px">🌱 Amorce</span>':''}
          ${cross?'<span class="bab-pill" style="margin-left:6px">🔗 Transversale</span>':''}
          <span style="display:block;font-size:11px;color:var(--softer);margin-top:2px">${(s.commissions||[]).map(c=>COMMISSIONS[c]).filter(Boolean).join(' · ')||'—'} · ${(s.membres||[]).length} membre(s)</span>
        </span>
        ${draft?`<button class="btn btn-accent btn-sm" onclick="confirmSubcomDraft('${id}')">✓ Confirmer</button>`:''}
        <button class="btn btn-ghost btn-sm" onclick="toggleBabouchka('settings-${id}','${id}')">👁 Détails</button>
      </div>
      <div id="bab-settings-${id}"></div>
    </div>`;
  }).join(''):'<div class="bab-empty">Aucune sous-commission pour cette commission.</div>';
  _refreshOpenBabs(); // réaffiche immédiatement toute Babouchka 'settings-…' restée ouverte avant ce re-render

  const trashEl=document.getElementById('subcom-trash-list');
  if(!trashEl)return;
  const trash=_trashData||{};
  const now=Date.now();
  const tids=Object.keys(trash).filter(id=>trash[id]&&Array.isArray(trash[id].commissions)&&trash[id].commissions.includes(COMMISSION_COURANTE));
  trashEl.innerHTML=tids.length?tids.map(id=>{
    const t=trash[id];
    const joursRestants=Math.max(0,TRASH_RETENTION_DAYS-Math.floor((now-(t._deletedAt||now))/86400000));
    return `<div class="mini-list-row">
      <span style="flex:1">
        <b>${escapeHtml(t.nom||id)}</b>
        <span style="display:block;font-size:11px;color:var(--softer);margin-top:2px">Supprimée par ${escapeHtml(t._deletedBy||'?')} · ${joursRestants} jour(s) avant purge automatique</span>
      </span>
      <button class="btn btn-accent btn-sm" onclick="restoreSubcom('${id}')">♻ Restaurer</button>
    </div>`;
  }).join(''):'<div class="bab-empty">Corbeille vide.</div>';
}
window.renderSubcomAdmin=renderSubcomAdmin;
window.cancelEditChefs=cancelEditChefs;
window.getChefsArr=getChefsArr;


// ══════════════════════════════════════════════════════
// UTILITAIRES CHAT
// ══════════════════════════════════════════════════════
// (L'ancien "chat par projet" et l'ancienne barre de présence ont été retirés le 22/07/2026 :
//  c'était du code mort, jamais relié à l'interface (aucun élément #chat-input-proj,
//  #chat-messages-proj ni #chat-presence-bar n'existe dans le HTML). La messagerie réelle,
//  ci-dessous, est la Messagerie/Discussions — DM + groupes.)
function escapeHtml(t) {
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>');
}

// ══════════════════════════════════════════════════════════════
// MESSAGERIE — DM + Discussions de groupe + pièces jointes
// ══════════════════════════════════════════════════════════════
// Corrections apportées le 22/07/2026 (audit des 3 commissions) :
//  1) BUG : initPresenceDM() était rappelée en entier à CHAQUE clic sur l'onglet
//     "💬 Chat" (via initDMPage → nav()), et empilait à chaque fois un nouveau
//     setInterval(25s) + deux nouveaux listeners Firebase onValue(), sans jamais
//     libérer les précédents. Après quelques allers-retours sur l'onglet Chat, la
//     présence était écrite en double/triple/etc., les notifications ("ding")
//     se déclenchaient plusieurs fois pour un seul message, et l'app se
//     ralentissait progressivement — symptôme d'un chat qui "ne répond plus".
//     → Corrigé avec un garde-fou (_dmPresenceStarted) : l'initialisation ne
//        s'exécute plus qu'une seule fois par session.
//  2) BUG (même famille) : trackUnread() était relancée à chaque écriture sur la
//     branche Firebase de la commission (donc toutes les ~25s à cause du battement
//     de présence), et re-empilait elle aussi un onValue() par membre sans jamais
//     se désabonner. → Corrigé avec le garde-fou _unreadTrackingStarted.
//  3) BUG (fragilité) : plusieurs fonctions (openDMWith, sendDM…) appelaient
//     ref(fbDb, …) sans vérifier que Firebase avait fini de se connecter. Un clic
//     un peu rapide au chargement de la page provoquait une exception silencieuse
//     (visible seulement dans la console) et l'impression que "rien ne se passe".
//     → Corrigé avec un contrôle explicite de fbDb avant toute opération.
//  4) Les chemins Firebase codés en dur ('cdv/…', 'scolaire/…', 'admin/…') sont
//     remplacés par la constante COMMISSION déjà définie en haut du fichier, pour
//     éviter tout risque de désynchronisation future entre les 3 sites.
//  5) NOUVEAU : discussions de groupe (créer un groupe, y ajouter des membres,
//     fil de discussion partagé) — nœuds Firebase groups/{id} et groupIndex/.
//  6) NOUVEAU : envoi de documents/images en pièce jointe dans le DM et les
//     groupes (limite : 4 Mo par fichier, stocké en base64 dans Firebase RTDB —
//     au-delà, mieux vaut partager un lien vers le dossier Drive de la commission).

let _dmWith = null;              // interlocuteur DM actif (mode 1-à-1)
let _activeGroupId = null;       // groupe actif (mode groupe) — exclusif avec _dmWith
let _dmUnsub = null;             // listener Firebase de la conversation actuellement ouverte
let _onlineMembers = new Set();  // membres en ligne (présence partagée inter-commissions)
let _dmPresenceStarted = false;      // garde-fou correctif n°1
let _unreadTrackingStarted = false;  // garde-fou correctif n°2
let _myGroups = {};              // {groupId: {name, members:[...], createdBy, createdAt}}
let _groupMsgUnsubs = {};        // groupId -> fonction de désabonnement (suivi des non-lus)
let _groupUnread = {};           // groupId -> nombre de messages non lus
let _pendingAttachment = null;   // {name, mime, size, dataUrl} en attente d'envoi
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024; // 4 Mo — limite raisonnable pour du base64 en RTDB

// ── Clé de conversation DM (triée pour être symétrique) ──
function dmKey(a, b) {
  return [encodeURIComponent(a), encodeURIComponent(b)].sort().join('__');
}

// ── Présence (partagée entre les 3 commissions) — ne s'initialise qu'une fois ──
function initPresenceDM() {
  if (_dmPresenceStarted) return; // correctif n°1 : voir note d'audit ci-dessus
  const me = getCurrentUser();
  if (!me || !fbDb) return;
  _dmPresenceStarted = true;

  const presRef = ref(fbDb, `${COMMISSION}/presence/${encodeURIComponent(me)}`);
  const sharedRef = ref(fbDb, `presence/${encodeURIComponent(me)}`);
  const update = () => {
    set(presRef, { name: me, ts: Date.now(), commission: COMMISSION });
    set(sharedRef, { name: me, ts: Date.now(), commission: COMMISSION });
  };
  update();
  setInterval(update, 25000);
  window.addEventListener('beforeunload', () => {
    remove(presRef);
    remove(sharedRef);
  });

  // Présence partagée inter-commissions
  onValue(ref(fbDb, 'presence'), snap => {
    const now = Date.now();
    _onlineMembers = new Set(
      Object.values(snap.val() || {})
        .filter(p => now - (p.ts || 0) < 75000)
        .map(p => p.name)
    );
    refreshActivePresenceUI();
  });
  // Présence locale commission (complément)
  onValue(ref(fbDb, `${COMMISSION}/presence`), snap => {
    const now = Date.now();
    Object.values(snap.val() || {})
      .filter(p => now - (p.ts || 0) < 75000)
      .forEach(p => _onlineMembers.add(p.name));
    refreshActivePresenceUI();
  });

  initGroupsIndex();
  trackUnread();
}

function refreshActivePresenceUI() {
  const chatPage = document.getElementById('page-chat');
  if (chatPage && chatPage.classList.contains('active')) renderDMContacts();
  if (_dmWith) {
    const statusEl = document.getElementById('dm-conv-status');
    if (statusEl) statusEl.textContent = _onlineMembers.has(_dmWith) ? '🟢 En ligne' : '⚫ Hors ligne';
  }
}

// ── Sidebar : groupes + contacts (1-à-1) ──
function renderDMContacts() {
  const me = getCurrentUser();
  const cont = document.getElementById('dm-contacts');
  if (!cont) return;
  if (!me) {
    cont.innerHTML = `<div style="padding:24px 18px;text-align:center;color:var(--softer);font-size:12.5px;line-height:1.6">
      👋 Bienvenue !<br>Cliquez sur <strong>« M'identifier »</strong> en haut de l'écran pour accéder à vos messages.
    </div>`;
    return;
  }
  cont.innerHTML = '';

  // -- Moi (confirmation visuelle que ma présence est bien diffusée) --
  const meOnline = _onlineMembers.has(me);
  const meInitials = me.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  const meDiv = document.createElement('div');
  meDiv.className = 'dm-contact dm-contact-me';
  meDiv.innerHTML = `
    <div class="dm-contact-avatar">
      ${meInitials}
      <div class="dm-online${meOnline ? ' on' : ' off'}"></div>
    </div>
    <div style="flex:1;min-width:0">
      <div class="dm-contact-name">${escapeHtml(me)} <span style="font-weight:400;color:var(--softer)">(vous)</span></div>
      <div style="font-size:10px;color:${meOnline ? '#22c55e' : '#9ca3af'};font-weight:600">${meOnline ? 'En ligne' : 'Connexion en cours…'}</div>
    </div>
    <button type="button" class="dm-notif-btn" id="notif-toggle-btn" onclick="requestNotifPermission()" title="Activer les notifications navigateur">🔔</button>
  `;
  cont.appendChild(meDiv);

  // -- Groupes --
  const groupIds = Object.keys(_myGroups).sort((a, b) =>
    (_myGroups[a].name || '').localeCompare(_myGroups[b].name || '', 'fr'));
  if (groupIds.length) {
    const label = document.createElement('div');
    label.className = 'dm-section-label';
    label.textContent = 'GROUPES';
    cont.appendChild(label);
    groupIds.forEach(gid => {
      const g = _myGroups[gid];
      const memberCount = (g.members || []).length;
      const div = document.createElement('div');
      div.className = 'dm-contact dm-contact-group' + (gid === _activeGroupId ? ' active' : '');
      div.dataset.group = gid;
      div.onclick = () => openGroup(gid);
      div.innerHTML = `
        <div class="dm-contact-avatar dm-group-avatar">👥</div>
        <div style="flex:1;min-width:0">
          <div class="dm-contact-name">${escapeHtml(g.name || 'Groupe')}</div>
          <div style="font-size:10px;color:var(--softer);font-weight:600">${memberCount} membre${memberCount > 1 ? 's' : ''}</div>
        </div>
        ${_groupUnread[gid] ? `<div class="dm-unread">${_groupUnread[gid]}</div>` : ''}
      `;
      cont.appendChild(div);
    });
  }

  // -- Membres (1-à-1) --
  const labelM = document.createElement('div');
  labelM.className = 'dm-section-label';
  labelM.textContent = 'MEMBRES';
  cont.appendChild(labelM);

  const members = ALL_MEMBERS.filter(name => name !== me);
  members.sort((a, b) => {
    const aOn = _onlineMembers.has(a), bOn = _onlineMembers.has(b);
    if (aOn !== bOn) return aOn ? -1 : 1;
    return a.localeCompare(b, 'fr');
  });
  members.forEach(name => {
    const online = _onlineMembers.has(name);
    const initials = name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    const div = document.createElement('div');
    div.className = 'dm-contact' + (name === _dmWith ? ' active' : '');
    div.dataset.name = name;
    div.onclick = () => openDMWith(name);
    div.innerHTML = `
      <div class="dm-contact-avatar">
        ${initials}
        <div class="dm-online${online ? ' on' : ' off'}"></div>
      </div>
      <div style="flex:1;min-width:0">
        <div class="dm-contact-name">${escapeHtml(name)}</div>
        <div style="font-size:10px;color:${online ? '#22c55e' : '#9ca3af'};font-weight:600">${online ? 'En ligne' : 'Hors ligne'}</div>
      </div>
      ${_dmUnread[name] ? `<div class="dm-unread">${_dmUnread[name]}</div>` : ''}
    `;
    cont.appendChild(div);
  });

  updateNotifBtn();
}

// ── Compteurs non-lus DM ──
let _dmUnread = {};
function trackUnread() {
  if (_unreadTrackingStarted) return; // correctif n°2 : voir note d'audit ci-dessus
  const me = getCurrentUser();
  if (!me || !fbDb) return;
  _unreadTrackingStarted = true;
  ALL_MEMBERS.filter(n => n !== me).forEach(other => {
    const key = dmKey(me, other);
    onValue(ref(fbDb, `dm/${key}`), snap => {
      const msgs = Object.values(snap.val() || {});
      const unread = msgs.filter(m => m.to === me && !m.read && !m.deleted).length;
      // Ding + notification si nouveaux messages non lus (et pas premier chargement, et pas la conv déjà ouverte)
      const prev = _prevUnread[other] ?? null;
      if (prev !== null && unread > prev && _dmWith !== other) {
        playDing();
        const lastMsg = msgs.filter(m => m.to === me && !m.deleted).sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
        const body = lastMsg ? (lastMsg.file ? '📎 ' + (lastMsg.file.name || 'Pièce jointe') : lastMsg.text || '') : 'Nouveau message';
        const openConv = () => { nav('chat', document.querySelector('[data-page="chat"]')); openDMWith(other); };
        pushBrowserNotif('💬 ' + other, body, openConv);
        pushChatToast(other, body, openConv);
      }
      _prevUnread[other] = unread;
      _dmUnread[other] = unread || 0;
      updateDMBadge();
      renderDMContacts();
    });
  });
}

function updateDMBadge() {
  const dmTotal = Object.values(_dmUnread).reduce((a, b) => a + b, 0);
  const groupTotal = Object.values(_groupUnread).reduce((a, b) => a + b, 0);
  const total = dmTotal + groupTotal;
  const navBtns = document.querySelectorAll('[data-page="chat"]');
  navBtns.forEach(btn => {
    let badge = btn.querySelector('.nav-dm-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nav-dm-badge';
      badge.style.cssText = 'background:var(--notif-red);color:white;border-radius:20px;font-size:9px;font-weight:700;padding:1px 5px;margin-left:4px;vertical-align:middle;animation:notifPulse 1.6s ease-in-out infinite';
      btn.appendChild(badge);
    }
    badge.textContent = total || '';
    badge.style.display = total ? '' : 'none';
  });
  updateChatAlertBanner(total);
}

// ── Bannière d'alerte quand les non-lus s'accumulent (>= 3) ──
let _chatBannerDismissedAt = 0;
function updateChatAlertBanner(total) {
  const banner = document.getElementById('chat-alert-banner');
  if (!banner) return;
  if (total === 0) _chatBannerDismissedAt = 0;
  if (total >= 3 && total > _chatBannerDismissedAt) {
    document.getElementById('chat-alert-banner-text').textContent = `📬 ${total} messages non lus`;
    const fbBanner = document.getElementById('fb-banner');
    const fbVisible = fbBanner && getComputedStyle(fbBanner).display !== 'none';
    banner.style.top = fbVisible ? `calc(var(--topbar-h) + ${fbBanner.offsetHeight}px)` : 'var(--topbar-h)';
    banner.classList.add('show');
  } else {
    banner.classList.remove('show');
  }
}
function dismissChatBanner() {
  const dmTotal = Object.values(_dmUnread).reduce((a, b) => a + b, 0);
  const groupTotal = Object.values(_groupUnread).reduce((a, b) => a + b, 0);
  _chatBannerDismissedAt = dmTotal + groupTotal;
  document.getElementById('chat-alert-banner').classList.remove('show');
}
window.dismissChatBanner = dismissChatBanner;
function openChatFromBanner() {
  nav('chat', document.querySelector('[data-page="chat"]'));
}
window.openChatFromBanner = openChatFromBanner;

// ── Toast de message (visible même onglet actif au premier plan) ──
function pushChatToast(name, text, onClick) {
  const stack = document.getElementById('chat-toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'chat-toast';
  const initials = (name || '').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  el.innerHTML = `<div class="chat-toast-avatar">${escapeHtml(initials)}</div><div class="chat-toast-body"><div class="chat-toast-name">${escapeHtml(name || '')}</div><div class="chat-toast-text">${escapeHtml(text || 'Nouveau message')}</div></div>`;
  el.onclick = () => { if (onClick) onClick(); el.remove(); };
  stack.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 320);
  }, 5000);
}
window.pushChatToast = pushChatToast;

// ── Ouvrir une conversation 1-à-1 ──
function openDMWith(name) {
  const me = getCurrentUser();
  if (!me) { alert('Connectez-vous pour accéder aux messages.'); return; }
  if (!fbDb) { showToast('⚠ Connexion Firebase indisponible pour le moment. Réessayez dans quelques secondes.', 'warn'); return; }
  _activeGroupId = null;
  _dmWith = name;
  clearPendingAttachment();

  document.getElementById('dm-pane-empty').style.display = 'none';
  const conv = document.getElementById('dm-conv');
  conv.style.display = 'flex';
  const initials = name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  document.getElementById('dm-conv-avatar').textContent = initials;
  document.getElementById('dm-conv-name').textContent = name;
  document.getElementById('dm-conv-status').textContent = _onlineMembers.has(name) ? '🟢 En ligne' : '⚫ Hors ligne';
  const leaveBtn = document.getElementById('dm-leave-group-btn');
  if (leaveBtn) leaveBtn.style.display = 'none';
  const dmInput = document.getElementById('dm-input');
  if (dmInput) dmInput.placeholder = 'Votre message…';

  document.querySelectorAll('.dm-contact').forEach(el => {
    el.classList.toggle('active', el.dataset.name === name);
  });

  _dmUnread[name] = 0;
  updateDMBadge();
  renderDMContacts();

  if (_dmUnsub) _dmUnsub();
  const commission = COMMISSION;
  const key = dmKey(me, name);
  const msgRef = ref(fbDb, `dm/${key}`);
  _dmUnsub = onValue(msgRef, snap => {
    renderDMMessages(snap.val() || {}, me, name, commission, key);
  });

  setTimeout(() => document.getElementById('dm-input')?.focus(), 100);
}
window.openDMWith = openDMWith;

// ── Rendu messages DM ──
function renderDMMessages(data, me, other, commission, key) {
  const cont = document.getElementById('dm-messages');
  if (!cont) return;
  const entries = Object.entries(data).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
  cont.innerHTML = '';

  entries.filter(([, m]) => m.to === me && !m.read).forEach(([k]) => {
    fbSet(`dm/${key}/${k}/read`, true);
  });

  if (!entries.length) {
    cont.innerHTML = '<div style="text-align:center;color:var(--softer);font-size:13px;margin-top:30px">Démarrez la conversation 👋</div>';
    return;
  }

  let lastDate = '';
  entries.forEach(([k, m]) => {
    const mine = m.from === me;
    const d = m.ts ? new Date(m.ts) : null;
    const dateStr = d ? d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
    const timeStr = d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';

    if (dateStr && dateStr !== lastDate) {
      const sep = document.createElement('div');
      sep.style.cssText = 'text-align:center;font-size:11px;color:var(--softer);margin:10px 0;display:flex;align-items:center;gap:8px';
      sep.innerHTML = `<hr style="flex:1;border:none;border-top:1px solid var(--mid)"><span>${escapeHtml(dateStr)}</span><hr style="flex:1;border:none;border-top:1px solid var(--mid)">`;
      cont.appendChild(sep);
      lastDate = dateStr;
    }

    const div = document.createElement('div');
    div.className = 'dm-msg ' + (mine ? 'mine' : 'theirs');
    if (m.deleted) {
      div.innerHTML = `<div class="dm-msg-bubble" style="opacity:.45;font-style:italic;font-size:12px">🚫 Message supprimé</div>`;
    } else {
      const read = m.read && mine;
      const attHtml = m.file ? renderAttachmentHtml(m.file) : '';
      const textHtml = m.text ? `<div>${highlightMentions(escapeHtml(m.text))}</div>` : '';
      div.innerHTML = `
        <div class="dm-msg-time">${escapeHtml(timeStr)}</div>
        <div class="dm-msg-bubble" style="position:relative">
          ${attHtml}${textHtml}
          ${mine ? `<button class="dm-msg-del" onclick="deleteDMMsg('${k}','${commission}','${key}')" title="Supprimer">🗑</button>` : ''}
        </div>
        ${mine ? `<div class="dm-msg-receipt${read ? ' is-read' : ''}">${read ? '✓✓ Lu' : '✓ Envoyé'}</div>` : ''}
      `;
    }
    cont.appendChild(div);
  });
  cont.scrollTop = cont.scrollHeight;
}

// ── Supprimer un DM ──
function deleteDMMsg(msgKey, commission, convKey) {
  if (!confirm('Supprimer ce message ?')) return;
  fbSet(`dm/${convKey}/${msgKey}/deleted`, true);
}
window.deleteDMMsg = deleteDMMsg;

// ── Init page Chat (appelée à chaque clic sur l'onglet 💬) ──
function initDMPage() {
  initPresenceDM(); // idempotent désormais (garde-fou interne, cf. note d'audit)
  renderDMContacts();
}
window.initDMPage = initDMPage;


// ══════════════════════════════════════════════════════════════
// DISCUSSIONS DE GROUPE
// ══════════════════════════════════════════════════════════════
let _newGroupMembers = [];

// ── Index des groupes dont je suis membre (fan-out Firebase) ──
function initGroupsIndex() {
  const me = getCurrentUser();
  if (!me || !fbDb) return;
  onValue(ref(fbDb, `groupIndex/${encodeURIComponent(me)}`), snap => {
    const ids = Object.keys(snap.val() || {});
    // Nettoyer les groupes quittés / supprimés
    Object.keys(_myGroups).forEach(gid => {
      if (!ids.includes(gid)) {
        delete _myGroups[gid];
        if (_groupMsgUnsubs[gid]) { _groupMsgUnsubs[gid](); delete _groupMsgUnsubs[gid]; }
        delete _groupUnread[gid];
      }
    });
    ids.forEach(gid => {
      if (!_myGroups[gid]) {
        onValue(ref(fbDb, `groups/${gid}/meta`), metaSnap => {
          const meta = metaSnap.val();
          if (!meta) return;
          _myGroups[gid] = meta;
          renderDMContacts();
          if (_activeGroupId === gid) updateGroupHeader(gid);
        });
      }
      trackGroupUnread(gid);
    });
    renderDMContacts();
  });
}

// ── Suivi des non-lus d'un groupe (garde-fou anti-doublon intégré) ──
function trackGroupUnread(gid) {
  if (_groupMsgUnsubs[gid]) return;
  const me = getCurrentUser();
  _groupMsgUnsubs[gid] = onValue(ref(fbDb, `groups/${gid}/messages`), snap => {
    const msgs = Object.values(snap.val() || {});
    const unread = msgs.filter(m => m.who !== me && !m.deleted && !(m.readBy && m.readBy[encodeURIComponent(me)])).length;
    const prevKey = 'g_' + gid;
    const prev = _prevUnread[prevKey] ?? null;
    if (prev !== null && unread > prev && _activeGroupId !== gid) {
      playDing();
      const lastMsg = msgs.filter(m => m.who !== me && !m.deleted).sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
      const gName = (_myGroups[gid] && _myGroups[gid].name) || 'Groupe';
      const mentioned = lastMsg && isMentioned(lastMsg.text, me);
      const title = mentioned ? `🔔 ${lastMsg.who} vous a mentionné · ${gName}` : `👥 ${gName}`;
      const body = lastMsg ? (lastMsg.file ? '📎 ' + (lastMsg.file.name || 'Pièce jointe') : (mentioned ? '' : (lastMsg.who + ' : ')) + (lastMsg.text || '')) : 'Nouveau message';
      const openConv = () => { nav('chat', document.querySelector('[data-page="chat"]')); openGroup(gid); };
      pushBrowserNotif(title, body, openConv);
      pushChatToast(title, body, openConv);
    }
    _prevUnread[prevKey] = unread;
    _groupUnread[gid] = unread || 0;
    updateDMBadge();
    renderDMContacts();
  });
}

// ── Ouvrir une discussion de groupe ──
function openGroup(gid) {
  const me = getCurrentUser();
  if (!me) { alert('Connectez-vous pour accéder aux messages.'); return; }
  if (!fbDb) { showToast('⚠ Connexion Firebase indisponible pour le moment. Réessayez dans quelques secondes.', 'warn'); return; }
  const g = _myGroups[gid];
  if (!g) return;
  _dmWith = null;
  _activeGroupId = gid;
  clearPendingAttachment();

  document.getElementById('dm-pane-empty').style.display = 'none';
  const conv = document.getElementById('dm-conv');
  conv.style.display = 'flex';
  document.getElementById('dm-conv-avatar').textContent = '👥';
  updateGroupHeader(gid);
  const leaveBtn = document.getElementById('dm-leave-group-btn');
  if (leaveBtn) { leaveBtn.style.display = ''; leaveBtn.onclick = () => leaveGroup(gid); }
  const dmInput = document.getElementById('dm-input');
  if (dmInput) dmInput.placeholder = "Votre message… (@Nom pour mentionner quelqu'un)";

  document.querySelectorAll('.dm-contact').forEach(el => {
    el.classList.toggle('active', el.dataset.group === gid);
  });

  _groupUnread[gid] = 0;
  updateDMBadge();
  renderDMContacts();

  if (_dmUnsub) _dmUnsub();
  const msgRef = ref(fbDb, `groups/${gid}/messages`);
  _dmUnsub = onValue(msgRef, snap => {
    renderGroupMessages(snap.val() || {}, me, gid);
  });

  setTimeout(() => document.getElementById('dm-input')?.focus(), 100);
}
window.openGroup = openGroup;

function updateGroupHeader(gid) {
  const g = _myGroups[gid];
  if (!g || _activeGroupId !== gid) return;
  document.getElementById('dm-conv-name').textContent = g.name || 'Groupe';
  document.getElementById('dm-conv-status').textContent = `${(g.members || []).length} membre(s) · ${(g.members || []).join(', ')}`;
}

// ── Rendu messages de groupe ──
function renderGroupMessages(data, me, gid) {
  const cont = document.getElementById('dm-messages');
  if (!cont) return;
  const entries = Object.entries(data).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
  cont.innerHTML = '';

  entries.filter(([, m]) => m.who !== me && !m.deleted && !(m.readBy && m.readBy[encodeURIComponent(me)])).forEach(([k]) => {
    fbSet(`groups/${gid}/messages/${k}/readBy/${encodeURIComponent(me)}`, true);
  });

  if (!entries.length) {
    cont.innerHTML = '<div style="text-align:center;color:var(--softer);font-size:13px;margin-top:30px">Démarrez la discussion 👋</div>';
    return;
  }

  let lastDate = '';
  entries.forEach(([k, m]) => {
    const mine = m.who === me;
    const d = m.ts ? new Date(m.ts) : null;
    const dateStr = d ? d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
    const timeStr = d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';

    if (dateStr && dateStr !== lastDate) {
      const sep = document.createElement('div');
      sep.style.cssText = 'text-align:center;font-size:11px;color:var(--softer);margin:10px 0;display:flex;align-items:center;gap:8px';
      sep.innerHTML = `<hr style="flex:1;border:none;border-top:1px solid var(--mid)"><span>${escapeHtml(dateStr)}</span><hr style="flex:1;border:none;border-top:1px solid var(--mid)">`;
      cont.appendChild(sep);
      lastDate = dateStr;
    }

    const div = document.createElement('div');
    div.className = 'dm-msg ' + (mine ? 'mine' : 'theirs');
    if (m.deleted) {
      div.innerHTML = `<div class="dm-msg-bubble" style="opacity:.45;font-style:italic;font-size:12px">🚫 Message supprimé</div>`;
    } else {
      const attHtml = m.file ? renderAttachmentHtml(m.file) : '';
      const textHtml = m.text ? `<div>${highlightMentions(escapeHtml(m.text))}</div>` : '';
      const canDel = mine || isAdmin || isSuperAdmin();
      div.innerHTML = `
        <div class="dm-msg-time">${!mine ? `<strong>${escapeHtml(m.who || '?')}</strong> · ` : ''}${escapeHtml(timeStr)}</div>
        <div class="dm-msg-bubble" style="position:relative">
          ${attHtml}${textHtml}
          ${canDel ? `<button class="dm-msg-del" onclick="deleteGroupMsg('${k}','${gid}')" title="Supprimer">🗑</button>` : ''}
        </div>
      `;
    }
    cont.appendChild(div);
  });
  cont.scrollTop = cont.scrollHeight;
}

function deleteGroupMsg(msgKey, gid) {
  if (!confirm('Supprimer ce message ?')) return;
  fbSet(`groups/${gid}/messages/${msgKey}/deleted`, true);
}
window.deleteGroupMsg = deleteGroupMsg;

// ── Modale "Nouvelle discussion de groupe" ──
function openNewGroupModal() {
  const me = getCurrentUser();
  if (!me) { alert('Connectez-vous pour créer un groupe.'); return; }
  _newGroupMembers = [];
  document.getElementById('ng-name').value = '';
  renderNewGroupChips();
  openModal('m-new-group');
}
window.openNewGroupModal = openNewGroupModal;

function renderNewGroupChips() {
  const me = getCurrentUser();
  const cont = document.getElementById('ng-members');
  if (!cont) return;
  cont.innerHTML = ALL_MEMBERS.filter(n => n !== me).map(name => {
    const active = _newGroupMembers.includes(name);
    return `<span class="mchip${active ? ' active' : ''}" onclick="toggleNewGroupMember('${name}')"><span class="chip-check">✓</span>${escapeHtml(name)}</span>`;
  }).join('');
}
window.renderNewGroupChips = renderNewGroupChips;

function toggleNewGroupMember(name) {
  const i = _newGroupMembers.indexOf(name);
  if (i >= 0) _newGroupMembers.splice(i, 1); else _newGroupMembers.push(name);
  renderNewGroupChips();
}
window.toggleNewGroupMember = toggleNewGroupMember;

function createGroup() {
  const me = getCurrentUser();
  if (!me) { alert('Connectez-vous pour créer un groupe.'); return; }
  if (!fbDb) { showToast('⚠ Connexion Firebase indisponible pour le moment.', 'warn'); return; }
  const name = document.getElementById('ng-name').value.trim();
  if (!name) { alert('Le nom du groupe est obligatoire.'); return; }
  if (!_newGroupMembers.length) { alert('Sélectionnez au moins un membre.'); return; }
  const members = Array.from(new Set([..._newGroupMembers, me]));
  const gid = 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  fbSet(`groups/${gid}/meta`, { name, members, createdBy: me, createdAt: Date.now() }).then(() => {
    members.forEach(m => fbSet(`groupIndex/${encodeURIComponent(m)}/${gid}`, true));
    closeModal('m-new-group');
    showToast('✅ Groupe créé');
    logAction('Groupe créé', '«' + name + '»');
  }).catch(() => { /* fbSet gère déjà l'affichage de l'erreur */ });
}
window.createGroup = createGroup;

function leaveGroup(gid) {
  const me = getCurrentUser();
  const g = _myGroups[gid];
  if (!me || !g) return;
  if (!confirm(`Quitter le groupe « ${g.name} » ?`)) return;
  fbSet(`groupIndex/${encodeURIComponent(me)}/${gid}`, null);
  const newMembers = (g.members || []).filter(m => m !== me);
  fbSet(`groups/${gid}/meta/members`, newMembers);
  if (_activeGroupId === gid) {
    _activeGroupId = null;
    document.getElementById('dm-conv').style.display = 'none';
    document.getElementById('dm-pane-empty').style.display = '';
  }
}
window.leaveGroup = leaveGroup;


// ══════════════════════════════════════════════════════════════
// PIÈCES JOINTES (documents/images) — DM et groupes
// ══════════════════════════════════════════════════════════════
function handleAttachmentChange(input) {
  const file = input.files && input.files[0];
  input.value = ''; // permet de resélectionner le même fichier ensuite
  if (!file) return;
  if (file.size > MAX_ATTACHMENT_BYTES) {
    alert(`Fichier trop volumineux (${Math.round(file.size / 1024 / 1024 * 10) / 10} Mo). Limite actuelle : ${MAX_ATTACHMENT_BYTES / 1024 / 1024} Mo.\n\nPour un fichier plus lourd, partagez plutôt un lien vers le dossier Drive de la commission.`);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    _pendingAttachment = { name: file.name, mime: file.type || 'application/octet-stream', size: file.size, dataUrl: reader.result };
    renderPendingAttachment();
  };
  reader.onerror = () => alert('Impossible de lire ce fichier.');
  reader.readAsDataURL(file);
}
window.handleAttachmentChange = handleAttachmentChange;

function renderPendingAttachment() {
  const bar = document.getElementById('dm-pending-att');
  if (!bar) return;
  if (!_pendingAttachment) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  const sizeKb = Math.round(_pendingAttachment.size / 1024);
  bar.style.display = 'flex';
  bar.innerHTML = `<span class="dm-pending-ico">📎</span><span class="dm-pending-name">${escapeHtml(_pendingAttachment.name)}</span><span class="dm-pending-size">${sizeKb} Ko</span><button type="button" class="dm-pending-remove" onclick="clearPendingAttachment()" title="Retirer">✕</button>`;
}

function clearPendingAttachment() {
  _pendingAttachment = null;
  renderPendingAttachment();
}
window.clearPendingAttachment = clearPendingAttachment;

function renderAttachmentHtml(file) {
  if (!file) return '';
  const isImage = (file.mime || '').startsWith('image/');
  const sizeKb = file.size ? Math.round(file.size / 1024) : null;
  if (isImage) {
    return `<a href="${file.dataUrl}" target="_blank" rel="noopener" class="dm-att-img-wrap"><img src="${file.dataUrl}" class="dm-att-img" alt="${escapeHtml(file.name || 'image')}"></a>`;
  }
  const ext = (file.name || '').split('.').pop().toUpperCase().substring(0, 4);
  return `<a href="${file.dataUrl}" download="${escapeHtml(file.name || 'document')}" class="dm-att-file">
      <span class="dm-att-ico">📄<span class="dm-att-ext">${escapeHtml(ext)}</span></span>
      <span class="dm-att-meta"><span class="dm-att-name">${escapeHtml(file.name || 'Document')}</span><span class="dm-att-size">${sizeKb ? sizeKb + ' Ko' : ''} · télécharger</span></span>
    </a>`;
}

// ── Envoyer (DM ou groupe, texte et/ou pièce jointe) ──
function sendDM() {
  const me = getCurrentUser();
  if (!me) return;
  if (!fbDb) { showToast('⚠ Connexion Firebase indisponible pour le moment. Réessayez dans quelques secondes.', 'warn'); return; }
  if (!_dmWith && !_activeGroupId) return;
  const inp = document.getElementById('dm-input');
  const text = (inp?.value || '').trim();
  if (!text && !_pendingAttachment) return;

  const payload = { text, ts: Date.now() };
  if (_pendingAttachment) payload.file = { ..._pendingAttachment };

  if (_activeGroupId) {
    payload.who = me;
    payload.readBy = { [encodeURIComponent(me)]: true };
    fbPush(`groups/${_activeGroupId}/messages`, payload);
  } else {
    const key = dmKey(me, _dmWith);
    payload.from = me;
    payload.to = _dmWith;
    payload.read = false;
    fbPush(`dm/${key}`, payload);
  }

  inp.value = '';
  inp.style.height = 'auto';
  clearPendingAttachment();
}
window.sendDM = sendDM;


// ══════════════════════════════════════════════════════════════
// MENTIONS @Nom (mise en évidence dans les messages)
// ══════════════════════════════════════════════════════════════
function isMentioned(text, me) {
  if (!text || !me) return false;
  const re = new RegExp('@' + me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
  return re.test(text);
}

function highlightMentions(escapedText) {
  if (!escapedText) return escapedText;
  let out = escapedText;
  ALL_MEMBERS.forEach(name => {
    const re = new RegExp('@' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    out = out.replace(re, `<span class="dm-mention">@${name}</span>`);
  });
  return out;
}

// ══════════════════════════════════════════════════════════════
// NOTIFICATIONS NAVIGATEUR (API Notification)
// ══════════════════════════════════════════════════════════════
// Fonctionnent tant que le navigateur est ouvert (onglet actif ou en arrière-plan,
// fenêtre minimisée) — pas de vraie "push" navigateur fermé, qui nécessiterait un
// service worker + Firebase Cloud Messaging + Cloud Functions côté serveur (donc un
// passage au plan payant Firebase Blaze). À envisager plus tard si besoin, avec
// validation préalable du coût.
function notifPermissionState() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

function requestNotifPermission() {
  if (!('Notification' in window)) { alert("Ce navigateur ne prend pas en charge les notifications."); return; }
  if (Notification.permission === 'denied') {
    alert("Les notifications sont bloquées pour ce site. Pour les activer : cliquez sur le cadenas 🔒 à côté de l'adresse du site, puis autorisez les notifications.");
    return;
  }
  Notification.requestPermission().then(() => { updateNotifBtn(); });
}
window.requestNotifPermission = requestNotifPermission;

function updateNotifBtn() {
  const btn = document.getElementById('notif-toggle-btn');
  if (!btn) return;
  const state = notifPermissionState();
  if (state === 'granted') { btn.textContent = '🔔'; btn.classList.add('on'); btn.title = 'Notifications activées'; }
  else if (state === 'denied') { btn.textContent = '🔕'; btn.classList.remove('on'); btn.title = 'Notifications bloquées (réglages du navigateur)'; }
  else { btn.textContent = '🔔'; btn.classList.remove('on'); btn.title = 'Activer les notifications navigateur'; }
}

function pushBrowserNotif(title, body, onClick) {
  if (notifPermissionState() !== 'granted') return;
  // Correctif 22/07/2026 : l'ancienne condition `if (document.hasFocus()) return;` bloquait la
  // notification dès que l'onglet avait le focus — donc quasiment toujours en usage normal
  // (l'utilisateur a le navigateur ouvert devant lui, juste pas forcément sur la bonne conversation).
  // Le fait de ne pas notifier quand la conversation exacte est déjà ouverte est déjà géré par
  // l'appelant (trackUnread/trackGroupUnread, condition _dmWith/_activeGroupId) — pas besoin
  // d'une condition supplémentaire ici.
  try {
    const n = new Notification(title, { body: (body || '').substring(0, 140) });
    n.onclick = () => { window.focus(); if (onClick) onClick(); n.close(); };
  } catch (e) { /* API indisponible sur ce contexte (ex. http non sécurisé) */ }
}

// ── NOTIFICATION SONORE ──
let _audioCtx = null;
let _prevUnread = {};  // mémoriser l'état précédent pour détecter les nouveaux msgs (DM ET groupes, clés préfixées 'g_' pour les groupes)

function getDingCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function playDing() {
  try {
    const ctx = getDingCtx();
    // Accord ascendant façon notification "classique" — plus marqué que l'ancien ding discret
    const notes = [
      { freq: 987.77,  start: 0,    dur: 0.16, vol: 0.42 },
      { freq: 1318.51, start: 0.09, dur: 0.16, vol: 0.40 },
      { freq: 1567.98, start: 0.18, dur: 0.30, vol: 0.36 },
    ];
    notes.forEach(({ freq, start, dur, vol }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.03);
    });
  } catch(e) { /* Web Audio non disponible */ }
}
window.playDing = playDing;


// ── TÂCHES QUOTIDIENNES — détail, édition, mail ──
let _qtDetailIdx = null;

function openQTDetail(i) {
  const arr = getQuickTasks();
  const t = arr[i];
  if (!t) return;
  _qtDetailIdx = i;

  document.getElementById('qtd-title').textContent = t.title || 'Sans titre';

  const dl = t.deadline ? new Date(t.deadline).toLocaleDateString('fr-FR', {day:'numeric',month:'long',year:'numeric'}) : null;
  document.getElementById('qtd-assignee').innerHTML = t.assignee
    ? `<span style="font-size:13px;font-weight:600">👤 Responsable : <strong>${escapeHtml(t.assignee)}</strong></span>` : '';
  document.getElementById('qtd-deadline').innerHTML = dl
    ? `<span style="font-size:13px">📅 Échéance : ${escapeHtml(dl)}</span>` : '';
  document.getElementById('qtd-note').innerHTML = t.note
    ? `📝 ${escapeHtml(t.note)}` : '';
  document.getElementById('qtd-status').innerHTML = t.status === 'done'
    ? '<span style="color:#2e7d32;font-weight:700;font-size:13px">✅ Tâche validée</span>'
    : '<span style="color:var(--softer);font-size:13px">⏳ En cours</span>';
  document.getElementById('qtd-created').textContent = t.createdBy
    ? `Créée par ${t.createdBy}` : '';

  // Bouton "Valider" masqué si déjà done
  const doneBtn = document.getElementById('qtd-btn-done');
  if (doneBtn) doneBtn.style.display = t.status === 'done' ? 'none' : '';
  const reopenBtn = document.getElementById('qtd-btn-reopen');
  if (reopenBtn) reopenBtn.style.display = t.status === 'done' ? '' : 'none';

  // Reset vue édition
  document.getElementById('qtd-view').style.display = '';
  document.getElementById('qtd-edit').style.display = 'none';
  document.getElementById('qtd-btn-save').style.display = 'none';
  const editBtn = document.getElementById('qtd-btn-edit');
  if (editBtn) editBtn.style.display = '';

  // Initialiser le lien Drive
  const qtDriveLink=document.getElementById('qtd-drive-link');
  if(qtDriveLink&&_driveUrl)qtDriveLink.href=_driveUrl;
  if(document.getElementById('qtd-drive-config'))document.getElementById('qtd-drive-config').style.display='none';
  openModal('m-qt-detail');
}
window.openQTDetail = openQTDetail;

function toggleQTEdit() {
  const arr = getQuickTasks();
  const t = arr[_qtDetailIdx];
  if (!t) return;

  // Peupler le formulaire d'édition
  document.getElementById('qtd-edit-title').value = t.title || '';
  document.getElementById('qtd-edit-deadline').value = t.deadline || '';
  document.getElementById('qtd-edit-note').value = t.note || '';

  // Peupler le select membres
  const sel = document.getElementById('qtd-edit-assignee');
  sel.innerHTML = '<option value="">— Aucun —</option>';
  ALL_MEMBERS.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    if (name === t.assignee) opt.selected = true;
    sel.appendChild(opt);
  });

  document.getElementById('qtd-view').style.display = 'none';
  document.getElementById('qtd-edit').style.display = '';
  document.getElementById('qtd-btn-edit').style.display = 'none';
  document.getElementById('qtd-btn-save').style.display = '';
}
window.toggleQTEdit = toggleQTEdit;

function saveQTEdit() {
  const arr = getQuickTasks();
  const t = arr[_qtDetailIdx];
  if (!t) return;
  const newTitle = document.getElementById('qtd-edit-title').value.trim();
  if (!newTitle) { alert('Le titre est obligatoire.'); return; }
  const oldAssignee = t.assignee;
  t.title = newTitle;
  t.assignee = document.getElementById('qtd-edit-assignee').value;
  t.deadline = document.getElementById('qtd-edit-deadline').value;
  t.note = document.getElementById('qtd-edit-note').value.trim();
  writeQuickTasks(arr);
  logAction('Tâche quotidien modifiée', '«' + newTitle + '»');
  // Notifier le nouveau responsable si changement
  if (t.assignee && t.assignee !== oldAssignee) notifyQTAssignee(t);
  closeModal('m-qt-detail');
  renderQuickTasks();
  showToast('✅ Tâche mise à jour');
}
window.saveQTEdit = saveQTEdit;

function doneQTFromDetail() {
  if (_qtDetailIdx === null) return;
  const arr = getQuickTasks();
  const t = arr[_qtDetailIdx];
  if (!t) return;
  t.status = 'done';
  t.doneAt = Date.now();
  writeQuickTasks(arr);
  logAction('Tâche quotidien ✓', t.title);
  closeModal('m-qt-detail');
  renderQuickTasks();
}
window.doneQTFromDetail = doneQTFromDetail;

function reopenQTFromDetail() {
  if (_qtDetailIdx === null) return;
  const arr = getQuickTasks();
  const t = arr[_qtDetailIdx];
  if (!t) return;
  t.status = 'todo';
  delete t.doneAt;
  writeQuickTasks(arr);
  logAction('Tâche quotidien réouverte', t.title);
  closeModal('m-qt-detail');
  renderQuickTasks();
  showToast('↩ Tâche réouverte');
}
window.reopenQTFromDetail = reopenQTFromDetail;

function deleteQTFromDetail() {
  if (_qtDetailIdx === null) return;
  if (!confirm('Supprimer cette tâche ?')) return;
  const arr = getQuickTasks();
  arr.splice(_qtDetailIdx, 1);
  writeQuickTasks(arr);
  closeModal('m-qt-detail');
  renderQuickTasks();
}
window.deleteQTFromDetail = deleteQTFromDetail;

// ── Mail au responsable ──
function notifyQTAssignee(qt) {
  const ejs = getEjsConfig();
  if (!ejs || !ejs.pubkey || !ejs.service || !ejs.template) return;
  const to = MEMBER_EMAILS[qt.assignee];
  if (!to) return;
  emailjs.init(ejs.pubkey);
  const dl = qt.deadline
    ? new Date(qt.deadline).toLocaleDateString('fr-FR', {day:'numeric',month:'long',year:'numeric'})
    : 'Non définie';
  const me = getCurrentUser() || 'Un membre';
  emailjs.send(ejs.service, ejs.template, {
    to_email: to,
    subject: `📌 Tâche assignée — ${qt.title}`,
    message: `Bonjour ${qt.assignee},\n\n${me} vous a assigné la tâche suivante :\n\n📌 ${qt.title}\n📅 Échéance : ${dl}\n${qt.note ? '📝 Note : ' + qt.note + '\n' : ''}\nMerci de la traiter dans les meilleurs délais.\n\n— AGORA · Commission ${CFG.label} · Mairie de Lestiac`,
    from_name: 'AGORA · '+CFG.label,
    date: new Date().toLocaleDateString('fr-FR')
  }).then(() => showToast('✅ Mail envoyé à ' + qt.assignee))
     .catch(() => showToast('⚠ Mail non envoyé — vérifiez EmailJS', 'warn'));
}
window.notifyQTAssignee = notifyQTAssignee;


// ── Drive dans modale tâches quotidiennes ──
// Réutilise _driveUrl déjà chargé depuis Firebase par applyDriveUrl()
function openQTDrive(e) {
  if (_driveUrl) {
    // URL connue — ouvrir directement
    return;
  }
  e.preventDefault();
  if (isAdmin || isSuperAdmin()) {
    document.getElementById('qtd-drive-config').style.display = '';
    document.getElementById('qtd-drive-url-input').value = '';
  } else {
    showToast('⚠ Aucun dossier Drive configuré. Demandez à un administrateur.', 'warn');
  }
}
function saveQTDriveUrl() {
  const url = document.getElementById('qtd-drive-url-input').value.trim();
  if (!url) return;
  // Même chemin Firebase que le panneau Documents des projets
  fbSet(COMMISSION+'/config/driveUrl', url);
  applyDriveUrl(url);
  document.getElementById('qtd-drive-config').style.display = 'none';
  document.getElementById('qtd-drive-link').href = url;
  window.open(url, '_blank');
  logAction('Drive configuré (tâches)', url);
  showToast('✅ Lien Drive enregistré pour tous les membres');
}
function copyQTDriveLink() {
  if (!_driveUrl) { alert('Aucun lien Drive configuré.'); return; }
  navigator.clipboard?.writeText(_driveUrl)
    .then(() => showToast('✅ Lien copié !'))
    .catch(() => prompt('Copier ce lien :', _driveUrl));
}
window.openQTDrive = openQTDrive;
window.saveQTDriveUrl = saveQTDriveUrl;
window.copyQTDriveLink = copyQTDriveLink;


function filterProjAxe(axe, btn) {
  _filterAxe = axe;
  document.querySelectorAll('#axe-filter-bar .tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderProjects();
}
window.filterProjAxe = filterProjAxe;


// ── Rattachements transversaux (multi sous-commissions) ──
let _pieSubcoms=[];
function _pieRenderSubcoms(ownAxe){
  const c=document.getElementById('pie-subcoms');if(!c)return;c.innerHTML='';
  const store=getSubcoms();
  Object.values(store).forEach(s=>{
    if(!s||s.id===ownAxe)return;
    const on=_pieSubcoms.includes(s.id);
    const foreign=Array.isArray(s.commissions)&&!s.commissions.includes(COMMISSION_COURANTE);
    const chip=document.createElement('span');
    chip.className='multi-chip'+(on?' on':'');
    chip.innerHTML=(on?'✓ ':'')+(foreign?'🔗 ':'')+escapeHtml(s.nom);
    if(foreign)chip.title='Sous-commission d\'une autre commission : '+(s.commissions||[]).map(c=>COMMISSIONS[c]).filter(Boolean).join(', ');
    chip.onclick=()=>{_pieSubcoms=on?_pieSubcoms.filter(x=>x!==s.id):[..._pieSubcoms,s.id];_pieRenderSubcoms(ownAxe);};
    c.appendChild(chip);
  });
  if(!c.children.length)c.innerHTML='<span style="font-size:12px;color:var(--softer);font-style:italic">Aucune autre sous-commission disponible.</span>';
}
window._pieRenderSubcoms=_pieRenderSubcoms;

// ── ÉDITION INLINE PROJET ──
function openProjInlineEdit() {
  const p = getProjects().find(x => x.id === _currentProjId);
  if (!p) return;

  // Peupler les champs
  document.getElementById('pie-desc').value    = p.desc    || '';
  document.getElementById('pie-status').value  = p.status  || 's-lancer';
  document.getElementById('pie-horizon').value = p.horizon || 'court';
  document.getElementById('pie-budget').value  = p.budget  || '';
  document.getElementById('pie-subs').value    = p.subs    || '';

  // Peupler le select axe
  const sel = document.getElementById('pie-axe');
  sel.innerHTML = '<option value="">— Aucune —</option>';
  CFG.axeOptions.forEach(([v,l]) => { sel.innerHTML += `<option value='${v}'>${l}</option>`; });

  sel.value = p.axe || '';

  // rattachements transversaux : extras (hors axe principal)
  _pieSubcoms = Array.isArray(p.subcoms) ? p.subcoms.filter(id=>id&&id!==p.axe) : [];
  _pieRenderSubcoms(p.axe);

  // Afficher le panneau édition
  document.getElementById('proj-inline-edit').style.display = '';
  document.getElementById('proj-edit-btn').style.display    = 'none';
  document.getElementById('pie-desc').focus();
}
window.openProjInlineEdit = openProjInlineEdit;

function closeProjInlineEdit() {
  document.getElementById('proj-inline-edit').style.display = 'none';
  document.getElementById('proj-edit-btn').style.display    = '';
}
window.closeProjInlineEdit = closeProjInlineEdit;

function saveProjInlineEdit() {
  const arr = getProjects();
  const p   = arr.find(x => x.id === _currentProjId);
  if (!p) return;

  p.desc    = document.getElementById('pie-desc').value.trim();
  p.status  = document.getElementById('pie-status').value;
  p.horizon = document.getElementById('pie-horizon').value;
  p.axe     = document.getElementById('pie-axe').value;
  p.subcoms = _pieSubcoms.filter(id=>id&&id!==p.axe);
  p.budget  = document.getElementById('pie-budget').value.trim();
  p.subs    = document.getElementById('pie-subs').value.trim();

  writeProjects(arr);
  logAction('Projet modifié', '«' + p.title + '»');

  // Mettre à jour l'affichage sans fermer la modale
  document.getElementById('proj-detail-desc').textContent = p.desc;
  document.getElementById('proj-detail-budget').innerHTML =
    `💶 ${escapeHtml(p.budget)}${p.subs && p.subs !== '—' ? ' · ' + escapeHtml(p.subs) : ''}`;

  closeProjInlineEdit();
  renderProjects(); // Mettre à jour la carte dans la grille
  showToast('✅ Projet mis à jour');
}
window.saveProjInlineEdit = saveProjInlineEdit;


// ── Drive bouton landing page ──
function openBordDrive(e) {
  if (_driveUrl) return; // laisser le lien s'ouvrir normalement
  e.preventDefault();
  showToast('⚠ Dossier Drive non configuré. Ouvrez un projet → Documents pour le définir.', 'warn');
}
window.openBordDrive = openBordDrive;


// ── Solliciter Sophie depuis la modale détail projet ──
function solliciterSophieProjet() {
  const arr = getProjects();
  const p = arr.find(x => x.id === _currentProjId);
  if (!p) return;
  if (!confirm(`Envoyer un mail à Sophie pour le projet "\n${p.title}" ?`)) return;
  // Marquer le projet comme "Sophie sollicitée"
  p.sophie = true;
  writeProjects(arr);
  renderProjects();
  // Envoyer le mail avec le nom de la commission
  notifySophie(p.title, CFG.label);
  // Mettre à jour le badge sur la carte
  logAction('Sophie sollicitée', '«' + p.title + '»');
}
window.solliciterSophieProjet = solliciterSophieProjet;

// ── INIT ──
document.addEventListener('DOMContentLoaded',()=>{
  // Init Drive depuis cache localStorage
  if(_driveUrl) applyDriveUrl(_driveUrl);
  updateIdentityBtn();
  const cfg=getFbConfig()||FB_PRESET;
  initFirebase(cfg);
  renderAll();
  renderQuickTasks();
  updateDashShortcuts();
  initDMPage(); // présence et messagerie initialisées dès le chargement, quelle que soit la page d'accueil (idempotent)
  if(document.getElementById('ptask-add-form'))
    document.getElementById('ptask-add-form').style.display='none';
});

/* ══════════════════════════════════════════════════════════════
   JEFFERSON · AGORA — assistant contextuel + Q&R
   Appelle le relais Cloudflare Worker (clé API cachée côté serveur).
   ══════════════════════════════════════════════════════════════ */
const JEFFERSON_ENDPOINT = 'https://autumn-cherry-ff1fjefferson-agora.sylkor.workers.dev'; // ⚠ vérifier cette URL exacte dans le dashboard Cloudflare

const JEF_GUIDE = "Structure : Commission > Sous-commission (optionnelle) > Projet. Une sous-commission regroupe membres, devis et décisions. Les sous-commissions s'ouvrent en cliquant sur leur badge sous un projet (panneau qui se déplie sur place). Un devis passe par les statuts Demandé → Reçu → Validé/Refusé. Une sous-commission nouvellement créée reste en amorce (brouillon) tant qu'un admin ne l'a pas confirmée — invisible aux autres jusque-là. Le bouton Participants en haut à droite ouvre l'accès admin (mot de passe).";

let _jefMsgs = [];
let _jefSending = false;

function jeffersonSnapshot(){
  const me = getCurrentUser();
  const commissionNom = COMMISSIONS[COMMISSION_COURANTE] || 'la commission';
  const activeBtn = document.querySelector('#sidebar .nav-btn.active');
  const page = activeBtn ? activeBtn.dataset.page : 'bord';
  const subcoms = getSubcoms();
  const mine = Object.values(subcoms).filter(s=>Array.isArray(s.commissions)&&s.commissions.includes(COMMISSION_COURANTE));
  const admin = isAdmin || isSuperAdmin();

  const openIds = [...new Set(Object.values(_babState).map(v=>v.subId))];
  const openSubs = openIds.map(id=>subcoms[id]).filter(Boolean);

  let devisTxt;
  if(openSubs.length){
    const n = openSubs.reduce((a,s)=>a+s.devis.filter(d=>d.statut==='demande').length,0);
    devisTxt = n ? (n+' devis en attente dans "'+openSubs.map(s=>s.nom).join(', ')+'"') : ('aucun devis en attente dans "'+openSubs.map(s=>s.nom).join(', ')+'"');
  } else {
    const n = mine.filter(s=>!s._draft||admin).reduce((a,s)=>a+s.devis.filter(d=>d.statut==='demande').length,0);
    devisTxt = n ? (n+' devis en attente au total dans les sous-commissions de la commission') : 'aucun devis en attente';
  }

  const drafts = admin ? mine.filter(s=>s._draft).map(s=>s.nom) : [];

  return { me, commissionNom, page, subOuverte: openSubs.length ? openSubs.map(s=>s.nom).join(', ') : null, devisTxt, drafts, admin };
}

function buildJeffersonPrompt(){
  const s = jeffersonSnapshot();
  let t = "Tu es Jefferson, l'assistant d'AGORA, l'outil de pilotage des commissions de la mairie de Lestiac-sur-Garonne. Tu es direct et un peu taquin, jamais lourd. Tu tutoies tout le monde. Tu dis QUOI FAIRE, jamais QUOI PENSER.\n\n";
  t += "CE QUE TU SAIS D'AGORA (pour répondre aux questions générales) :\n" + JEF_GUIDE + "\n\n";
  t += "ÉTAT RÉEL DE LA SESSION — appuie-toi uniquement là-dessus, ne suppose rien d'autre :\n";
  t += "- Élu·e : " + (s.me || "non identifié·e") + "\n";
  t += "- Commission : " + s.commissionNom + " · page actuelle : " + s.page + "\n";
  t += "- Sous-commission ouverte : " + (s.subOuverte || "aucune") + "\n";
  t += "- Devis : " + s.devisTxt + "\n";
  if(s.admin && s.drafts.length) t += "- Amorces de sous-commissions non confirmées : " + s.drafts.join(', ') + "\n";
  t += "\nRÈGLES :\n";
  t += "- Ne conseille jamais une action déjà faite ou déjà mentionnée dans cette conversation.\n";
  t += "- Ne répète jamais un conseil déjà donné : reformule ou passe à l'étape suivante.\n";
  t += "- Si l'élu·e n'est pas identifié·e, propose avec humour de cliquer sur \"M'identifier\" en haut à droite, sans insister lourdement.\n";
  t += "- Réponds en 2 phrases maximum. Texte simple uniquement : aucun markdown, pas de #, pas de ** gras **, pas de listes à puces.";
  return t;
}

function _jefEsc(s){return escapeHtml(String(s||''))}

function _renderJefMsgs(){
  const list=document.getElementById('jef-msg-list');if(!list)return;
  list.innerHTML=_jefMsgs.map(m=>{
    const av=m.role==='assistant'?'<div class="jef-msg-avatar"></div>':'';
    return `<div class="jef-msg ${m.role}${m.typing?' typing':''}">${av}<span>${_jefEsc(m.text)}</span></div>`;
  }).join('');
  list.scrollTop=list.scrollHeight;
}

function jeffersonGreeting(){
  const me=getCurrentUser();
  return me ? `Salut ${me} ! Une question, un blocage ? Je suis là.` : `Salut ! Je suis Jefferson, ton guide dans AGORA. Pose ta question si tu bloques.`;
}

function toggleJefferson(){
  const d=document.getElementById('jef-drawer');if(!d)return;
  const opening=!d.classList.contains('open');
  d.classList.toggle('open');
  if(opening&&!_jefMsgs.length){_jefMsgs=[{role:'assistant',text:jeffersonGreeting()}];_renderJefMsgs();}
  if(opening)setTimeout(()=>{const i=document.getElementById('jef-input');if(i)i.focus()},150);
}
window.toggleJefferson=toggleJefferson;

async function sendJefferson(){
  const input=document.getElementById('jef-input');
  const q=(input.value||'').trim();
  if(!q||_jefSending)return;
  input.value='';
  _jefMsgs.push({role:'user',text:q});
  _jefMsgs.push({role:'assistant',text:'…',typing:true});
  _renderJefMsgs();
  _jefSending=true;
  document.getElementById('jef-send-btn').disabled=true;
  try{
    // slice(1) : on ne renvoie jamais le message d'accueil à l'API (elle exige que
    // l'historique commence par un message 'user', pas 'assistant').
    const history=_jefMsgs.slice(1).filter(m=>!m.typing).slice(-20).map(m=>({role:m.role,content:m.text}));
    const res=await fetch(JEFFERSON_ENDPOINT,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({system:buildJeffersonPrompt(),messages:history})
    });
    const data=await res.json();
    const txt=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('')||'…';
    _jefMsgs=_jefMsgs.filter(m=>!m.typing);
    _jefMsgs.push({role:'assistant',text:txt});
  }catch(e){
    console.error('[Jefferson] erreur:',e);
    _jefMsgs=_jefMsgs.filter(m=>!m.typing);
    _jefMsgs.push({role:'assistant',text:"Je suis momentanément indisponible."});
  }
  _jefSending=false;
  document.getElementById('jef-send-btn').disabled=false;
  _renderJefMsgs();
}
window.sendJefferson=sendJefferson;

/* ── Manifest PWA généré à la volée ── */
(function(){
  const manifest = {
    name: 'Commission ' + CFG.label + ' — Lestiac',
    short_name: CFG.label,
    start_url: CFG.startUrl,
    display: 'standalone',
    background_color: '#1B2F5E',
    theme_color: '#1B2F5E',
    icons: [{ src: CFG.iconSvg, sizes: 'any', type: 'image/svg+xml' }]
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = URL.createObjectURL(blob);
  document.head.appendChild(link);
})();
