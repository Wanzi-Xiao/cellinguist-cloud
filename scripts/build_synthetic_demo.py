#!/usr/bin/env python3
"""Generate hand-authored teaching fixtures only; never reads research files."""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("MPLCONFIGDIR", str(ROOT / ".tools/matplotlib"))
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

PAIRS = (
    ("demo-cell-alpha", "demo-treatment-one", [0.25, 0.60, 0.35]),
    ("demo-cell-alpha", "demo-combination-one-two", [0.65, 0.40, 0.75]),
    ("demo-cell-beta", "demo-treatment-two", [0.40, 0.20, 0.55]),
)
DISCLAIMER = "SYNTHETIC CLASS DEMO. Hand-authored arbitrary values; not model predictions or biological findings."


def build():
    destination = ROOT / "demo/synthetic-v1"
    entries = []
    for cell, condition, scores in PAIRS:
        directory = destination / cell / condition
        directory.mkdir(parents=True, exist_ok=True)
        summary = {
            "synthetic": True,
            "disclaimer": DISCLAIMER,
            "source": "Hand-authored fixtures for cloud-platform demonstration only",
            "fixtureVersion": "synthetic-v1",
            "cellType": cell,
            "conditionId": condition,
            "units": "Arbitrary illustrative score; no biological interpretation",
            "features": [{"label": f"Demo feature {name}", "score": score}
                         for name, score in zip(("A", "B", "C"), scores)],
        }
        (directory / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        fig, ax = plt.subplots(figsize=(8.4, 4.8), constrained_layout=True)
        fig.patch.set_facecolor("#f7f8f4")
        ax.set_facecolor("#f7f8f4")
        bars = ax.bar(["Demo feature A", "Demo feature B", "Demo feature C"], scores,
                      width=0.5, color=["#296955", "#789967", "#acbc7b"])
        ax.bar_label(bars, fmt="%.2f", padding=5, color="#233b39")
        ax.set_ylim(0, 1)
        ax.set_ylabel("Illustrative score (arbitrary units)")
        ax.set_title(f"SYNTHETIC DEMO — {cell}\n{condition}", fontsize=12, pad=16)
        ax.spines[["top", "right"]].set_visible(False)
        ax.text(0.5, -0.16, "Invented examples only · No model run · No biological findings",
                transform=ax.transAxes, ha="center", fontsize=9, color="#8a4d36")
        fig.savefig(directory / "plot.png", dpi=150,
                    metadata={"Software": "Cellinguist synthetic fixture generator", "Description": DISCLAIMER})
        plt.close(fig)
        entries.append({"cellType": cell, "conditionId": condition, "synthetic": True})
    catalog = {"version": "v1", "synthetic": True, "disclaimer": DISCLAIMER, "entries": entries}
    (destination / "catalog.json").write_text(json.dumps(catalog, indent=2) + "\n")
    print(f"Created {len(entries)} explicitly labeled synthetic pairs; no research files read.")


if __name__ == "__main__":
    build()
