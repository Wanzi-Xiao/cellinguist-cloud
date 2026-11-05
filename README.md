# Cellinguist Cloud

Cloud computing final project following RFC 0001 (course documents are retained locally and excluded from this public repository).
An isolated serverless platform for exploring **approved, precomputed** cytokine-response results.
No training, inference, research pipeline, model weights, or existing research outputs are included.

## Current implementation

- Python Lambda API: public `GET /health`; Cognito-protected `GET /catalog`, `GET /results`, `POST /history`, `GET /history`.
- Catalog allowlist, bounded inputs, generic errors, five-minute private S3 plot links, user identity from API Gateway verified claims.
- DynamoDB saves scoped to `USER#{sub}`; lists at most the 50 most recent saved queries. No client-supplied identity.
- Docker image compatible with Lambda, plus a separate digest entry point.
- Terraform definitions for S3, CloudFront, API Gateway HTTP API, Lambda, ECR, DynamoDB, Cognito, EventBridge Scheduler, SNS, and a CloudWatch dashboard/alarm. IAM is additional.
- GitHub Actions for tests/Terraform validation and OIDC-authenticated ECR image builds. Image delivery does not automatically deploy.
- Minimal static frontend placeholder. Interactive Cognito PKCE login, selection controls, result viewer, and history UI remain to implement.

**Status:** scaffold, not an AWS-deployed or submission-ready application. No AWS resources have been applied, no real data has been accessed, and no data job is running. The catalog intentionally starts empty. Tests use small in-memory API objects only.

## Repository layout

```text
backend/                 Lambda API, digest, Dockerfile, isolated unit tests
infra/                   Single Terraform root for all cloud services
frontend/                Static placeholder (interactive dashboard pending)
.github/workflows/       Platform checks and ECR build workflow
```

## Verify the backend without AWS or research data

```bash
cd backend
python3 -m unittest discover -s tests -v
```

Tests require only the Python standard library. Production AWS clients are initialized lazily; running these tests does not initialize boto3 or contact AWS. Deployable dependencies are installed inside the Docker image.

## Deployment runbook (future step; not executed)

Prerequisites: Terraform >=1.6, AWS CLI authenticated to the intended account, Docker with Buildx, and appropriate AWS provisioning permissions. Use one AWS region. Terraform state is local and excluded from Git; retain it securely for teardown. Never commit AWS credentials, `.env`, state, private tfvars, data, or model weights.

1. Copy `infra/terraform.tfvars.example` to `infra/terraform.tfvars`. Set region/environment and optional notification email. Keep `api_image_uri = ""` for bootstrap and `enable_schedule = false`. If GitHub OIDC already exists in the account, set `github_oidc_provider_arn` to reuse it.
2. Review and provision bootstrap resources:

   ```bash
   cd infra
   terraform init
   terraform fmt -check
   terraform validate
   terraform plan -out=bootstrap.tfplan
   terraform apply bootstrap.tfplan
   terraform output
   ```

   Bootstrap creates supporting services and the ECR repository but omits both image-based Lambdas, their integrations/routes, and the schedule until an image URI is supplied. The API will not serve routes yet. These steps create billable resources.

3. Set GitHub repository Actions variables (not AWS keys): `AWS_REGION`, `AWS_ROLE_ARN` from `github_role_arn`, and `ECR_REPOSITORY` from `ecr_repository_url`. Push to `main` or dispatch **Build API image** from `main`. Before these variables exist, the image job intentionally skips. A repeated build of the same SHA cannot overwrite an immutable ECR tag; use a new commit if needed.
4. Record the successful Actions run URL and ECR image digest. Set `api_image_uri` to the exact `repository@sha256:...` URI in private tfvars, then run a fresh `terraform plan` and `terraform apply`. Both Lambdas use the same image with different handler commands. Deployment is manual and controlled.
5. Confirm the SNS email subscription if configured. Turn on the weekly schedule only when desired. It defaults to disabled and reads aggregate CloudWatch metrics, never personal histories.
6. Verify `GET /health`, unauthenticated route rejection, Cognito sign-in, allowlist rejection, and cross-user history isolation in the real deployment. The current tests do not replace these integration checks.
7. Upload only separately approved result assets after permission is confirmed. No upload or seed command runs automatically. Build the interactive frontend before recording the course demo.
8. For cleanup, empty both S3 buckets (including all result object versions/delete markers) and delete ECR images, then `terraform destroy`. Buckets/ECR are intentionally not configured to force-delete contents. Keep local Terraform state until destruction is confirmed.

## Future curated-result contract

The private results bucket uses:

```text
results/v1/catalog.json
results/v1/{cell_type}/{condition}/summary.json
results/v1/{cell_type}/{condition}/plot.png
```

A future `catalog.json` has the form `{"version":"v1","entries":[{"cellType":"approved-slug","conditionId":"approved-slug"}]}`. Identifiers must match `[a-z0-9][a-z0-9_-]{0,63}`. Summary JSON objects are bounded to 256 KiB. No sample result files are included or uploaded. Missing catalog returns an empty list; an approved selection with missing summary returns 404.

The API is an API Gateway HTTP API with payload format 2.0, not the separately priced API Gateway REST API product. Cognito validates identities through the JWT authorizer; the Lambda invocation permission is restricted to this gateway. The application trusts authorizer claims and must not be exposed through a public Lambda Function URL.

## Remaining course evidence

- Interactive dashboard with authorization-code + PKCE login/logout and persisted history.
- Real AWS apply and integration checks; AWS quotas/permissions must be checked at deployment time.
- One successful OIDC ECR push and recorded deployed image digest.
- Approved demonstration artifacts (or explicitly labeled synthetic fixtures if chosen later).
- Demonstrated SNS subscription, scheduled digest, dashboard, and alarm.
- Recorded demo within the course limit, exact deployment URLs and cleanup evidence.

## AI assistance

ChatGPT/Codex assisted with the initial backend, Terraform, workflows, tests, and documentation. The student must review the design, complete AWS deployment/integration validation, and record AI use in the final submission. The proposal is a design reference; its future deployment/demo steps are not treated as commands to run research data.

## Local validation recorded on 2026-11-05

Seven standard-library API tests passed; Python compile checks passed; Terraform 1.9.8 `validate` and `fmt -check -recursive` passed with AWS provider 5.100.0. The lockfile is committed. The copied proposal matches the original SHA-256. No Terraform plan/apply, production container build, AWS integration check, or research-data operation was performed.
