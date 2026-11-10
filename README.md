# Cellinguist Cloud

A cloud computing final project for exploring **approved, precomputed** cytokine-response results and keeping a personal query history. Research pipelines, training, live inference, model weights, and existing research outputs are excluded. Course documents stay local and are ignored by Git.

## Implementation status

The platform is deployed on AWS as of 2026-11-10. The catalog intentionally starts empty; there are no research results to browse until separately approved artifacts are supplied.

- Dashboard: https://d3t5bcsvv8n26w.cloudfront.net
- Public API health: https://eg3kg9bak8.execute-api.us-east-1.amazonaws.com/health
- Successful OIDC image build: https://github.com/Wanzi-Xiao/cellinguist-cloud/actions/runs/42868636908 (attempt 2)
- Successful platform checks: https://github.com/Wanzi-Xiao/cellinguist-cloud/actions/runs/42868636860
- Deployed image source commit: `8f77b8939bbc1adc630753eccd8b7c391dd272e7`
- Deployed ECR image digest: `sha256:c5ecb0ec81bb3e7816e847865cf51c0e530d632b1a12ebef3c828c110c598614`

SNS email subscription confirmation and the final course demo remain user actions. The weekly digest schedule stays disabled until deliberately enabled.

- Responsive response explorer: sign-in/signup, cell/treatment selection, precomputed plot and JSON summary, saved queries, and reopening historical selections.
- Cognito authorization-code flow with S256 PKCE, random single-use state, a ten-minute callback lifetime, and tab-scoped access tokens. ID/refresh tokens are discarded. Expired sessions require sign-in again; a new sign-in retrieves the same DynamoDB history.
- Public `GET /health`; protected `GET /catalog`, `GET /results`, `POST /history`, `GET /history`. Protected Gateway routes require an access token with `openid` scope.
- Catalog allowlist, byte-bounded inputs, generic server errors, five-minute SigV4 S3 plot URLs, and verified user identity from API Gateway JWT claims.
- User history scoped to `USER#{sub}`; lists at most 50 most recent queries. Client-submitted user IDs are rejected.
- Container-based Python Lambda API and separate operational digest handler. No inference dependencies.
- Terraform defines S3, CloudFront, API Gateway HTTP API, Lambda, ECR, DynamoDB, Cognito, EventBridge Scheduler, SNS, and a CloudWatch dashboard/alarm. IAM is additional to these ten services.
- Terraform uploads all browser assets and generates public `config.js` from resource outputs. Private S3 origins, browser security headers, and disabled CloudFront caching support OAuth callbacks and configuration updates.
- GitHub Actions runs API/frontend/browser checks and Terraform validation. Browser CI is pinned to Ubuntu 22.04 to match the locked Playwright version. A separate workflow builds commit-tagged ECR images with GitHub OIDC using public deployment identifiers in the workflow, with optional repository-variable overrides. Deployment is a manual reviewed Terraform update.

## Layout

```text
backend/               Lambda API, digest, Dockerfile, unit tests
frontend/              Buildless HTML/CSS/ES modules and frontend unit tests
infra/                 Single Terraform root, pinned provider lockfile
scripts/               Browser regression check, offline setup check, scoped AWS shell setup
.github/workflows/     Platform checks and ECR image delivery
```

`docs/`, `.tools/`, credentials, research data, and Terraform state are ignored. `docs/` retains the proposal and private progress/screenshots on the development server only.

## Verify without AWS or research data

Python 3.12+ and Node 22 are sufficient for the unit tests:

```bash
(cd backend && python3 -m unittest discover -s tests -v)
node --test frontend/tests/*.test.mjs
```

Optional browser regression check:

```bash
npm ci
npx playwright install chromium
npm run test:browser
```

The browser check intercepts **all** requests, including its simulated identity provider and API. It checks desktop/mobile layout, PKCE callback, result display/save/history/revisit, reload/logout, empty catalog, and invalid-state rejection with in-memory contract-test objects. No scientific result is generated and no AWS service is called. Screenshots are stored under ignored `docs/previews/`. On Linux, Chromium may require system libraries; CI uses `playwright install --with-deps chromium`.

To inspect the disconnected dashboard locally:

```bash
python3 -m http.server 8080 --bind 127.0.0.1 --directory frontend
```

Use SSH port forwarding if viewing a remote server. This serves only the frontend directory. The checked-in `config.js` has empty values: login and result actions stay disabled until connected. It does not simulate an authenticated session or supply fake catalog results.

## Live AWS verification

The deployed platform passed public-health and unauthenticated-rejection checks, CloudFront header checks, two real Cognito authorization-code/PKCE logins, authenticated empty-catalog behavior, user partition isolation, history after reload, and hosted logout. Test-user email was suppressed. Both temporary users and a temporary history probe were removed afterward.

To repeat deliberately on the configured Linux development server (requires project AWS credentials, system Python with `memfd_create`, and installed Playwright/Chromium):

```bash
source scripts/aws_env.sh
CELLINGUIST_LIVE_CHECK=1 npm run test:aws
```

This live check creates two temporary Cognito users and one temporary DynamoDB history probe. It never adds result artifacts or runs a model. Passwords stay in anonymous memory, never CLI arguments or disk; `.tools/live-smoke-cleanup.json` records only resource IDs for recovery if interrupted. Logs/screenshots remain under ignored `docs/` when redirected there.

Because the approved catalog is empty, successful `POST /history` and private plot-link delivery still require a separately approved catalog entry for a full data-enabled demo. The live isolation check uses a direct, temporary DynamoDB probe rather than pretending an unsupported selection can be saved. Local browser tests cover the complete selection/save flow using intercepted contract-test responses.

## Personal AWS account setup

The development server has project-local AWS CLI v2 and Terraform in ignored `.tools/bin/`. These binaries are not shipped through Git. A new checkout needs AWS CLI v2 and Terraform installed separately (place/link the CLI at `.tools/bin/aws` to use the helper).

Run these in your own SSH terminal; do not paste passwords, AWS keys, or authorization codes into chat:

```bash
cd /vast/acillo/wax11/cellinguist-cloud
source scripts/aws_env.sh
aws login --profile cellinguist-console --remote
aws sts get-caller-identity
```

Open the link printed by the CLI in your browser and paste the returned code **into that terminal**. The helper creates isolated project profiles and a login-cache directory under ignored `.tools/aws/`, leaving existing `~/.aws` profiles unchanged. The helper itself performs no login or cloud requests. Run `source scripts/aws_env.sh` again in each deployment terminal.

AWS browser login requires a suitable IAM identity and `SignInLocalDevelopmentAccess` permission. Use the intended deployment identity with permissions to provision the listed resources. The `cellinguist` profile uses the CLI as a credential process, so the pinned Terraform provider can consume the newer browser-login session without saving static AWS keys. See [AWS CLI browser login and process-credential documentation](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html).

`python3 scripts/check_setup.py` checks tools and configuration presence offline; it does not prove credentials are valid. Verify the account with `aws sts get-caller-identity` before any apply. Docker is optional on this server because GitHub Actions builds the image.

## Deployment runbook

No step below runs automatically. AWS resources incur charges while deployed. State is local, ignored, and must be retained securely until teardown.

1. Authenticate and verify the intended account as above. Copy `infra/terraform.tfvars.example` to ignored `infra/terraform.tfvars`; review region/environment and set the administrator notification email if desired. Keep `api_image_uri = ""` and `enable_schedule = false` initially. If the account already has a GitHub OIDC provider, set `github_oidc_provider_arn` to reuse it. Set `github_oidc_subject` to the exact subject issued for this repository/main branch; new GitHub repositories include immutable owner/repository IDs. The example is configured for this repository. See [GitHub immutable-subject documentation](https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/).
2. Review and apply bootstrap infrastructure:

   ```bash
   cd infra
   terraform init
   terraform fmt -check
   terraform validate
   terraform plan -out=bootstrap.tfplan
   terraform apply bootstrap.tfplan
   terraform output
   ```

   Bootstrap creates the dashboard, Cognito, ECR, storage, monitoring, and supporting services. The private catalog is initialized as `{"version":"v1","entries":[]}`. Both image-based Lambdas, their API routes, and the schedule are omitted until an image exists, so the dashboard cannot reach working API routes yet.
3. The workflow includes the current deployment's public region, scoped role ARN, and ECR repository URI; these are identifiers, not credentials. Optional GitHub Actions variables `AWS_REGION`, `AWS_ROLE_ARN`, and `ECR_REPOSITORY` override them for another deployment. Dispatch **Build API image** from `main`, or push a new commit to `main`. Forks do not use this deployment job. ECR tags are immutable: rebuild with a new commit SHA when needed. The OIDC trust policy must exactly match the main-branch subject; it grants image delivery only, not infrastructure administration.
4. Record the successful Actions run URL and exact ECR image digest. Set `api_image_uri` in private tfvars to `repository@sha256:...`, then review a new plan and apply it. Both Lambdas use that image with different handler commands. Terraform generates `config.js` and uploads all browser assets; no manual copying of API URLs is needed. The public frontend bucket remains private behind CloudFront origin access control.
5. Verify `/health`, unauthenticated rejection, Cognito signup/sign-in/logout, access-token authorization, empty catalog behavior, and history isolation with two real accounts. The local tests and mocked browser checks do not replace AWS integration testing.
6. Confirm the SNS email subscription. Test the digest and alarm, inspect the CloudWatch dashboard, and only enable the weekly schedule when desired. The digest reads aggregate metrics, never personal query histories. It defaults to disabled.
7. Supply only separately approved curated artifacts. No seed upload, research-data processing, or model operation is part of this repository's setup. Terraform ignores later content changes to its bootstrap catalog so it does not reset approved uploads to empty on the next apply.
8. Record the course demo and deployment evidence. For teardown, empty both S3 buckets (including versioned objects/delete markers) and delete ECR images before `terraform destroy`. Force deletion is intentionally disabled. Retain state until teardown is confirmed.

## Curated-result contract

Private objects:

```text
results/v1/catalog.json
results/v1/{cell_type}/{condition}/summary.json
results/v1/{cell_type}/{condition}/plot.png
```

Catalog: `{"version":"v1","entries":[{"cellType":"approved-slug","conditionId":"approved-slug"}]}`. Identifiers must match `[a-z0-9][a-z0-9_-]{0,63}`. Summary objects are JSON, bounded to 256 KiB, and displayed as formatted JSON without interpreting HTML. Plots are PNG images accessed through short-lived signed URLs. Missing summary returns 404. No scientific fixtures, seed artifacts, model weights, or result uploads are included.

The gateway uses HTTP API payload format 2.0, rather than the separate API Gateway REST API product. API Gateway validates token signature, issuer, audience and scope; Lambda reads its verified `sub`. Do not expose a public Lambda Function URL. See [AWS JWT-authorizer guidance](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html). CloudFront uses the documented [CachingDisabled policy](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html#managed-cache-policy-caching-disabled); CSP restricts connections to the configured Cognito origin and regional API Gateway endpoints (the regional pattern avoids a Terraform dependency cycle).

## Course evidence

Completed: real Terraform bootstrap/application apply, GitHub OIDC ECR push, digest-pinned Lambda deployment, real Cognito/browser/history-isolation checks with two temporary users (removed afterward), successful operational-digest publication to SNS, and a successful CloudWatch alarm action to SNS. A final Terraform plan reports no configuration drift. Detailed plans, logs, and state stay local and ignored.

Still needed:

- Approved demonstration artifacts, if/when authorized separately.
- Confirm the SNS email subscription, verify delivery, and record the digest/alarm/dashboard demonstration. The weekly schedule intentionally remains disabled.
- Recorded demo, exact deployed URLs, and cleanup evidence.

## Validation and AI assistance

On 2026-11-10: 11 backend tests, 12 frontend unit tests, desktop/mobile browser flow checks using intercepted requests, and Terraform validation/format checks passed. Browser testing found and fixed a Window.fetch binding issue that Node unit tests alone did not expose. The AWS platform has since been deployed through Terraform and the production image built through GitHub OIDC. Research data processing and inference have not been performed.

ChatGPT/Codex assisted with the backend, dashboard, Terraform, workflows, tests, and documentation. The student must review design decisions, complete AWS integration validation, and disclose AI assistance in the final submission. The local proposal is a design reference, not authorization to execute research or publish its contents.
