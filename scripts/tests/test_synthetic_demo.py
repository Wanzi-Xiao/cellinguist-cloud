"""Check the deployable fixture contract, without AWS or scientific processing."""
import json
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[2] / "demo/synthetic-v1"


class SyntheticDemoTests(unittest.TestCase):
    def test_catalog_is_explicitly_synthetic_and_each_entry_has_matching_artifacts(self):
        catalog = json.loads((ROOT / "catalog.json").read_text())
        self.assertIs(catalog["synthetic"], True)
        self.assertEqual(len(catalog["entries"]), 3)
        self.assertIn("not model predictions", catalog["disclaimer"])
        pairs = set()
        for entry in catalog["entries"]:
            with self.subTest(entry=entry):
                self.assertIs(entry["synthetic"], True)
                self.assertTrue(entry["cellType"].startswith("demo-"))
                self.assertTrue(entry["conditionId"].startswith("demo-"))
                pair = (entry["cellType"], entry["conditionId"])
                self.assertNotIn(pair, pairs)
                pairs.add(pair)
                folder = ROOT.joinpath(*pair)
                summary = json.loads((folder / "summary.json").read_text())
                self.assertIs(summary["synthetic"], True)
                self.assertEqual((summary["cellType"], summary["conditionId"]), pair)
                self.assertIn("not model predictions", summary["disclaimer"])
                self.assertLess((folder / "summary.json").stat().st_size, 262144)
                png = (folder / "plot.png").read_bytes()
                self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
                self.assertGreater(struct.unpack(">I", png[16:20])[0], 600)
                self.assertIn(b"not model predictions", png)


if __name__ == "__main__":
    unittest.main()
