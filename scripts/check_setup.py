#!/usr/bin/env python3
"""Offline deployment-readiness check. Never reads or prints credentials."""
import os
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    ready = True
    for name, fallback in (("terraform", ROOT / ".tools/bin/terraform"), ("aws", ROOT / ".tools/bin/aws")):
        present = bool(shutil.which(name) or fallback.is_file())
        print(f"{'OK' if present else 'MISSING'}: {name}")
        ready = ready and present
    configured = any(os.environ.get(key) for key in (
        "AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_WEB_IDENTITY_TOKEN_FILE",
        "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_CREDENTIALS_FULL_URI"))
    configured = configured or (ROOT / ".tools/aws/config").is_file()
    configured = configured or any((Path.home() / ".aws" / name).is_file() for name in ("credentials", "config"))
    print(f"{'PRESENT' if configured else 'MISSING'}: AWS credential configuration (values not read)")
    print("Credentials must be verified separately with aws sts get-caller-identity before any apply.")
    print("Docker is optional on this server: GitHub Actions builds the ECR image after bootstrap.")
    print("No AWS requests, deployment, or data processing were performed.")
    return 0 if ready and configured else 1


if __name__ == "__main__":
    sys.exit(main())
