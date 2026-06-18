import os, sys, unittest

sys.path.insert(0, os.path.dirname(__file__))
from handler import plan_steps  # boto3 must NOT be imported at module top


class PlanStepsTest(unittest.TestCase):
    def test_fresh_database_runs_everything_in_order(self):
        self.assertEqual(
            plan_steps(False, False, False),
            ["schema", "schema_jsonb", "data", "apt", "yum"],
        )

    def test_fully_seeded_does_nothing(self):
        self.assertEqual(plan_steps(True, True, True), [])

    def test_relational_done_but_jsonb_missing(self):
        self.assertEqual(plan_steps(True, False, False), ["apt", "yum"])

    def test_only_yum_missing(self):
        self.assertEqual(plan_steps(True, True, False), ["yum"])


if __name__ == "__main__":
    unittest.main()
