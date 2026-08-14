# TODO

## 🔴 En cours

## 🟡 À faire

## 🟢 Idées / backlog

## 🤖 Claude — recommandations
- [ ] CHORE: faire échouer la CI si l'image `runtime` tourne en root (`docker run --rm <image> id -u`) — le test ne lit que le texte du Dockerfile, il ne sait pas ce que l'image fait vraiment
- [ ] FEAT: publier l'image sur GHCR une fois le build CI vert — `cd-docker.yml` existe déjà et attend juste `push: true` avec les droits `packages: write`

## ✅ Fait
- [x] 2026-08-14 — REFACTOR: scinder `docker.test.ts` en `compose.test.ts` et `dockerfile.test.ts`
- [x] 2026-08-14 — CHORE: builder l'image en CI (`docker build --target runtime`)
- [x] 2026-08-14 — DOCS: expliquer dans le `Dockerfile` pourquoi l'étape `dev` reste root
- [x] 2026-08-14 — CHORE: figer le nom du fichier compose dans un seul endroit
- [x] 2026-08-14 — TEST: étendre `docker.test.ts` au `Dockerfile` (l'étape `runtime` doit garder `USER bun`)
- [x] 2026-08-13 — TEST: couvrir `docker-compose.yaml` par un test qui asserte que le port publié reste sur `127.0.0.1`
- [x] 2026-08-13 — FIX: j'ai renommé `compose.yaml` par `docker-compose.yaml`
- [x] 2026-08-12 — FEAT: ajoute docker et docker compose pour lancer l'application, je souhaiterais une instance amélioré en DX
