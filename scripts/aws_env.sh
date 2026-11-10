#!/usr/bin/env bash
# Source this file in your own terminal; no cloud requests or login happen here.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  printf 'Use: source scripts/aws_env.sh\n' >&2
  exit 1
fi
CELLINGUIST_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -x "${CELLINGUIST_ROOT}/.tools/bin/aws" ]]; then
  printf 'AWS CLI is missing from .tools/bin/aws. See README setup instructions.\n' >&2
  return 1
fi
mkdir -p "${CELLINGUIST_ROOT}/.tools/aws/login-cache"
chmod 700 "${CELLINGUIST_ROOT}/.tools/aws" "${CELLINGUIST_ROOT}/.tools/aws/login-cache"
export PATH="${CELLINGUIST_ROOT}/.tools/bin:${PATH}"
export AWS_CONFIG_FILE="${CELLINGUIST_ROOT}/.tools/aws/config"
export AWS_SHARED_CREDENTIALS_FILE="${CELLINGUIST_ROOT}/.tools/aws/credentials"
export AWS_LOGIN_CACHE_DIRECTORY="${CELLINGUIST_ROOT}/.tools/aws/login-cache"
export AWS_PROFILE=cellinguist
export AWS_REGION=us-east-1
aws configure set region us-east-1 --profile cellinguist-console
aws configure set region us-east-1 --profile cellinguist
# The pinned Terraform provider uses an older SDK; CLI process credentials bridge browser login.
aws configure set credential_process "\"${CELLINGUIST_ROOT}/.tools/bin/aws\" configure export-credentials --profile cellinguist-console --format process" --profile cellinguist
chmod 600 "${AWS_CONFIG_FILE}"
printf 'Project AWS environment ready. Next: aws login --profile cellinguist-console --remote\n'
printf 'After login: aws sts get-caller-identity\n'
