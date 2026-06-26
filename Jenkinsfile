// Jenkinsfile — pipeline CI/CD pour tasklist-backend
// Récupéré depuis le dépôt Git (Pipeline script from SCM).
//
// Prérequis Jenkins (à configurer une fois) :
//   - Outils sur l'agent : node/npm, docker, trivy, sonar-scanner (ou via tools{}).
//   - Manage Jenkins > System > SonarQube servers : un serveur nommé 'SonarQube'
//     avec l'URL https://sonarqube.cicd.kits.ext.educentre.fr et le token (Secret text).
//   - Un webhook SonarQube -> <jenkins>/sonarqube-webhook/  (slash final obligatoire),
//     sinon waitForQualityGate reste bloqué. Alternative sans webhook : voir la note
//     en bas de fichier (sonar.qualitygate.wait=true).
//   - Credentials : 'vivien-dockerhub-password' (Username with password).

pipeline {
  agent any
  tools {
    nodejs 'node24'
  }
  options {
    timestamps()
    timeout(time: 30, unit: 'MINUTES')
    disableConcurrentBuilds()
  }

  environment {
    IMAGE_NAME = 'tasklist-backend'

    DOCKERHUB  = credentials('vivienparsis-dockerhub-password')

    SONAR_PROJECT_KEY = 'tasklist-backend'

    DATABASE_URL = 'mysql://user:pass@localhost:3306/tasklist'
  }

  stages {

    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    // 1. Installation des dépendances
    stage('Install dependencies') {
      steps {
        sh 'npm ci'
      }
    }

    // 2. Génération du client Prisma
    stage('Prisma generate') {
      steps {
        sh 'npx prisma generate'
      }
    }

    // 3. Tests unitaires (+ couverture lcov pour Sonar)
    stage('Unit tests') {
      steps {
        sh '''
          npx vitest run src/__tests__/unit \
            --reporter=junit --outputFile=reports/unit.xml \
            --coverage --coverage.reporter=lcov --coverage.reporter=text
        '''
      }
      post {
        // 4. Publication des rapports de tests dans Jenkins
        always {
          junit testResults: 'reports/unit.xml', allowEmptyResults: true
        }
      }
    }

    // 5. Tests end-to-end
    stage('E2E tests') {
      steps {
        sh '''
          npx vitest run src/__tests__/e2e \
            --reporter=junit --outputFile=reports/e2e.xml
        '''
      }
      post {
        always {
          junit testResults: 'reports/e2e.xml', allowEmptyResults: true
          sh 'rm -f prisma/test.db || true'
        }
      }
    }

    // 6. Analyse SonarQube
    stage('SonarQube analysis') {
      steps {
        withSonarQubeEnv('SonarQube') {
          sh "sonar-scanner -Dsonar.projectVersion=${BUILD_NUMBER}"
        }
      }
    }

    // 7. Vérification de la Quality Gate (peut bloquer la pipeline)
    stage('Quality Gate') {
      steps {
        timeout(time: 5, unit: 'MINUTES') {
          waitForQualityGate abortPipeline: true
        }
      }
    }

    // 8. Construction de l'image Docker (taguée avec le numéro de build)
    stage('Build Docker image') {
      steps {
        sh '''
          docker build \
            -t $DOCKERHUB_USR/$IMAGE_NAME:$BUILD_NUMBER \
            -t $DOCKERHUB_USR/$IMAGE_NAME:latest \
            .
        '''
      }
    }

    // 9 + 10. Scan de sécurité Trivy + génération des rapports (non bloquant ici)
    stage('Trivy scan (reports)') {
      steps {
        sh '''
          mkdir -p security
          trivy image --no-progress --exit-code 0 \
            --format json   --output security/trivy-report.json \
            $DOCKERHUB_USR/$IMAGE_NAME:$BUILD_NUMBER
          trivy image --no-progress --exit-code 0 \
            --format table  --output security/trivy-report.txt \
            $DOCKERHUB_USR/$IMAGE_NAME:$BUILD_NUMBER
        '''
      }
    }

    // 11. Génération d'une SBOM (CycloneDX)
    stage('Generate SBOM') {
      steps {
        sh '''
          mkdir -p security
          trivy image --no-progress \
            --format cyclonedx --output security/sbom-cyclonedx.json \
            $DOCKERHUB_USR/$IMAGE_NAME:$BUILD_NUMBER
        '''
      }
    }

    stage('Vulnerability gate (Trivy)') {
      steps {
        sh '''
          trivy image --no-progress --exit-code 1 \
            --severity HIGH,CRITICAL \
            $DOCKERHUB_USR/$IMAGE_NAME:$BUILD_NUMBER
        '''
      }
    }

    // 12. Publication de l'image sur Docker Hub
    stage('Push Docker image') {
      steps {
        sh '''
          echo "$DOCKERHUB_PSW" | docker login -u "$DOCKERHUB_USR" --password-stdin
          docker push $DOCKERHUB_USR/$IMAGE_NAME:$BUILD_NUMBER
          docker push $DOCKERHUB_USR/$IMAGE_NAME:latest
          docker logout
        '''
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: 'security/*', allowEmptyArchive: true, fingerprint: true
      // 13. Nettoyage du workspace Jenkins en fin de pipeline
      cleanWs()
    }
  }
}