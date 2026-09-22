/* ══════════════════════════════════════════════════════════════
   AGORA — configuration de la commission CADRE DE VIE.
   Chargé AVANT agora-core.js. C'est le seul fichier à dupliquer et
   adapter pour une autre commission : le tronc commun ne bouge pas.
   ══════════════════════════════════════════════════════════════ */
window.AGORA_CONFIG = {

  /* ── Identité ── */
  branch:    'cdv',            // branche Firebase (cdv / scolaire / admin)
  code:      'cdv',            // code interne sous-commissions (cdv / sco / adm)
  label:     'Cadre de Vie',
  slug:      'Cadre-de-Vie',   // noms de fichiers exportés
  logPrefix: 'CDV',
  startUrl:  'https://commissions-lestiac.fr/cadre-de-vie.html',
  iconSvg:   'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20100%20100%22%3E%3Crect%20width%3D%22100%22%20height%3D%22100%22%20rx%3D%2220%22%20fill%3D%22%231A5C6B%22%2F%3E%3Ctext%20y%3D%22.9em%22%20font-size%3D%2280%22%20x%3D%2210%22%3E%F0%9F%8C%BF%3C%2Ftext%3E%3C%2Fsvg%3E',

  /* ── Clés localStorage, préfixées par commission ── */
  keys: {
    pwd:     'cdv_pwd',
    local:   'cdv_local_v1',
    ejs:     'cdv_emailjs',
    visited: 'cdv_visited',
    subcom:  'cdv_subcoms',
    drive:   'lestiac_drive_cdv'
  },

  /* ── Dossier Drive de la commission ── */
  driveUrl: 'https://drive.google.com/drive/u/0/folders/1lDN-UMwFqsMlyirWKXE-5NjDjCKzvi2m',

  /* ── Axes ── */
  axeLabels:  {env:'🌿 Environnement', vie:'🎭 Vie du village', gouv:'🗳 Gouvernance'},
  axeClasses: {env:'cat-hab', vie:'cat-com', gouv:'cat-rh'},

  /* ── Amorces de sous-commissions (ids stables, noms renommables) ── */
  subcomDefaults: {
  vie:{id:'vie', nom:'Vie du village', commissions:['cdv'], membres:[], devis:[], decisions:[]},
  env:{id:'env', nom:'Environnement', commissions:['cdv'], membres:[], devis:[], decisions:[]},
  gouv:{id:'gouv',nom:'Gouvernance', commissions:['cdv'], membres:[], devis:[], decisions:[]},
},

  /* ── Projets d'amorçage, utilisés seulement si la branche Firebase est vide ── */
  defaultProjects: [
  {id:'p1',horizon:'court',axe:'env',title:'Transition éclairage 100% LED',pilote:'Vivien',desc:'Remplacement des points lumineux (éclairage public + bâtiments communaux). Sobriété énergétique.',members:['Vivien','Roger'],budget:'À chiffrer',subs:'Fonds Vert, DETR',status:'s-lancer',source:'Programme officiel'},
  {id:'p2',horizon:'court',axe:'env',title:'Sécurité route de Bordeaux (D10)',pilote:'Sylvain',desc:'Amélioration de la D10 avec les services du Département. Concertation citoyenne sur les aménagements.',members:['Sylvain','Roger','Vivien'],budget:'À définir',subs:'Département 33',status:'s-lancer',source:'Programme officiel'},
  {id:'p3',horizon:'court',axe:'env',title:'Repenser le stationnement',pilote:'Sylvain',desc:'Étudier la création de zones pour désengorger certains quartiers. Cartographie, diagnostic.',members:['Sylvain','Lalie'],budget:'0 €',subs:'—',status:'s-lancer',source:'Programme officiel'},
  {id:'p4',horizon:'court',axe:'vie',title:'Marché local place Victor Hugo',pilote:'Anthony',desc:'Marché de producteurs locaux place Victor Hugo. Format, fréquence et organisation à définir.',members:['Anthony','Claire','Vivien'],budget:'200–500 €',subs:'CDC, Département, Leader',status:'s-lancer',source:'Programme officiel'},
  {id:'p5',horizon:'court',axe:'vie',title:'Soutien aux associations',pilote:'Anthony',desc:'Actualiser les subventions communales et co-construire un calendrier partagé des événements.',members:['Anthony','Claire'],budget:'Budget communal',subs:'—',status:'s-lancer',source:'Programme officiel'},
  {id:'p6',horizon:'court',axe:'gouv',title:'Concertation citoyenne — Nom esplanade',pilote:'Sylvain',desc:'Première concertation : choix du nom de l\'esplanade école/salle des fêtes.',members:['Sylvain','Anthony'],budget:'0 €',subs:'—',status:'s-lancer',source:'Programme officiel'},
  {id:'p7',horizon:'moyen',axe:'env',title:'Table d\'orientation des hauteurs',pilote:'Vivien',desc:'Aménager les hauteurs du village pour valoriser le site et le patrimoine naturel.',members:['Sylvain','Vivien'],budget:'5 000–15 000 €',subs:'Département, Leader',status:'s-lancer',source:'Programme officiel'},
  {id:'p8',horizon:'moyen',axe:'vie',title:'Festival sur Garonne',pilote:'Anthony',desc:'Festival au bord du fleuve : nature, convivialité, traditions. Format et budget à définir.',members:['Anthony','Claire'],budget:'À définir',subs:'DRAC, Département, Région',status:'s-lancer',source:'Programme officiel'},
  {id:'p9',horizon:'moyen',axe:'vie',title:'Valorisation patrimoine bâti',pilote:'Anthony',desc:'Préserver et valoriser l\'église, le lavoir, le bâti ancien via du mécénat.',members:['Anthony','Claire'],budget:'Mécénat',subs:'DRAC, Fondation du Patrimoine',status:'s-lancer',source:'Programme officiel'},
  {id:'p10',horizon:'moyen',axe:'vie',title:'Ateliers intergénérationnels',pilote:'Anthony',desc:'Ateliers réguliers (lecture, jeux, échanges, numérique) pour renforcer les liens entre générations.',members:['Anthony','Corinne','Lalie'],budget:'100–300 €/an',subs:'CAF, Département',status:'s-lancer',source:'Programme officiel'},
  {id:'p11',horizon:'moyen',axe:'gouv',title:'Conseil Municipal des Jeunes',pilote:'Sylvain',desc:'Créer un CMJ et le dispositif « Argent de poche » pour la participation citoyenne des jeunes.',members:['Sylvain','Anthony'],budget:'500–1 000 €',subs:'CAF, Région, FDVA',status:'s-lancer',source:'Programme officiel'},
  {id:'p12',horizon:'long',axe:'env',title:'Accessibilité PMR voiries & bâtiments',pilote:'Roger',desc:'Audit et plan de mise en conformité PMR pour les bâtiments communaux et voiries.',members:['Sylvain','Roger','Vivien'],budget:'À évaluer',subs:'DETR, DSIL',status:'s-lancer',source:'Mandat'},
  {id:'p13',horizon:'long',axe:'env',title:'Mobilités douces — plan vélo',pilote:'Vivien',desc:'Itinéraires cyclables sécurisés, stationnements vélos. Lien avec projets intercommunaux.',members:['Vivien','Lalie'],budget:'À chiffrer',subs:'Région, DSIL, CDC',status:'s-lancer',source:'Mandat'},
]
};
