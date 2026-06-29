# Runbook — CI/CD Backend `cicd-tasklist-backend`

> Document opérationnel décrivant comment exploiter, déclencher et dépanner la
> chaîne d'intégration et de déploiement continu du backend Tasklist.
> Public visé : toute personne devant faire tourner ou réparer la pipeline sans
> en être l'auteur.

| | |
| --- | --- |
| **Application** | `cicd-tasklist-backend` (API REST de gestion de tâches) |
| **Stack** | Node.js / TypeScript, Express, Prisma |
| **Base de données** | MySQL (production), SQLite (tests E2E) |
| **Tests** | Vitest (unitaires + E2E) |
| **CI/CD** | Jenkins (pipeline déclarative, `Jenkinsfile` versionné) |
| **Qualité** | SonarQube + Quality Gate |
| **Sécurité** | Trivy (scan image + SBOM) |
| **Registre d'images** | Docker Hub (`vivienparsis/tasklist-backend`) |
| **Dépôt** | `https://github.com/Vivien-Parsis/cicd-tasklist-backend` (branche `main`) |

---

## 1. Architecture de la chaîne

```none
GitHub (main)
   │  (poll SCM toutes les ~2 min)
   ▼
Jenkins (conteneur Docker, image custom)
   │  build → tests → Sonar → Trivy → push
   ├──► SonarQube  (analyse qualité + Quality Gate)
   ├──► Trivy      (scan vulnérabilités + SBOM)
   └──► Docker Hub (publication de l'image taguée)
```

Jenkins s'exécute **dans un conteneur Docker** à partir d'une image personnalisée
contenant les outils nécessaires (Node, Docker CLI, Trivy, sonar-scanner). Il pilote
le démon Docker de l'hôte via le **socket monté** (`/var/run/docker.sock`).

---

## 2. Prérequis et accès

### Outils sur la machine hôte

- Docker en fonctionnement.
- Accès réseau sortant vers : GitHub, Docker Hub, npm registry, le serveur SonarQube, la base de vulnérabilités Trivy.

### Accès et comptes

- Compte **Jenkins** administrateur (`vivienparsis`).
- Compte **Docker Hub** avec droits de push sur `vivienparsis/tasklist-backend`.
- Accès **SonarQube** : `https://sonarqube.cicd.kits.ext.educentre.fr`, projet `Vivien-PARSIS-Tasklist-Backend`.

### Credentials Jenkins requis

(Manage Jenkins → Credentials)

| ID | Type | Usage |
| --- | --- | --- |
| `vivien-dockerhub-password` | Username with password | `docker login` + push de l'image |
| *(token Sonar)* | Secret text | Rattaché au serveur SonarQube dans Manage Jenkins → System |

> Le token Docker Hub doit être un **access token** (hub.docker.com → Account Settings
> → Personal access tokens), pas le mot de passe du compte, surtout si la 2FA est active.

---

## 3. Procédures de routine

### 3.1 Démarrer Jenkins

```bash
docker run -d --name jenkins -p 8080:8080 -p 50000:50000 -v jenkins_home:/var/jenkins_home -v /var/run/docker.sock:/var/run/docker.sock --group-add <GID_DOCKER> jenkins-cicd
```

- `<GID_DOCKER>` : GID du groupe propriétaire du socket Docker. Sous Docker Desktop, souvent `0`.
- Récupérer le GID exact :

```bash
  docker exec -u 0 jenkins stat -c '%g' /var/run/docker.sock
```

- Interface : `http://localhost:8080`.

### 3.2 Arrêter / redémarrer Jenkins

```bash
docker stop jenkins
docker start jenkins          # redémarrage simple
# ou recréation complète :
docker stop jenkins && docker rm jenkins   # le volume jenkins_home est conservé
```

> Le volume `jenkins_home` contient TOUTE la configuration (jobs, credentials,
> plugins, installations d'outils). Ne jamais le supprimer sans sauvegarde.

### 3.3 Reconstruire l'image Jenkins (après modif des outils)

```bash
docker build --no-cache --build-arg DOCKER_GID=<GID_DOCKER> -t jenkins-cicd -f jenkins.Dockerfile .
docker stop jenkins && docker rm jenkins
# puis relancer (cf. 3.1)
```

L'image embarque : Node 22, Docker CLI, Trivy, sonar-scanner.

### 3.4 Déclencher un build

- **Automatique** : tout commit poussé sur `main` déclenche un build dans les ~2 minutes
  (trigger `pollSCM('H/2 * * * *')`).
- **Manuel** : interface Jenkins → job `tasklist-backend` → **Build Now**.

> Le webhook GitHub n'est pas utilisable car Jenkins tourne en `localhost`
> (non joignable depuis Internet). D'où le polling.

### 3.5 Consulter les résultats

| Élément | Emplacement |
| --- | --- |
| Logs de build | Job → build #N → **Console Output** |
| Résultats des tests | Job → build #N → **Test Result** |
| Rapports Trivy + SBOM | Job → build #N → **Artifacts** (`security/`) |
| Analyse qualité | Dashboard SonarQube du projet |
| Image publiée | Docker Hub → `vivienparsis/tasklist-backend:<numéro de build>` |

---

## 4. Référence de la pipeline (`Jenkinsfile`)

| # | Stage | Rôle |
| --- | --- | --- |
| 1 | Install dependencies | `npm ci` |
| 2 | Prisma generate | génère le client Prisma (prod, MySQL) |
| 3 | Unit tests | Vitest unitaires + couverture lcov |
| 4 | *(post)* | publication des rapports de tests JUnit |
| 5 | E2E tests | Vitest E2E (SQLite, géré par `setup.js`) |
| 6 | SonarQube analysis + Quality Gate | analyse + blocage si gate rouge |
| 7 | Build Docker image | image taguée `:<BUILD_NUMBER>` et `:latest` |
| 8 | Trivy scan (reports) | rapports JSON + table (non bloquant) |
| 9 | Generate SBOM | SBOM CycloneDX |
| 10 | Vulnerability gate (Trivy) | **bloque** sur HIGH/CRITICAL |
| 11 | Push Docker image | `docker login` + push vers Docker Hub |
| 12 | *(post always)* | archivage rapports/SBOM + `cleanWs()` |

### Contraintes encodées

- Aucun secret en clair : tout passe par les credentials Jenkins.
- Image taguée avec le numéro de build (`$BUILD_NUMBER`).
- Quality Gate Sonar bloquante (`sonar.qualitygate.wait=true`).
- Scan Trivy bloquant sur HIGH/CRITICAL (`--exit-code 1 --severity HIGH,CRITICAL`).
- Rapports de tests, rapports Trivy et SBOM publiés/archivés dans Jenkins.

---

## 5. Configuration des composants

### 5.1 SonarQube

- Analyse via le plugin (`withSonarQubeEnv('SonarQube')`) : URL et token rattachés
  au serveur Sonar dans **Manage Jenkins → System → SonarQube servers**.
- Scanner installé via **Manage Jenkins → Tools → SonarQube Scanner installations** (`SonarScanner`), appelé par `${SCANNER_HOME}/bin/sonar-scanner`.
- Quality Gate : `-Dsonar.qualitygate.wait=true` (le scanner attend le verdict ;
  **pas** de webhook requis, contrairement à `waitForQualityGate`).
- `sonar-project.properties` contient `sonar.projectKey`, `sonar.sources`, `sonar.tests`,
  `sonar.javascript.lcov.reportPaths=coverage/lcov.info`. **Ne pas** y mettre `sonar.host.url`
  ni `sonar.token` (fournis par le plugin).

### 5.2 Trivy

- Génération des rapports en `--exit-code 0` (jamais bloquant) → archivés.
- Étape de gate séparée en `--exit-code 1 --severity HIGH,CRITICAL` → bloque la pipeline.
- SBOM au format CycloneDX.
- Ordre voulu : rapports + SBOM **avant** le gate, pour qu'ils soient archivés même en cas d'échec.

### 5.3 Prisma / tests

- Schéma prod : `prisma/schema.prisma` (MySQL, `DATABASE_URL`).
- Schéma test : `prisma/schema-test.prisma` (SQLite, client séparé `.prisma/client-test`).
- Le `setup.js` des E2E génère le client de test et réinitialise la base SQLite
  (`prisma db push --force-reset`) au chargement — rien à préparer côté pipeline.

### 5.4 Dockerfile applicatif

- Build **multi-stage** : étage build (deps complètes + `prisma generate` + `npm run build`),
  étage runtime (`npm ci --omit=dev`).
- L'image runtime tourne en utilisateur non-root (`USER node`).
- Copier le client Prisma généré vers le runtime (`COPY --from=build /app/node_modules/.prisma`).

---

## 6. Incidents connus et remèdes

| Symptôme dans les logs | Cause | Remède |
| --- | --- | --- |
| `npm: not found` | Node absent de l'agent | Plugin NodeJS + `tools { nodejs 'Node22' }`, ou Node dans l'image Jenkins |
| `sonar-scanner: not found` | Scanner absent du PATH | Déclarer l'install dans Tools, appeler `${SCANNER_HOME}/bin/sonar-scanner` |
| `docker: not found` | Docker CLI absent de l'image Jenkins | Reconstruire l'image Jenkins (cf. 3.3) |
| `permission denied ... /var/run/docker.sock` | Mauvais GID du groupe docker | Relancer avec `--group-add <GID>` (cf. 3.1) |
| `You must define ... sonar.projectKey` | Clé absente | Ajouter `sonar.projectKey` dans `sonar-project.properties` |
| Couverture à 0 % côté Sonar | lcov non importé / chemin faux | Vérifier `coverage/lcov.info` généré + `sonar.javascript.lcov.reportPaths` |
| Quality Gate `IN_PROGRESS` puis timeout | Pas de webhook (localhost) | Utiliser `-Dsonar.qualitygate.wait=true` au lieu de `waitForQualityGate` |
| Trivy bloque sur HIGH/CRITICAL | Vulnérabilité réelle ou lock périmé | Mettre à jour la dépendance / `overrides`, rebuild `--no-cache --pull` |
| `picomatch ... 4.0.3` alors que local OK | Lock périmé dans l'image, ou étage build scanné | Commit/push le lock à jour, rebuild `--no-cache`, vérifier qu'on scanne l'étage runtime |
| `archiveArtifacts ... hudson.FilePath is missing` | `post` exécuté hors `node` | Échec en amont avant l'entrée dans le `node` ; corriger la cause racine |

### Diagnostic Trivy / picomatch (commande utile)

Inspecter directement l'image scannée :
```bash
docker run --rm vivienparsis/tasklist-backend:<build> sh -c 'cat node_modules/picomatch/package.json 2>/dev/null | grep version'
```
- Affiche `4.0.3` → paquet réellement installé (mauvais étage scanné ou cache Docker).
- N'affiche rien → c'est le `package-lock.json` qui est périmé.

---

## 7. Sauvegarde et restauration

### Ce qui doit être sauvegardé

- **`jenkins_home`** (volume Docker) : jobs, credentials, plugins, config.
- Le `Jenkinsfile`, le `jenkins.Dockerfile`, le `Dockerfile` applicatif et
  `sonar-project.properties` : **versionnés dans Git** (source de vérité).

### Sauvegarder le volume Jenkins

```bash
docker run --rm -v jenkins_home:/data -v "$PWD":/backup alpine tar czf /backup/jenkins_home_backup.tgz -C /data .
```

### Restaurer

```bash
docker volume create jenkins_home
docker run --rm -v jenkins_home:/data -v "$PWD":/backup alpine tar xzf /backup/jenkins_home_backup.tgz -C /data
```

### Reconstruire entièrement depuis zéro

1. Reconstruire l'image Jenkins (cf. 3.3).
2. Démarrer le conteneur (cf. 3.1).
3. Recréer les credentials (cf. 2) et le serveur SonarQube.
4. Recréer le job `Pipeline script from SCM` pointant sur le dépôt Git.
5. Lancer un build manuel pour activer le trigger `pollSCM`.

---

## 8. Sécurité — points de vigilance

- Le montage de `/var/run/docker.sock` donne à Jenkins un contrôle total sur Docker
  (équivalent root sur l'hôte). Acceptable en environnement local d'apprentissage ;
  en production on isolerait (agents dédiés, Kaniko, etc.).
- Les secrets (Docker Hub, token Sonar) ne figurent **jamais** dans le code ni dans Git :
  uniquement dans Jenkins Credentials.
- L'image applicative tourne en utilisateur non-root et n'embarque pas les
  dépendances de développement (`--omit=dev`).

---

## 9. Contacts et escalade

| Rôle | Contact |
| --- | --- |
| Responsable du projet | *(à compléter)* |
| Administrateur SonarQube (école) | *(à compléter)* |
| Administrateur plateforme CI/CD | *(à compléter)* |

---

*Dernière mise à jour : à maintenir à chaque évolution de la pipeline.*
