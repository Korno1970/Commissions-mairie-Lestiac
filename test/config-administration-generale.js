/* ══════════════════════════════════════════════════════════════
   AGORA — configuration de la commission ADMINISTRATION GÉNÉRALE.
   Chargé AVANT agora-core.js. C'est le seul fichier à dupliquer et
   adapter pour une autre commission : le tronc commun ne bouge pas.
   ══════════════════════════════════════════════════════════════ */
window.AGORA_CONFIG = {

  /* ── Identité ── */
  branch:    'admin',
  code:      'adm',
  label:     'Administration Générale',
  slug:      'Administration-Generale',
  logPrefix: 'AG',
  startUrl:  'https://commissions-lestiac.fr/administration-generale.html',
  iconSvg:   'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20100%20100%22%3E%3Crect%20width%3D%22100%22%20height%3D%22100%22%20rx%3D%2220%22%20fill%3D%22%232358A4%22%2F%3E%3Ctext%20y%3D%22.9em%22%20font-size%3D%2280%22%20x%3D%2210%22%3E%F0%9F%8F%9B%3C%2Ftext%3E%3C%2Fsvg%3E',

  /* ── Page ouverte au démarrage et après déconnexion (doit correspondre au HTML) ── */
  homePage:  'chat',

  /* ── Clés localStorage, préfixées par commission ── */
  keys: {
    pwd:     'ag_pwd',
    local:   'ag_local_v1',
    ejs:     'ag_emailjs',
    visited: 'ag_visited',
    subcom:  'adm_subcoms',
    drive:   'lestiac_drive_admin'
  },

  /* ── Dossier Drive de la commission ── */
  driveUrl: 'https://drive.google.com/drive/u/0/folders/1lDN-UMwFqsMlyirWKXE-5NjDjCKzvi2m',

  /* ── Axes ── */
  axeLabels:  {hab:'🎉 Habitants & Vie locale',com:'📢 Communication',soc:'🤝 Social & Solidarité',rh:'🏛 Admin & RH'},
  axeClasses: {hab:'cat-soc',com:'cat-com',soc:'cat-hab',rh:'cat-rh'},
  axeOptions: [['hab','Habitants & Vie locale'], ['rh','Admin & RH'], ['com','Communication'], ['soc','Social & Solidarité']],

  /* ── Étiquettes des tâches du quotidien ── */
  taskTags: { default: 'tt-com', icons: {tt_com:'📢', tt_eve:'🎉', tt_adm:'🏛'} },

  /* ── Amorces de sous-commissions (ids stables, noms renommables) ── */
  subcomDefaults: {
  hab:{id:'hab',nom:'Habitants & Vie locale',commissions:['adm'],membres:[],devis:[],decisions:[]},
  com:{id:'com',nom:'Communication',commissions:['adm'],membres:[],devis:[],decisions:[]},
  soc:{id:'soc',nom:'Social & Solidarité',commissions:['adm'],membres:[],devis:[],decisions:[]},
  rh:{id:'rh',nom:'Admin & RH',commissions:['adm'],membres:[],devis:[],decisions:[]},
},

  /* ── Projets d'amorçage, utilisés seulement si la branche Firebase est vide ── */
  defaultProjects: [
  {id:'a1',horizon:'court',axe:'hab',title:"Cafés du Maire",pilote:'',desc:"Organisation des premières rencontres mensuelles maire/élus/habitants. Lieu, format, communication, fréquence.",members:["Catherine","Daniel","Anthony"],budget:'0 €',subs:'—',status:'s-cours',source:'Programme officiel'},
  {id:'a2',horizon:'court',axe:'hab',title:"Fête des vendanges",pilote:'',desc:"Organisation de la fête des vendanges. Partenariats vignobles locaux, animation, logistique, communication.",members:["Catherine","Sophie","Claire"],budget:'500–2 000 €',subs:'CDC, Département',status:'s-lancer',source:'Programme officiel'},
  {id:'a3',horizon:'court',axe:'hab',title:"Trail de la colline",pilote:'',desc:"Événement sportif sur les hauteurs de Lestiac. Format, parcours, partenaires, inscription, sécurité.",members:["Catherine","Anthony","Claire"],budget:'300–800 €',subs:'Région (sport)',status:'s-lancer',source:'Programme officiel'},
  {id:'a4',horizon:'court',axe:'com',title:"Réactivation Facebook & IntraMuros",pilote:'',desc:"Relancer la page Facebook de la commune et le compte IntraMuros. Charte éditoriale, calendrier de publication, formations.",members:["Sophie","Daniel","Catherine"],budget:'0 €',subs:'—',status:'s-lancer',source:'Programme officiel'},
  {id:'a5',horizon:'court',axe:'soc',title:"Réseau solidaire entre voisins",pilote:'',desc:"Développer un réseau de vigilance et d'entraide entre Lestiacais pour prévenir les incivilités et incidents.",members:["Catherine","Claire","Daniel"],budget:'0 €',subs:'—',status:'s-lancer',source:'Programme officiel'},
  {id:'a6',horizon:'court',axe:'soc',title:"Octobre Rose — Lestiac solidaire",pilote:'',desc:"Organiser un événement de sensibilisation au cancer du sein. Collecte, animation, partenariats associations.",members:["Claire","Sophie"],budget:'100–300 €',subs:'Département (santé)',status:'s-lancer',source:'Programme officiel'},
  {id:'a7',horizon:'moyen',axe:'hab',title:"Festival sur Garonne",pilote:'',desc:"Festival culturel au bord du fleuve. Nature, convivialité, traditions. Artistes locaux, scène, buvette, partenaires.",members:["Catherine","Anthony","Sophie","Claire","Lalie"],budget:'2 000–5 000 €',subs:'DRAC, Région, CDC',status:'s-lancer',source:'Programme officiel'},
  {id:'a8',horizon:'moyen',axe:'com',title:"Refonte du bulletin municipal",pilote:'',desc:"Moderniser le bulletin municipal : format, fréquence, contenu digital, distribution.",members:["Sophie","Catherine","Claire"],budget:'500–1 500 €/an',subs:'—',status:'s-lancer',source:'Mandat'},
  {id:'a9',horizon:'moyen',axe:'soc',title:"Maintien lien personnes fragiles",pilote:'',desc:"Dispositif de visite et contact régulier avec les aînés isolés, notamment en période de canicule ou intempéries.",members:["Claire","Daniel","Catherine","Anthony"],budget:'0 €',subs:'CAF, Département',status:'s-lancer',source:'Programme officiel'},
  {id:'a10',horizon:'long',axe:'rh',title:"Procédures RH du conseil municipal",pilote:'',desc:"Formaliser les procédures de remplacement, délégations, absences et renouvellement de postes au sein du CM.",members:["Catherine","Roger","Daniel"],budget:'0 €',subs:'CDG 33',status:'s-lancer',source:'Mandat'},
]
};
