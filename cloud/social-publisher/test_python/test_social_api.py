import base64
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "social_api.py"
SPECIFICATION = importlib.util.spec_from_file_location("social_api", SCRIPT_PATH)
if SPECIFICATION is None or SPECIFICATION.loader is None:
    raise RuntimeError(f"Impossible de charger {SCRIPT_PATH}")
SOCIAL_API = importlib.util.module_from_spec(SPECIFICATION)
SPECIFICATION.loader.exec_module(SOCIAL_API)

PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZJ6sAAAAASUVORK5CYII="
)
JPEG_SIGNATURE = b"\xff\xd8"
IMAGE_MEDIA = {"kind": "image"}
META_ADVERTISER_ID = "972240608516319"
META_AD_ACCOUNT = {
    "id": "sibyl-meta-ads",
    "project_id": "sibyl",
    "platform": "facebook",
    "connection_kind": "advertising",
    "api_provider_subject": META_ADVERTISER_ID,
}


class MediaPreparationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.source = self.root / "approved-slide.png"
        self.source.write_bytes(PNG_BYTES)
        self.original_prepared_root = SOCIAL_API.PREPARED_MEDIA_ROOT
        SOCIAL_API.PREPARED_MEDIA_ROOT = self.root / "prepared"

    def tearDown(self) -> None:
        SOCIAL_API.PREPARED_MEDIA_ROOT = self.original_prepared_root
        self.temporary_directory.cleanup()

    def test_instagram_png_becomes_cached_jpeg_without_changing_source(self) -> None:
        prepared = SOCIAL_API.prepare_media_for_upload("instagram", IMAGE_MEDIA, self.source)
        prepared_again = SOCIAL_API.prepare_media_for_upload("instagram", IMAGE_MEDIA, self.source)

        self.assertEqual(prepared.suffix, ".jpg")
        self.assertEqual(prepared, prepared_again)
        self.assertTrue(prepared.read_bytes().startswith(JPEG_SIGNATURE))
        self.assertEqual(self.source.read_bytes(), PNG_BYTES)
        self.assertTrue(SOCIAL_API.file_sha256(self.source)[:16] in prepared.name)

    def test_tiktok_and_instagram_keep_distinct_preparation_paths(self) -> None:
        tiktok_copy = self.root / "prepared.webp"
        instagram_copy = self.root / "prepared.jpg"
        with (
            mock.patch.object(SOCIAL_API, "prepare_tiktok_photo", return_value=tiktok_copy) as prepare_tiktok,
            mock.patch.object(SOCIAL_API, "prepare_instagram_photo", return_value=instagram_copy) as prepare_instagram,
        ):
            self.assertEqual(
                SOCIAL_API.prepare_media_for_upload("tiktok", IMAGE_MEDIA, self.source),
                tiktok_copy,
            )
            self.assertEqual(
                SOCIAL_API.prepare_media_for_upload("instagram", IMAGE_MEDIA, self.source),
                instagram_copy,
            )

        prepare_tiktok.assert_called_once_with(self.source)
        prepare_instagram.assert_called_once_with(self.source)

    def test_facebook_png_keeps_the_approved_source(self) -> None:
        self.assertEqual(
            SOCIAL_API.prepare_media_for_upload("facebook", IMAGE_MEDIA, self.source),
            self.source,
        )


class ConfigurationTest(unittest.TestCase):
    def test_http_loopback_is_allowed_for_local_development(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry_path = Path(directory) / "registry.json"
            registry_path.write_text(json.dumps({"api": {}}), encoding="utf-8")
            with (
                mock.patch.object(SOCIAL_API, "REGISTRY_PATH", registry_path),
                mock.patch.dict(
                    os.environ,
                    {
                        SOCIAL_API.API_URL_ENV: "http://127.0.0.1:8787",
                        SOCIAL_API.ADMIN_TOKEN_ENV: "local-test-token",
                    },
                    clear=False,
                ),
            ):
                self.assertEqual(
                    SOCIAL_API.configuration(),
                    ("http://127.0.0.1:8787", "local-test-token"),
                )


class AdvertisementMediaContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.plan_path = self.root / "ads.json"
        self.registry = {"accounts": [META_AD_ACCOUNT]}
        self.advertisement = {
            "id": "sibyl-instagram-existing-post",
            "group_id": "sibyl-launch",
            "account_ref": "sibyl-meta-ads",
            "advertiser_id": META_ADVERTISER_ID,
            "platform": "instagram",
            "provider": "meta",
            "start_at": "2026-09-15T10:00:00Z",
            "budget": {"type": "daily", "amount_minor": 1000, "currency": "USD"},
            "operations": [{
                "id": "creative",
                "type": "meta.creative.create",
                "body": {"source_instagram_media_id": "17890000000000000"},
            }],
        }

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_plan_accepts_provider_owned_media_without_local_upload(self) -> None:
        paths = SOCIAL_API.validate_advertisement(
            self.advertisement,
            self.registry,
            "sibyl",
            self.root,
            self.plan_path,
        )

        self.assertEqual(paths, [])

    def test_plan_requires_local_media_for_any_nested_media_url_placeholder(self) -> None:
        self.advertisement["operations"][0]["body"] = {
            "asset_feed_spec": {
                "videos": [{"source_url": {SOCIAL_API.AD_MEDIA_URL_PLACEHOLDER_KEY: 0}}],
            },
        }

        with self.assertRaisesRegex(
            SOCIAL_API.ApiCliError,
            f"référence \\{SOCIAL_API.AD_MEDIA_URL_PLACEHOLDER_KEY}",
        ):
            SOCIAL_API.validate_advertisement(
                self.advertisement,
                self.registry,
                "sibyl",
                self.root,
                self.plan_path,
            )


if __name__ == "__main__":
    unittest.main()
