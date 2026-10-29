#!/usr/bin/env bash
# One-time setup: lets GitHub Actions in ahm81/meling.app deploy to Firebase (meling-app)
# using Workload Identity Federation, so no service account keys are stored in GitHub.
#
# Two service accounts with separate trust:
#   github-deployer  full deploy (deploy.yml). Only jobs in the GitHub environment
#                    "production", which only main may deploy to.
#   github-preview   Hosting only (preview.yml). Only jobs in the GitHub environment
#                    "preview", used by the deploy job that runs no project code.
#
# Run as a project owner: ./scripts/setup-github-deploy.sh
# Safe to re-run; existing resources are left as they are.
set -euo pipefail

PROJECT=meling-app
PROJECT_NUMBER=247508425974
REPO=ahm81/meling.app
REPO_ID=$(gh api "repos/$REPO" --jq .id)
POOL=github
PROVIDER=meling-app-repo
POOL_PRINCIPALS="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL"
DEPLOY_SA="github-deployer@$PROJECT.iam.gserviceaccount.com"
PREVIEW_SA="github-preview@$PROJECT.iam.gserviceaccount.com"

ensure_sa() {
  local name=$1 display=$2
  gcloud iam service-accounts describe "$name@$PROJECT.iam.gserviceaccount.com" --project "$PROJECT" >/dev/null 2>&1 ||
    gcloud iam service-accounts create "$name" --project "$PROJECT" --display-name="$display"
}

grant() {
  local sa=$1 role=$2
  echo "  $role"
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$sa" \
    --role="$role" --condition=None --quiet >/dev/null
}

echo "Service account $DEPLOY_SA"
ensure_sa github-deployer "GitHub Actions deploy ($REPO, production)"
# Hosting, rules and indexes (firebase.admin), Cloud Functions 2nd gen (cloudfunctions.admin,
# run.viewer, artifactregistry.admin for the image cleanup policy), and reading the API key
# config during hosting deploys (apiKeysViewer).
for role in roles/firebase.admin roles/cloudfunctions.admin roles/run.viewer \
  roles/artifactregistry.admin roles/serviceusage.apiKeysViewer; do
  grant "$DEPLOY_SA" "$role"
done
# Functions run as the default compute service account; the deployer must be able to act as it.
echo "  roles/iam.serviceAccountUser on the default compute service account"
gcloud iam service-accounts add-iam-policy-binding \
  "$PROJECT_NUMBER-compute@developer.gserviceaccount.com" --project "$PROJECT" \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/iam.serviceAccountUser --quiet >/dev/null

echo "Service account $PREVIEW_SA"
ensure_sa github-preview "GitHub Actions preview ($REPO, pull requests)"
# Roles from `firebase init hosting:github`, except that firebaseauth.admin (which can manage
# users) is replaced by a custom role that can only read and update the Auth config. A channel
# deploy uses it to add the preview domain to the authorized domains for Google sign-in.
echo "Custom role previewAuthDomains"
gcloud iam roles describe previewAuthDomains --project "$PROJECT" >/dev/null 2>&1 ||
  gcloud iam roles create previewAuthDomains --project "$PROJECT" \
    --title="Preview: Auth authorized domains" \
    --description="Lets PR preview deploys add their domain to Firebase Auth authorized domains." \
    --permissions=firebaseauth.configs.get,firebaseauth.configs.update --stage=GA
for role in roles/firebasehosting.admin "projects/$PROJECT/roles/previewAuthDomains" \
  roles/run.viewer roles/serviceusage.apiKeysViewer; do
  grant "$PREVIEW_SA" "$role"
done

echo "Workload Identity pool $POOL"
gcloud iam workload-identity-pools describe "$POOL" --location=global --project "$PROJECT" >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create "$POOL" --location=global --project "$PROJECT" \
    --display-name="GitHub Actions"

# Only tokens from this exact repository (by numeric id, which survives renames) are accepted.
# environment is only present on jobs that declare one, so it defaults to "none".
echo "OIDC provider $PROVIDER"
gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global \
  --workload-identity-pool="$POOL" --project "$PROJECT" >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --location=global \
    --workload-identity-pool="$POOL" --project "$PROJECT" \
    --display-name="$REPO" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref,attribute.event_name=assertion.event_name,attribute.environment=has(assertion.environment) ? assertion.environment : 'none'" \
    --attribute-condition="assertion.repository_id == '$REPO_ID'"

echo "Trust: production environment -> $DEPLOY_SA"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --project "$PROJECT" \
  --role=roles/iam.workloadIdentityUser --quiet >/dev/null \
  --member="$POOL_PRINCIPALS/attribute.environment/production"

echo "Trust: preview environment -> $PREVIEW_SA"
gcloud iam service-accounts add-iam-policy-binding "$PREVIEW_SA" --project "$PROJECT" \
  --role=roles/iam.workloadIdentityUser --quiet >/dev/null \
  --member="$POOL_PRINCIPALS/attribute.environment/preview"

# Only main may deploy to the production environment, so a pushed branch can't claim it.
echo "GitHub environment production (main only)"
gh api -X PUT "repos/$REPO/environments/production" --input - >/dev/null <<'JSON'
{ "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
JSON
gh api "repos/$REPO/environments/production/deployment-branch-policies" --jq '.branch_policies[].name' |
  grep -qx main ||
  gh api -X POST "repos/$REPO/environments/production/deployment-branch-policies" \
    -f name=main -f type=branch >/dev/null

echo "GitHub environment preview"
gh api -X PUT "repos/$REPO/environments/preview" >/dev/null

# Not secrets: the workflows read these as repository variables.
echo "GitHub repository variables"
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo "$REPO" \
  --body "projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"
gh variable set GCP_DEPLOY_SERVICE_ACCOUNT --repo "$REPO" --body "$DEPLOY_SA"
gh variable set GCP_PREVIEW_SERVICE_ACCOUNT --repo "$REPO" --body "$PREVIEW_SA"

echo "Done."
