#!/usr/bin/env python3
"""Secure CLI bridge from local social queues to the serverless publisher."""

from __future__ import annotations

import argparse
import hashlib
import http.client
import importlib.util
import json
import mimetypes
import os
import shutil
import ssl
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen


API_URL_ENV = "SOCIAL_PUBLISHER_API_URL"
ADMIN_TOKEN_ENV = "SOCIAL_PUBLISHER_ADMIN_TOKEN"
PROVIDER_ACCESS_TOKEN_ENV = "SOCIAL_PROVIDER_ACCESS_TOKEN"
PROVIDER_REFRESH_TOKEN_ENV = "SOCIAL_PROVIDER_REFRESH_TOKEN"
QUEUE_MODULE_PATH = Path.home() / ".codex" / "skills" / "social-publisher" / "scripts" / "social_queue.py"
REGISTRY_PATH = Path.home() / ".codex" / "social-publisher" / "registry.json"
PREPARED_MEDIA_ROOT = Path.home() / ".codex" / "social-publisher" / "prepared-media"
JSON_CONTENT_TYPE = "application/json"
USER_AGENT = "Stellark-Social-Publisher/1.0"
UTF8 = "utf-8"
HTTPS_SCHEME = "https"
HTTP_SCHEME = "http"
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
HTTP_TIMEOUT_SECONDS = 120
UPLOAD_BLOCK_BYTES = 1024 * 1024
ADMIN_KEYCHAIN_SERVICE = "stellark-social-publisher-admin"
EXIT_OK = 0
EXIT_ERROR = 2
AD_PLAN_SCHEMA_VERSION = 1
AD_APPROVAL_CONFIRMATION = "user"
AD_STATE_APPROVED = "approved"
AD_STATE_SCHEDULED = "scheduled"
AD_SUPPORTED_PLATFORMS = frozenset({"facebook", "instagram", "tiktok"})
CONTENT_TARGET_PLATFORMS = frozenset({"facebook", "instagram", "linkedin", "tiktok"})
AD_SUPPORTED_PROVIDERS = frozenset({"meta", "tiktok"})
AD_BUDGET_TYPES = frozenset({"daily", "lifetime"})
AD_CURRENCY_LENGTH = 3
AD_MEDIA_URL_PLACEHOLDER_KEY = "$media_url"
AD_MEDIA_REQUIRED_MESSAGE = "Au moins un média publicitaire est requis quand une opération référence $media_url."
IMAGE_MEDIA_KIND = "image"
INSTAGRAM_PLATFORM = "instagram"
TIKTOK_PLATFORM = "tiktok"
PNG_SUFFIX = ".png"
JPEG_SUFFIX = ".jpg"
WEBP_SUFFIX = ".webp"
PREPARED_DIRECTORY_MODE = 0o700
PREPARED_FILE_MODE = 0o600
CONTENT_DIGEST_LENGTH = 16
DIGEST_DIRECTORY_LENGTH = 2
JPEG_QUALITY_PERCENT = 95
FFMPEG_JPEG_QUALITY = 2


class ApiCliError(Exception):
    """Safe user-facing API bridge error."""


def load_queue_module() -> Any:
    specification = importlib.util.spec_from_file_location("social_queue", QUEUE_MODULE_PATH)
    if specification is None or specification.loader is None:
        raise ApiCliError(f"Impossible de charger {QUEUE_MODULE_PATH}")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def configuration() -> tuple[str, str]:
    registry = json.loads(REGISTRY_PATH.read_text(encoding=UTF8))
    registry_base_url = registry.get("api", {}).get("base_url")
    base_url = (os.environ.get(API_URL_ENV) or registry_base_url or "").rstrip("/")
    token = os.environ.get(ADMIN_TOKEN_ENV, "")
    if not token and sys.platform == "darwin":
        completed = subprocess.run(
            ("security", "find-generic-password", "-w", "-s", ADMIN_KEYCHAIN_SERVICE),
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.returncode == EXIT_OK:
            token = completed.stdout.strip()
    if not token and sys.platform == "win32":
        from windows_credentials import read_admin_token
        token = read_admin_token() or ""
    if not base_url or not token:
        raise ApiCliError(f"Définissez {API_URL_ENV} et {ADMIN_TOKEN_ENV} dans l’environnement.")
    parsed_base_url = urlparse(base_url)
    is_secure = parsed_base_url.scheme == HTTPS_SCHEME
    is_local_http = parsed_base_url.scheme == HTTP_SCHEME and parsed_base_url.hostname in LOOPBACK_HOSTS
    if not is_secure and not is_local_http:
        raise ApiCliError("L’API doit utiliser HTTPS hors développement local.")
    return base_url, token


def api_json(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    base_url, token = configuration()
    body = json.dumps(payload).encode(UTF8) if payload is not None else None
    request = Request(
        f"{base_url}{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": JSON_CONTENT_TYPE,
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode(UTF8))
    except Exception as error:
        detail = getattr(error, "read", lambda: b"")().decode(UTF8, errors="replace")
        raise ApiCliError(f"API {method} {path} impossible : {detail or error}") from error


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(UPLOAD_BLOCK_BYTES):
            digest.update(block)
    return digest.hexdigest()


def prepared_media_path(path: Path, suffix: str) -> Path:
    source_digest = file_sha256(path)
    cache_directory = PREPARED_MEDIA_ROOT / source_digest[:DIGEST_DIRECTORY_LENGTH]
    prepared_path = cache_directory / f"{path.stem}-{source_digest[:CONTENT_DIGEST_LENGTH]}{suffix}"
    cache_directory.mkdir(mode=PREPARED_DIRECTORY_MODE, parents=True, exist_ok=True)
    PREPARED_MEDIA_ROOT.chmod(PREPARED_DIRECTORY_MODE)
    cache_directory.chmod(PREPARED_DIRECTORY_MODE)
    return prepared_path


def cached_prepared_media(path: Path) -> Path | None:
    if not path.is_file() or path.stat().st_size <= 0:
        return None
    path.chmod(PREPARED_FILE_MODE)
    return path


def prepare_tiktok_photo(path: Path) -> Path:
    """Return a TikTok-compatible copy while preserving the approved source."""
    if path.suffix.lower() != PNG_SUFFIX:
        return path

    prepared_path = prepared_media_path(path, WEBP_SUFFIX)
    cached = cached_prepared_media(prepared_path)
    if cached:
        return cached

    temporary_path = prepared_path.with_name(f".{prepared_path.stem}.{os.getpid()}.part{WEBP_SUFFIX}")

    converter = shutil.which("cwebp")
    if converter:
        command = (
            converter,
            "-quiet",
            "-lossless",
            "-exact",
            str(path),
            "-o",
            str(temporary_path),
        )
    else:
        converter = shutil.which("ffmpeg")
        if not converter:
            raise ApiCliError(
                "TikTok exige JPEG ou WebP pour les carrousels. Installez cwebp ou ffmpeg pour préparer une copie."
            )
        command = (
            converter,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-c:v",
            "libwebp",
            "-lossless",
            "1",
            "-compression_level",
            "6",
            str(temporary_path),
        )

    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
    )
    if (
        completed.returncode != EXIT_OK
        or not temporary_path.is_file()
        or temporary_path.stat().st_size == 0
    ):
        temporary_path.unlink(missing_ok=True)
        detail = completed.stderr.strip() or "conversion sans fichier de sortie"
        raise ApiCliError(f"Impossible de préparer la copie WebP TikTok : {detail}")
    os.replace(temporary_path, prepared_path)
    prepared_path.chmod(PREPARED_FILE_MODE)
    return prepared_path


def prepare_instagram_photo(path: Path) -> Path:
    """Return a JPEG copy accepted by Instagram while preserving the approved PNG."""
    if path.suffix.lower() != PNG_SUFFIX:
        return path

    prepared_path = prepared_media_path(path, JPEG_SUFFIX)
    cached = cached_prepared_media(prepared_path)
    if cached:
        return cached

    temporary_path = prepared_path.with_name(f".{prepared_path.stem}.{os.getpid()}.part{JPEG_SUFFIX}")
    temporary_path.unlink(missing_ok=True)
    converter = shutil.which("sips")
    if converter:
        command = (
            converter,
            "-s",
            "format",
            "jpeg",
            "-s",
            "formatOptions",
            str(JPEG_QUALITY_PERCENT),
            str(path),
            "--out",
            str(temporary_path),
        )
    else:
        converter = shutil.which("ffmpeg")
        if not converter:
            raise ApiCliError(
                "Instagram exige une image JPEG. Installez sips ou ffmpeg pour préparer une copie."
            )
        command = (
            converter,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-frames:v",
            "1",
            "-q:v",
            str(FFMPEG_JPEG_QUALITY),
            "-pix_fmt",
            "yuvj420p",
            str(temporary_path),
        )

    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
    )
    if (
        completed.returncode != EXIT_OK
        or not temporary_path.is_file()
        or temporary_path.stat().st_size == 0
    ):
        temporary_path.unlink(missing_ok=True)
        detail = completed.stderr.strip() or "conversion sans fichier de sortie"
        raise ApiCliError(f"Impossible de préparer la copie JPEG Instagram : {detail}")
    os.replace(temporary_path, prepared_path)
    prepared_path.chmod(PREPARED_FILE_MODE)
    return prepared_path


def prepare_media_for_upload(platform: str, media: dict[str, Any], path: Path) -> Path:
    if media.get("kind") != IMAGE_MEDIA_KIND:
        return path
    if platform == TIKTOK_PLATFORM:
        return prepare_tiktok_photo(path)
    if platform == INSTAGRAM_PLATFORM:
        return prepare_instagram_photo(path)
    return path


def upload_file(project_id: str, path: Path) -> dict[str, Any]:
    base_url, token = configuration()
    parsed = urlparse(base_url)
    connection_type = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    connection = connection_type(parsed.hostname, parsed.port, timeout=HTTP_TIMEOUT_SECONDS, context=ssl.create_default_context()) \
        if parsed.scheme == "https" else connection_type(parsed.hostname, parsed.port, timeout=HTTP_TIMEOUT_SECONDS)
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    target = f"{parsed.path.rstrip('/')}/v1/media"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": content_type,
        "Content-Length": str(path.stat().st_size),
        "X-Project-Id": project_id,
        "X-Filename": path.name,
        "X-Content-Sha256": file_sha256(path),
        "User-Agent": USER_AGENT,
    }
    try:
        with path.open("rb") as handle:
            connection.request("POST", target, body=handle, headers=headers)
            response = connection.getresponse()
            raw = response.read().decode(UTF8)
        if response.status >= 400:
            raise ApiCliError(f"Téléversement refusé ({response.status}) : {raw}")
        return json.loads(raw)
    finally:
        connection.close()


def resolve_payload(project_id: str, post_id: str, delivery_id: str) -> tuple[Any, dict[str, Any], Path, dict[str, Any]]:
    queue_module = load_queue_module()
    registry = queue_module.load_json(REGISTRY_PATH)
    project, root, queue_path = queue_module.project_paths(registry, project_id)
    queue = queue_module.load_json(queue_path)
    issues = queue_module.validate_queue(registry, project, root, queue_path, queue)
    errors = [item for item in issues if item["level"] == "error"]
    if errors:
        raise ApiCliError(f"File invalide : {len(errors)} erreur(s). Lancez validate.")
    post = queue_module.find_post(queue, post_id)
    delivery = queue_module.find_delivery(post, delivery_id)
    if delivery.get("state") != "approved":
        raise ApiCliError("La diffusion doit être approuvée avant l’envoi à l’API.")
    return queue_module, queue, queue_path, {"post": post, "delivery": delivery}


def command_submit(args: argparse.Namespace) -> dict[str, Any]:
    queue_module, queue, queue_path, resolved = resolve_payload(args.project, args.post, args.delivery)
    post = resolved["post"]
    delivery = resolved["delivery"]
    uploaded = [
        upload_file(
            args.project,
            prepare_media_for_upload(
                delivery["platform"],
                item,
                (queue_path.parent / item["path"]).resolve(),
            ),
        )
        for item in post["media"]
    ]
    response = api_json(
        "POST",
        "/v1/publications",
        {
            "idempotency_key": f"{args.project}:{args.post}:{args.delivery}:{delivery['approved_at']}",
            "project_id": args.project,
            "post_id": args.post,
            "delivery_id": args.delivery,
            "account_id": delivery["account_ref"],
            "platform": delivery["platform"],
            "caption": delivery["caption"],
            "title": delivery.get("title") or post.get("title"),
            "alt_text": delivery.get("alt_text"),
            "publish_at": delivery["publish_at"],
            "settings": delivery.get("settings", {}),
            "media_ids": [item["id"] for item in uploaded],
        },
    )
    delivery["state"] = "scheduled"
    delivery["receipt"] = {
        "native_reference": f"api:{response['id']}",
        "verified_at": queue_module.iso_now(),
        "executor": "stellark-social-publisher",
    }
    queue_module.atomic_write_json(queue_path, queue)
    return {"scheduled": True, "publication_id": response["id"], "publish_at": response.get("publish_at")}


def command_connect(args: argparse.Namespace) -> dict[str, Any]:
    access_token = os.environ.get(PROVIDER_ACCESS_TOKEN_ENV, "")
    if not access_token:
        raise ApiCliError(f"Placez le jeton dans {PROVIDER_ACCESS_TOKEN_ENV}; ne le passez jamais en argument.")
    registry = json.loads(REGISTRY_PATH.read_text(encoding=UTF8))
    account = next((item for item in registry.get("accounts", []) if item.get("id") == args.account), None)
    if not account:
        raise ApiCliError(f"Compte inconnu : {args.account}")
    return api_json(
        "POST",
        "/v1/connections",
        {
            "account_id": account["id"],
            "project_id": account["project_id"],
            "platform": account["platform"],
            "connection_kind": account.get("connection_kind", "organic"),
            "publication_mode": account.get("publication_mode"),
            "provider_subject": args.provider_subject,
            "display_name": args.display_name or account["expected_identity"],
            "access_token": access_token,
            "refresh_token": os.environ.get(PROVIDER_REFRESH_TOKEN_ENV),
            "expires_at": args.expires_at,
            "refresh_expires_at": args.refresh_expires_at,
            "scopes": args.scopes,
        },
    )


def registered_account(account_ref: str) -> dict[str, Any]:
    registry = json.loads(REGISTRY_PATH.read_text(encoding=UTF8))
    account = next((item for item in registry.get("accounts", []) if item.get("id") == account_ref), None)
    if not account:
        raise ApiCliError(f"Compte inconnu : {account_ref}")
    return account


def sync_account_target(account: dict[str, Any], provider_subject_override: str | None = None) -> dict[str, Any]:
    provider_subject = (
        provider_subject_override
        or account.get("api_provider_subject")
    )
    return api_json(
        "PUT",
        f"/v1/account-targets/{account['id']}",
        {
            "project_id": account["project_id"],
            "platform": account["platform"],
            "connection_kind": account.get("connection_kind", "organic"),
            "publication_mode": account.get("publication_mode"),
            "provider_subject": provider_subject,
            "display_name": account["expected_identity"],
        },
    )


def command_sync_account(args: argparse.Namespace) -> dict[str, Any]:
    return sync_account_target(registered_account(args.account), args.provider_subject)


def command_oauth_start(args: argparse.Namespace) -> dict[str, Any]:
    account = registered_account(args.account)
    sync_account_target(account, args.provider_subject)
    payload: dict[str, Any] = {"account_id": account["id"]}
    if args.scopes:
        payload["scopes"] = args.scopes
    return api_json("POST", "/v1/oauth/start", payload)


def command_status(args: argparse.Namespace) -> dict[str, Any]:
    reference = args.publication
    if reference.startswith("api:"):
        reference = reference.removeprefix("api:")
    return api_json("GET", f"/v1/publications/{reference}")


def command_run_due(_: argparse.Namespace) -> dict[str, Any]:
    return api_json("POST", "/v1/run-due")


def project_plan(project_id: str, plan_value: str) -> tuple[Any, dict[str, Any], Path, Path, dict[str, Any]]:
    queue_module = load_queue_module()
    registry = queue_module.load_json(REGISTRY_PATH)
    _, root, _ = queue_module.project_paths(registry, project_id)
    requested = Path(plan_value).expanduser()
    plan_path = requested.resolve() if requested.is_absolute() else (root / requested).resolve()
    if not plan_path.is_relative_to(root):
        raise ApiCliError("Le plan publicitaire doit rester dans le projet sélectionné.")
    plan = queue_module.load_json(plan_path)
    if plan.get("schema_version") != AD_PLAN_SCHEMA_VERSION:
        raise ApiCliError(f"Version de plan publicitaire attendue : {AD_PLAN_SCHEMA_VERSION}.")
    if plan.get("project_id") != project_id:
        raise ApiCliError("Le plan publicitaire ne correspond pas au projet sélectionné.")
    return queue_module, registry, root, plan_path, plan


def find_advertisement(plan: dict[str, Any], advertisement_id: str) -> dict[str, Any]:
    advertisement = next(
        (item for item in plan.get("advertisements", []) if item.get("id") == advertisement_id),
        None,
    )
    if not isinstance(advertisement, dict):
        raise ApiCliError(f"Publicité inconnue : {advertisement_id}")
    return advertisement


def parse_advertisement_time(value: Any) -> str:
    if not isinstance(value, str):
        raise ApiCliError("La publicité doit avoir une date start_at ISO 8601.")
    normalized = value.removesuffix("Z") + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as error:
        raise ApiCliError(f"Date publicitaire invalide : {value}") from error
    if parsed.tzinfo is None:
        raise ApiCliError("La date publicitaire doit inclure un fuseau horaire.")
    return parsed.isoformat()


def contains_media_url_placeholder(value: Any) -> bool:
    if isinstance(value, list):
        return any(contains_media_url_placeholder(item) for item in value)
    if not isinstance(value, dict):
        return False
    if AD_MEDIA_URL_PLACEHOLDER_KEY in value:
        return True
    return any(contains_media_url_placeholder(item) for item in value.values())


def advertising_operations_require_media(operations: list[dict[str, Any]]) -> bool:
    return any(contains_media_url_placeholder(operation.get("body")) for operation in operations)


def validate_advertisement(
    advertisement: dict[str, Any],
    registry: dict[str, Any],
    project_id: str,
    root: Path,
    plan_path: Path,
) -> list[Path]:
    platform = advertisement.get("platform")
    provider = advertisement.get("provider")
    if platform not in AD_SUPPORTED_PLATFORMS:
        raise ApiCliError(f"Plateforme publicitaire invalide : {platform}")
    if provider not in AD_SUPPORTED_PROVIDERS:
        raise ApiCliError(f"Fournisseur publicitaire invalide : {provider}")
    if (provider == "meta" and platform == "tiktok") or (provider == "tiktok" and platform != "tiktok"):
        raise ApiCliError("La plateforme publicitaire ne correspond pas au fournisseur.")
    for field in ("id", "group_id", "account_ref", "advertiser_id"):
        if not isinstance(advertisement.get(field), str) or not advertisement[field].strip():
            raise ApiCliError(f"Champ publicitaire requis : {field}")
    account = next(
        (item for item in registry.get("accounts", []) if item.get("id") == advertisement["account_ref"]),
        None,
    )
    expected_account_platform = "facebook" if provider == "meta" else "tiktok"
    if (
        not isinstance(account, dict)
        or account.get("project_id") != project_id
        or account.get("platform") != expected_account_platform
        or account.get("connection_kind") != "advertising"
    ):
        raise ApiCliError("Le compte publicitaire ne correspond pas au projet ou au fournisseur.")
    registered_advertiser = str(account.get("api_provider_subject", "")).removeprefix("act_")
    requested_advertiser = advertisement["advertiser_id"].removeprefix("act_")
    if registered_advertiser and registered_advertiser != requested_advertiser:
        raise ApiCliError("L’identifiant annonceur ne correspond pas au compte publicitaire enregistré.")
    parse_advertisement_time(advertisement.get("start_at"))
    budget = advertisement.get("budget")
    if not isinstance(budget, dict):
        raise ApiCliError("Le budget publicitaire est requis.")
    if budget.get("type") not in AD_BUDGET_TYPES:
        raise ApiCliError("Le type de budget publicitaire doit être daily ou lifetime.")
    amount_minor = budget.get("amount_minor")
    if not isinstance(amount_minor, int) or isinstance(amount_minor, bool) or amount_minor <= 0:
        raise ApiCliError("Le budget amount_minor doit être un entier positif.")
    currency = budget.get("currency")
    if not isinstance(currency, str) or len(currency) != AD_CURRENCY_LENGTH or not currency.isalpha():
        raise ApiCliError("La devise publicitaire doit être un code ISO de trois lettres.")
    operations = advertisement.get("operations")
    if not isinstance(operations, list) or not operations:
        raise ApiCliError("Au moins une opération API publicitaire est requise.")
    operation_ids: set[str] = set()
    for operation in operations:
        if not isinstance(operation, dict):
            raise ApiCliError("Une opération publicitaire est invalide.")
        operation_id = operation.get("id")
        operation_type = operation.get("type")
        if not isinstance(operation_id, str) or not operation_id or operation_id in operation_ids:
            raise ApiCliError("Chaque opération publicitaire doit avoir un identifiant unique.")
        operation_ids.add(operation_id)
        if not isinstance(operation_type, str) or not operation_type.startswith(f"{provider}."):
            raise ApiCliError("Une opération publicitaire ne correspond pas au fournisseur.")
        if not isinstance(operation.get("body"), dict):
            raise ApiCliError("Le body d’une opération publicitaire doit être un objet JSON.")
    media = advertisement.get("media", [])
    if not isinstance(media, list):
        raise ApiCliError("Les médias publicitaires doivent former une liste.")
    if not media and advertising_operations_require_media(operations):
        raise ApiCliError(AD_MEDIA_REQUIRED_MESSAGE)
    paths: list[Path] = []
    for item in media:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise ApiCliError("Chaque média publicitaire doit avoir un chemin.")
        path = (plan_path.parent / item["path"]).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ApiCliError(f"Média publicitaire introuvable ou hors projet : {path}")
        paths.append(path)
    return paths


def command_ad_approve(args: argparse.Namespace) -> dict[str, Any]:
    if args.confirmed_by != AD_APPROVAL_CONFIRMATION:
        raise ApiCliError("L’approbation explicite de l’utilisateur est requise (--confirmed-by user).")
    queue_module, registry, root, plan_path, plan = project_plan(args.project, args.plan)
    advertisement = find_advertisement(plan, args.advertisement)
    validate_advertisement(advertisement, registry, args.project, root, plan_path)
    advertisement["state"] = AD_STATE_APPROVED
    advertisement["approved_at"] = queue_module.iso_now()
    advertisement["receipt"] = None
    queue_module.atomic_write_json(plan_path, plan)
    return {"approved": True, "advertisement": advertisement["id"], "platform": advertisement["platform"]}


def command_ad_validate(args: argparse.Namespace) -> dict[str, Any]:
    _, registry, root, plan_path, plan = project_plan(args.project, args.plan)
    items: list[dict[str, Any]] = []
    for advertisement in plan.get("advertisements", []):
        if not isinstance(advertisement, dict):
            raise ApiCliError("Une publicité du plan est invalide.")
        media_paths = validate_advertisement(advertisement, registry, args.project, root, plan_path)
        items.append(
            {
                "id": advertisement["id"],
                "group_id": advertisement["group_id"],
                "platform": advertisement["platform"],
                "provider": advertisement["provider"],
                "account_ref": advertisement["account_ref"],
                "advertiser_id": advertisement["advertiser_id"],
                "start_at": parse_advertisement_time(advertisement["start_at"]),
                "budget": advertisement["budget"],
                "state": advertisement.get("state", "draft"),
                "media": [str(path) for path in media_paths],
            }
        )
    return {"valid": True, "project": args.project, "plan": str(plan_path), "advertisements": items}


def command_ad_submit(args: argparse.Namespace) -> dict[str, Any]:
    queue_module, registry, root, plan_path, plan = project_plan(args.project, args.plan)
    advertisement = find_advertisement(plan, args.advertisement)
    media_paths = validate_advertisement(advertisement, registry, args.project, root, plan_path)
    if advertisement.get("state") != AD_STATE_APPROVED or not advertisement.get("approved_at"):
        raise ApiCliError("La publicité doit être approuvée avant l’envoi à l’API.")
    uploaded = [upload_file(args.project, path) for path in media_paths]
    budget = advertisement["budget"]
    response = api_json(
        "POST",
        "/v1/advertisements",
        {
            "idempotency_key": f"{args.project}:{advertisement['id']}:{advertisement['approved_at']}",
            "project_id": args.project,
            "campaign_id": advertisement["group_id"],
            "delivery_id": advertisement["id"],
            "connection_account_id": advertisement["account_ref"],
            "provider": advertisement["provider"],
            "placement": advertisement["platform"],
            "advertiser_id": advertisement["advertiser_id"],
            "budget_type": budget["type"],
            "budget_amount_minor": budget["amount_minor"],
            "currency": budget["currency"].upper(),
            "start_at": advertisement["start_at"],
            "operations": advertisement["operations"],
            "media_ids": [item["id"] for item in uploaded],
        },
    )
    advertisement["state"] = AD_STATE_SCHEDULED
    advertisement["receipt"] = {
        "native_reference": f"api:{response['id']}",
        "verified_at": queue_module.iso_now(),
        "executor": "stellark-social-publisher",
    }
    queue_module.atomic_write_json(plan_path, plan)
    return {"scheduled": True, "advertisement_id": response["id"], "start_at": response.get("start_at")}


def command_ad_status(args: argparse.Namespace) -> dict[str, Any]:
    reference = args.advertisement
    if reference.startswith("api:"):
        reference = reference.removeprefix("api:")
    return api_json("GET", f"/v1/advertisements/{reference}")


def capture_dispatch(identifier: str, platform: str, operation: Any) -> dict[str, Any]:
    try:
        return {"id": identifier, "platform": platform, "ok": True, "result": operation()}
    except Exception as error:
        return {"id": identifier, "platform": platform, "ok": False, "error": str(error)}


def command_publish(args: argparse.Namespace) -> dict[str, Any]:
    platforms = set(args.platform)
    if args.kind == "post":
        queue_module = load_queue_module()
        registry = queue_module.load_json(REGISTRY_PATH)
        _, _, queue_path = queue_module.project_paths(registry, args.project)
        post = queue_module.find_post(queue_module.load_json(queue_path), args.item)
        selected = [item for item in post.get("deliveries", []) if item.get("platform") in platforms]
        if not selected:
            raise ApiCliError("Aucune diffusion organique ne correspond aux plateformes demandées.")
        return {
            "kind": "post",
            "results": [
                capture_dispatch(
                    item["id"],
                    item["platform"],
                    lambda selected=item: command_submit(
                        argparse.Namespace(project=args.project, post=args.item, delivery=selected["id"]),
                    ),
                )
                for item in selected
            ],
        }
    if not args.plan:
        raise ApiCliError("--plan est requis pour publier une publicité.")
    _, registry, root, plan_path, plan = project_plan(args.project, args.plan)
    selected_ads = [
        item for item in plan.get("advertisements", [])
        if isinstance(item, dict)
        and item.get("group_id") == args.item
        and item.get("platform") in platforms
    ]
    if not selected_ads:
        raise ApiCliError("Aucune publicité ne correspond au groupe et aux plateformes demandés.")
    for advertisement in selected_ads:
        validate_advertisement(advertisement, registry, args.project, root, plan_path)
    return {
        "kind": "ad",
        "results": [
            capture_dispatch(
                item["id"],
                item["platform"],
                lambda selected=item: command_ad_submit(
                    argparse.Namespace(project=args.project, plan=args.plan, advertisement=selected["id"]),
                ),
            )
            for item in selected_ads
        ],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Pont API du social publisher cross-projet.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    submit = subparsers.add_parser("submit")
    submit.add_argument("project")
    submit.add_argument("post")
    submit.add_argument("delivery")
    connect = subparsers.add_parser("connect")
    connect.add_argument("account")
    connect.add_argument("provider_subject")
    connect.add_argument("--display-name")
    connect.add_argument("--expires-at")
    connect.add_argument("--refresh-expires-at")
    connect.add_argument("--scopes", default="")
    oauth = subparsers.add_parser("oauth-start")
    oauth.add_argument("account")
    oauth.add_argument("--provider-subject")
    oauth.add_argument("--scopes")
    sync_account = subparsers.add_parser("sync-account")
    sync_account.add_argument("account")
    sync_account.add_argument("--provider-subject")
    status = subparsers.add_parser("status")
    status.add_argument("publication")
    subparsers.add_parser("run-due")
    ad_approve = subparsers.add_parser("ad-approve")
    ad_approve.add_argument("project")
    ad_approve.add_argument("plan")
    ad_approve.add_argument("advertisement")
    ad_approve.add_argument("--confirmed-by", required=True)
    ad_validate = subparsers.add_parser("ad-validate")
    ad_validate.add_argument("project")
    ad_validate.add_argument("plan")
    ad_submit = subparsers.add_parser("ad-submit")
    ad_submit.add_argument("project")
    ad_submit.add_argument("plan")
    ad_submit.add_argument("advertisement")
    ad_status = subparsers.add_parser("ad-status")
    ad_status.add_argument("advertisement")
    publish = subparsers.add_parser("publish")
    publish.add_argument("project")
    publish.add_argument("item")
    publish.add_argument("--kind", choices=("post", "ad"), required=True)
    publish.add_argument(
        "--platform",
        action="append",
        choices=tuple(sorted(CONTENT_TARGET_PLATFORMS)),
        required=True,
    )
    publish.add_argument("--plan")
    return parser


COMMANDS = {
    "submit": command_submit,
    "connect": command_connect,
    "oauth-start": command_oauth_start,
    "sync-account": command_sync_account,
    "status": command_status,
    "run-due": command_run_due,
    "ad-approve": command_ad_approve,
    "ad-validate": command_ad_validate,
    "ad-submit": command_ad_submit,
    "ad-status": command_ad_status,
    "publish": command_publish,
}


def main() -> int:
    args = build_parser().parse_args()
    try:
        print(json.dumps(COMMANDS[args.command](args), ensure_ascii=False, indent=2))
        return EXIT_OK
    except ApiCliError as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
