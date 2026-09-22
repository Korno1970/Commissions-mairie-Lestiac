/* ══════════════════════════════════════════════════════════════
   AGORA — configuration de la commission AFFAIRES SCOLAIRES.
   Chargé AVANT agora-core.js. C'est le seul fichier à dupliquer et
   adapter pour une autre commission : le tronc commun ne bouge pas.
   ══════════════════════════════════════════════════════════════ */
window.AGORA_CONFIG = {

  /* ── Identité ── */
  branch:    'scolaire',
  code:      'sco',
  label:     'Affaires Scolaires',
  slug:      'Affaires-Scolaires',
  logPrefix: 'AS',
  startUrl:  'https://commissions-lestiac.fr/affaires-scolaires.html',
  iconSvg:   'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20100%20100%22%3E%3Crect%20width%3D%22100%22%20height%3D%22100%22%20rx%3D%2220%22%20fill%3D%22%235B2F8C%22%2F%3E%3Ctext%20y%3D%22.9em%22%20font-size%3D%2280%22%20x%3D%2210%22%3E%F0%9F%8F%AB%3C%2Ftext%3E%3C%2Fsvg%3E',

  /* ── Page ouverte au démarrage et après déconnexion (doit correspondre au HTML) ── */
  homePage:  'chat',

  /* ── Clés localStorage, préfixées par commission ── */
  keys: {
    pwd:     'as_pwd',
    local:   'as_local_v1',
    ejs:     'as_emailjs',
    visited: 'as_visited',
    subcom:  'sco_subcoms',
    drive:   'lestiac_drive_scolaire'
  },

  /* ── Dossier Drive de la commission ── */
  driveUrl: 'https://drive.google.com/drive/u/0/folders/1lDN-UMwFqsMlyirWKXE-5NjDjCKzvi2m',

  /* ── Axes ── */
  axeLabels:  {sielp:'🏫 SIELP & Scolarité',peri:'🕐 Périscolaire & Cantine',bati:'🏗 Bâti scolaire'},
  axeClasses: {sielp:'cat-rh',peri:'cat-com',bati:'cat-soc'},
  axeOptions: [['sielp','SIELP & Scolarité'], ['peri','Périscolaire & Cantine'], ['bati','Bâti scolaire']],

  /* ── Étiquettes des tâches du quotidien ── */
  taskTags: { default: 'tt-sielp', icons: {tt_sielp:'🏫', tt_peri:'🕐', tt_bati:'🏗'} },

  /* ── Amorces de sous-commissions (ids stables, noms renommables) ── */
  subcomDefaults: {
  sielp:{id:'sielp',nom:'SIELP & Scolarité',commissions:['sco'],membres:[],devis:[],decisions:[]},
  peri:{id:'peri',nom:'Périscolaire & Cantine',commissions:['sco'],membres:[],devis:[],decisions:[]},
  bati:{id:'bati',nom:'Bâti scolaire',commissions:['sco'],membres:[],devis:[],decisions:[]},
},

  /* ── Projets d'amorçage, utilisés seulement si la branche Firebase est vide ── */
  defaultProjects: [
  {id:'s1',horizon:'court',axe:'sielp',title:"Représentation Lestiac au SIELP",pilote:'',desc:"Participer aux réunions mensuelles du SIELP. Représenter les intérêts de Lestiac sur les questions d'organisation scolaire intercommunale.",members:["Michel","Corinne","Lalie"],budget:'0 €',subs:'—',status:'s-cours',source:'Mandat'},
  {id:'s2',horizon:'court',axe:'bati',title:"Végétalisation cour de l'école",pilote:'',desc:"Espaces plus frais et agréables pour les enfants. Plantation, ombrage, jardin pédagogique. Implique enfants, parents et enseignants.",members:["Corinne","Lalie","Michel","Claire"],budget:'300–600 €',subs:'CAF, Région',status:'s-lancer',source:'Programme officiel'},
  {id:'s3',horizon:'court',axe:'bati',title:"Rénovation bâtiments scolaires",pilote:'',desc:"Rénover pour un environnement plus sain et écoresponsable. Diagnostic, priorisation, financement.",members:["Corinne"],budget:'À chiffrer',subs:'DETR, DSIL',status:'s-lancer',source:'Programme officiel'},
  {id:'s4',horizon:'court',axe:'peri',title:"Maintien accueil périscolaire",pilote:'',desc:"Préserver le service périscolaire malgré la suppression d'une classe. Négociation SIELP, organisation, budget.",members:["Corinne","Rose","Michel"],budget:'Budget communal',subs:'CAF',status:'s-lancer',source:'Programme officiel'},
  {id:'s5',horizon:'court',axe:'peri',title:"Circuit court à la cantine",pilote:'',desc:"Poursuivre et renforcer l'engagement pour des produits locaux et de saison dans les repas scolaires. Partenariats avec producteurs locaux.",members:["Corinne","Michel","Anthony"],budget:'0 € (organisation)',subs:'—',status:'s-lancer',source:'Programme officiel'},
  {id:'s6',horizon:'moyen',axe:'peri',title:"Amélioration qualité restauration scolaire",pilote:'',desc:"Révision des menus, formation des agents, amélioration du cadre de la cantine. Enquête satisfaction familles.",members:["Corinne","Rose","Michel","Anthony"],budget:'500–1 500 €',subs:'CAF, Département',status:'s-lancer',source:'Mandat'},
  {id:'s7',horizon:'moyen',axe:'sielp',title:"Conseil Municipal des Jeunes (CMJ)",pilote:'',desc:"Créer un Conseil Municipal des Jeunes impliquant les élèves de l'école et les collégiens. Dispositif Argent de poche.",members:["Corinne","Lalie"],budget:'500–1 000 €',subs:'CAF, Région',status:'s-lancer',source:'Programme officiel'},
  {id:'s8',horizon:'long',axe:'bati',title:"Rénovation énergétique école",pilote:'',desc:"Isolation, chauffage performant, éventuellement panneaux photovoltaïques sur le toit de l'école. Études, devis, financements.",members:["Corinne"],budget:'À chiffrer',subs:'Fonds Vert, DETR, DSIL',status:'s-lancer',source:'Mandat'},
]
};
