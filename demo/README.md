# Synthetic class fixtures

These are invented examples for the cloud computing course presentation, explicitly approved by the user. They are **not** outputs of Cellinguist or any other model, and contain no patient, donor, unpublished or other research data.

All cell/treatment names begin with `demo-`. Scores have arbitrary units and no biological interpretation. Each summary, catalog and PNG labels this provenance. The plotting script uses only three hard-coded arrays; it never reads a dataset or an existing research directory.

Generate: `python3 scripts/build_synthetic_demo.py` (Matplotlib needed only by the developer).

Deploy: opt in with `enable_synthetic_demo = true` in private Terraform variables, inspect the plan, then apply. The default remains an empty catalog. Generated artifacts are version-controlled so deployment and browser checks do not require Matplotlib.
