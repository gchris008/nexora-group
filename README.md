# NEXORA GROUP

Plateforme web française pour NEXORA GROUP : commerce, import/export, e-commerce, technologie et expansion internationale.

## Architecture

- Frontend public en HTML/CSS/JavaScript.
- Backend Node.js + Express.
- PostgreSQL pour les données.
- Sessions administrateur stockées côté serveur.
- Mot de passe hashé avec scrypt (API crypto native de Node).
- Protection CSRF par token serveur.
- Validation et sanitation côté serveur.
- Rate limiting de connexion.
- Helmet + CSP et en-têtes de sécurité.
- Secrets uniquement via variables d'environnement.

## Développement

1. Installer Node.js 20+ et PostgreSQL.
2. Copier `.env.example` vers `.env`.
3. Configurer `DATABASE_URL`.
4. `npm install`
5. `npm run db:init`
6. `npm run admin:create`
7. `npm start`

Le compte administrateur initial doit être créé hors du site public avec la commande `npm run admin:create`.

## Production

Utiliser HTTPS, une base PostgreSQL gérée, des sauvegardes, des variables d'environnement protégées et un reverse proxy/TLS. Ne jamais placer un mot de passe, une clé API ou une chaîne de connexion réelle dans Git.


## Accès administrateur

- La page publique n'expose aucun lien vers l'administration.
- Connexion privée : `/connexion`.
- Après authentification, redirection vers `/admin`.
- Les sessions et jetons CSRF sont gérés côté serveur.
- Le tableau de bord permet de gérer le contenu, les produits, le mot de passe et, pour le rôle administrateur, le journal d'activité.

## Vérifications

`npm test` vérifie la syntaxe des fichiers JavaScript. La validation de production doit ensuite être effectuée avec PostgreSQL et un environnement HTTPS réel avant toute mise en ligne.