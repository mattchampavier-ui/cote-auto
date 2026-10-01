# COTE — suivi de cotes de véhicules d'occasion (v4)

Dashboard + robot qui suit la cote de véhicules d'occasion à potentiel de valorisation.
Tu n'as rien à faire à la main : le robot relève LeBonCoin chaque semaine, calcule les scores,
détecte les bonnes affaires et t'envoie **un récap par mail le 1er de chaque mois**.
Pour suivre un nouveau véhicule, un bouton du dashboard ouvre un formulaire : le robot fait le reste.

- Dashboard : https://mattchampavier-ui.github.io/cote-auto/ (une fois GitHub Pages activé, étape 4)
- Ajouter un véhicule : bouton **+ Ajouter un véhicule** du dashboard, ou [ce formulaire](https://github.com/mattchampavier-ui/cote-auto/issues/new?template=ajouter-vehicule.yml)
- Base Excel : [`cote-auto.xlsx`](cote-auto.xlsx), mise à jour à chaque relevé et jointe au récap mensuel

## Ajouter un véhicule

Trois façons, toutes traitées automatiquement par le robot (ajout, premier relevé, réponse) :

1. **Depuis le dashboard** : bouton « + Ajouter un véhicule ». Le plus simple : fais ta recherche
   sur leboncoin.fr avec tes filtres (modèle, années, km, prix), copie l'adresse de la page et
   colle-la dans le champ « URL de recherche LeBonCoin ». Sinon, un nom suffit.
   GitHub s'ouvre avec la demande pré-remplie : il reste à cliquer sur « Create ».
2. **Depuis le radar** du dashboard : bouton « Suivre » sur un candidat.
3. **Directement sur GitHub** : [formulaire d'ajout](https://github.com/mattchampavier-ui/cote-auto/issues/new?template=ajouter-vehicule.yml).

## Véhicules suivis (16)

| Depuis septembre 2026 | Ajoutés en octobre 2026 |
|---|---|
| Peugeot 208 GTi 30th | Peugeot 306 S16 |
| Porsche 911 997 Carrera S | BMW Z3 1.9i / 2.0i |
| Porsche Boxster 986 | Volkswagen Golf IV GTI 25th Anniversary |
| Porsche Boxster 987 | Alfa Romeo 156 2.5 V6 24V |
| Renault Twingo 1 découvrable | Mazda MX-5 NA |
| Peugeot 206 RC | Peugeot 205 GTI |
| Renault Clio II RS (172/182 ch) | Honda S2000 |
| Citroën Saxo VTS 16V | Renault Mégane II RS R26 |

Radar (candidats non suivis, « Suivre » en un clic) : Toyota MR2 Roadster, BMW 330Ci E46,
Fiat Coupé 20V Turbo, Renault Clio Williams.

## Base Excel

`cote-auto.xlsx` est régénérée à chaque relevé à partir de tout l'historique : elle s'alimente
toute seule. Elle est jointe au récap mensuel et téléchargeable depuis le dashboard (« Base Excel »).

| Onglet | Contenu |
|---|---|
| Analyse du mois | Indicateurs clés + une ligne par véhicule : score, signal, médiane, position dans la fourchette, tendances 1/3/12 mois, offre, ventes, bonnes affaires ; graphique des scores |
| Historique mensuel | Une ligne par véhicule et par mois, avec variations vs mois précédent (médiane, cote à km constant, score) |
| Médianes par mois | Tableau croisé véhicule × mois |
| Indice base 100 | Évolution comparée de tous les véhicules (100 = premier mois suivi), avec graphique |
| Relevés | Tous les relevés bruts |
| Annonces | Chaque annonce suivie : en vente / partie, jours en ligne, baisse de prix, lien |
| Bonnes affaires | Annonces nettement sous la cote, avec décote et lien |
| Véhicules | Véhicules suivis ou retirés et leurs critères |

Les colonnes d'analyse sont des formules, recalculées à l'ouverture dans Excel, Google Sheets ou
Numbers (l'aperçu rapide d'un téléphone peut les afficher vides : ouvre le fichier dans une appli
tableur). Le fichier est écrasé à chaque relevé : enregistre une copie si tu veux l'annoter.

## Nouveautés de la v4

**Automatisation**
- **Ajout de véhicule en un formulaire** (depuis le téléphone aussi) : seul le nom est obligatoire.
  Le robot génère l'URL de recherche LeBonCoin, estime catégorie, scores, années de production et
  mots à exclure (via Claude si la clé est configurée), ajoute le véhicule, lance son premier relevé
  et répond sur le formulaire. Plus besoin d'éditer `models.json` ni de chercher une URL.
- **Retrait** de la même façon (lien « Retirer » sur chaque carte) ; l'historique est conservé et
  redemander l'ajout réactive le véhicule.
- **Radar → suivi en un clic** : « Suivre » sur un candidat du radar ouvre le formulaire pré-rempli.
- **Relevé le 1er et le 15 du mois** au lieu d'une fois par mois : c'est ce qui permet de voir
  les ventes et les baisses de prix.
- **Récap mensuel par mail** (Gmail), archivé aussi sur le dashboard. S'il n'a pas pu partir le 1er
  (cron GitHub en retard), il part au passage suivant — jamais deux fois.
- Les bornes plancher / plafond se recalculent seules à partir des prix observés après 3 mois.
- Poids du score et seuils réglables dans `config.json` (plus rien de codé en dur).

**Pertinence**
- **Filtres d'annonces** : pièces détachées, épaves, non roulants, location, autres versions
  (mots exclus par véhicule), années / kilométrages hors plage, doublons, prix aberrants
  (méthode IQR). Le nombre d'annonces écartées et la raison sont gardés dans chaque relevé.
- **Suivi annonce par annonce** : une annonce qui disparaît est comptée comme vendue, avec son
  délai de vente ; les baisses de prix sont repérées.
- **Cote à kilométrage constant** : régression prix/km pour comparer les mois entre eux sans que
  la tendance dépende du kilométrage des annonces du moment.
- **Bonnes affaires** : annonces au moins 15 % sous le prix attendu pour leur kilométrage.
- **Score enrichi** : en plus de rareté / désirabilité / « dernier de » / proximité du plancher,
  le **momentum** (tendance sur 3 mois) et le **marché** (offre + vitesse de vente). Pas de signal
  d'achat sur une cote qui chute.
- Tendances 1 / 3 / 12 mois, fourchette P25-P75 sur les graphiques, alerte « données minces »
  quand il y a trop peu d'annonces pour conclure.

**Corrections**
- L'identifiant d'actor Apify est converti au format attendu par l'API (`user~actor`) : la v3
  envoyait `user/actor`, refusé par l'API.
- Le dashboard reste utilisable si le CDN des graphiques est injoignable.

## Mise en route (~10 minutes, une seule fois)

Dans le dépôt → **Settings → Secrets and variables → Actions** :

1. **Apify** (collecte) — compte sur [apify.com](https://apify.com) et token (Settings → Integrations).
   L'actor utilisé est fixé dans `config.json` (`scrape.actor`, actuellement `memo23/leboncoin-scraper` :
   0,00079 $ par annonce + 0,03 $ par recherche, profils vendeurs désactivés).
   - secret `APIFY_TOKEN` : ton token
   - `APIFY_ACTOR` (variable ou secret, au choix) : l'identifiant de l'actor, ex. `username/leboncoin-scraper`
   - variable `APIFY_INPUT` *(facultative)* : seulement si l'actor attend une entrée différente de
     `{"startUrls":[{"url":"{{url}}"}],"maxItems":{{max}}}`. Copie l'exemple d'entrée de la page de
     l'actor et mets `{{url}}` à la place de l'URL de recherche, `{{max}}` à la place de la limite.
2. **Gmail** (récap) — même principe que pour radar-crypto, tu peux reprendre les mêmes valeurs :
   - secret `GMAIL_USER` : ton adresse Gmail
   - secret `GMAIL_APP_PASSWORD` : un [mot de passe d'application](https://myaccount.google.com/apppasswords)
     (nécessite la validation en 2 étapes)
   - secret `EMAIL_TO` *(facultatif)* : destinataire, par défaut `GMAIL_USER`
3. **Claude** *(facultatif)* — secret `ANTHROPIC_API_KEY` : ajoute un paragraphe d'analyse au récap
   et remplit automatiquement les champs laissés vides à l'ajout d'un véhicule. Sans clé, tout
   fonctionne avec des valeurs neutres.
4. **Settings → Pages** → Source « Deploy from a branch », branche `main`, dossier `/ (root)`.
5. **Actions** → « Relevé + récap mensuel » → **Run workflow** pour un premier relevé tout de suite.
   Coche « Envoyer le récap mensuel maintenant » pour recevoir un premier mail de test.

## Comment ça marche

```
Lundi + 1er du mois (GitHub Actions)
  src/scrape.mjs ──► actor Apify (LeBonCoin) ──► filtres de pertinence
        │                                         ──► suivi annonce par annonce (listings.json)
        │                                         ──► relevé daté (data.json)
        ▼
  src/export.mjs + scripts/build_excel.py ──► cote-auto.xlsx (tout l'historique)
        ▼
  src/recap.mjs ──► 1er passage du mois : mail récap (Gmail) + Excel en pièce jointe + archive recaps/AAAA-MM.html
        ▼
  index.html (GitHub Pages) lit models.json / data.json / config.json

Formulaire « Ajouter un véhicule » (issue GitHub)
  src/vehicles.mjs ──► models.json ──► premier relevé du véhicule ──► réponse sur l'issue
```

Seuls toi et les collaborateurs du dépôt pouvez ajouter ou retirer un véhicule : les formulaires
ouverts par quelqu'un d'autre sont ignorés.

## Le récap mensuel

Envoyé le 1er du mois pour le mois écoulé :
- chiffres clés (véhicules, score moyen, annonces actives, ventes détectées) ;
- l'essentiel : signaux d'achat, changements de signal, plus forte hausse / baisse ;
- analyse rédigée par Claude (si la clé est configurée) ;
- classement avec score et évolution, signal, médiane et tendance 1 mois, cote à km de référence ;
- bonnes affaires avec lien vers l'annonce, baisses de prix ;
- « à vérifier » : véhicules sans annonce, relevés en échec, données trop minces.

Aperçu sans envoi : `npm run recap:preview` → `recaps/AAAA-MM.html`.

## Ajuster

| Quoi | Où |
|---|---|
| Poids du score, seuil de liquidité | `config.json` → `scoring` |
| Seuil « bonne affaire » (0.15 = 15 %), annonces max par véhicule | `config.json` → `scrape` |
| Mots exclus pour tous les véhicules, prix minimum | `config.json` → `filters` |
| Critères d'un véhicule (recherche, mots exclus, scores manuels, bornes) | `models.json` |
| Fréquence des relevés | `.github/workflows/releve.yml` (`cron`) |

Pour forcer une URL de recherche précise sur un véhicule, ajoute-lui `"lbcSearchUrl": "https://..."`.

## En local

```bash
npm install
npm test                                   # tests (aucun appel réseau)
APIFY_TOKEN=... APIFY_ACTOR=... npm run scrape
npm run recap:preview
pip install openpyxl && npm run excel   # régénère cote-auto.xlsx
python3 -m http.server   # puis http://localhost:8000
```

## Limites connues

- **Format de l'actor Apify** : les actors LeBonCoin ne renvoient pas tous les mêmes champs. Le
  robot gère le format brut de l'API LeBonCoin et les formats aplatis courants. Si un véhicule
  remonte « 0 annonce retenue » alors qu'il y en a, regarde le log du workflow : il indique combien
  d'annonces ont été reçues et pourquoi elles ont été écartées.
- **Budget Apify** : 16 véhicules × 40 annonces × 2 relevés ≈ 2 à 3 $ par mois avec
  `clearpath/leboncoin-api` (environ 1,5 $ les 1 000 annonces). Garde-fous dans `config.json` : chaque
  recherche est plafonnée par Apify (`maxChargePerRunUsd`), et les relevés s'arrêtent quand le
  budget du mois (`monthlyBudgetUsd`, 4 $) est atteint. Les options payantes inutiles (profils
  vendeurs, téléphones) sont désactivées automatiquement d'après le schéma de l'actor.
- **Ventes** : une annonce disparue peut aussi avoir été retirée sans vente. Le décompte n'est fait
  que si le relevé n'a pas été tronqué par la limite d'annonces.
- Le signal est une heuristique de repérage, pas un conseil financier.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Dashboard (sans build) |
| `models.json` | Véhicules suivis et leurs critères |
| `data.json` | Historique des relevés + journal des passages du robot |
| `listings.json` | Suivi annonce par annonce (ventes, baisses de prix) |
| `config.json` | Réglages : poids du score, filtres, seuils |
| `cote-auto.xlsx` | Base Excel (générée automatiquement) |
| `recaps/` | Archive des récaps mensuels |
| `src/scrape.mjs` | Relevé des annonces |
| `src/recap.mjs` | Récap mensuel par mail |
| `src/vehicles.mjs` | Ajout / retrait de véhicules |
| `src/export.mjs`, `scripts/build_excel.py` | Génération de la base Excel |
| `src/lib/` | Statistiques, filtres, score (partagé avec le dashboard), Apify, Claude |
| `.github/workflows/` | `releve.yml` (relevés + récap), `vehicules.yml` (formulaires), `tests.yml` |
