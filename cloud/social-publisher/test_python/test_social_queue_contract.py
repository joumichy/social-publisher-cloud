import importlib.util
import unittest
from pathlib import Path


SCRIPT_PATH = Path.home() / ".codex" / "skills" / "social-publisher" / "scripts" / "social_queue.py"
SPECIFICATION = importlib.util.spec_from_file_location("social_queue", SCRIPT_PATH)
if SPECIFICATION is None or SPECIFICATION.loader is None:
    raise RuntimeError(f"Impossible de charger {SCRIPT_PATH}")
SOCIAL_QUEUE = importlib.util.module_from_spec(SPECIFICATION)
SPECIFICATION.loader.exec_module(SOCIAL_QUEUE)


class NativeSchedulerContractTest(unittest.TestCase):
    def test_tiktok_organic_uses_tiktok_studio(self) -> None:
        self.assertIsNone(
            SOCIAL_QUEUE.native_scheduler_url_issue(
                "tiktok",
                SOCIAL_QUEUE.ORGANIC_CONNECTION_KIND,
                "https://www.tiktok.com/tiktokstudio/upload",
            )
        )

    def test_tiktok_advertising_uses_ads_manager(self) -> None:
        self.assertIsNone(
            SOCIAL_QUEUE.native_scheduler_url_issue(
                "tiktok",
                SOCIAL_QUEUE.ADVERTISING_CONNECTION_KIND,
                "https://ads.tiktok.com/i18n/dashboard",
            )
        )

    def test_tiktok_advertising_rejects_tiktok_studio(self) -> None:
        self.assertEqual(
            SOCIAL_QUEUE.native_scheduler_url_issue(
                "tiktok",
                SOCIAL_QUEUE.ADVERTISING_CONNECTION_KIND,
                "https://www.tiktok.com/tiktokstudio/upload",
            ),
            "Domaine natif requis : ads.tiktok.com",
        )


if __name__ == "__main__":
    unittest.main()
