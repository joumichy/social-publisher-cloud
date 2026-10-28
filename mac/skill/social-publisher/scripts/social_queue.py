#!/usr/bin/env python3
"""Cross-project queue manager for native social-network schedulers."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


SCHEMA_VERSION = 1
DEFAULT_REGISTRY_PATH = Path.home() / ".codex" / "social-publisher" / "registry.json"
REGISTRY_ENV_NAME = "SOCIAL_PUBLISHER_REGISTRY"
DEFAULT_QUEUE_PATH = Path("marketing/social-publisher/queue.json")
DEFAULT_TIMEZONE = "Europe/Zurich"
DEFAULT_BROWSER_NAME = "Chrome"
DEFAULT_BROWSER_PROFILE = "Ginoza"
DEFAULT_INDENT = 2
JSON_SUFFIX = "\n"
UTF8 = "utf-8"
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")
SUPPORTED_PLATFORMS = frozenset({"facebook", "instagram", "linkedin", "tiktok"})
AWAITING_CREATOR_STATE = "awaiting_creator"
SUPPORTED_STATES = frozenset({
    "draft", "approved", "scheduled", AWAITING_CREATOR_STATE, "published", "failed", "cancelled"
})
SUPPORTED_ACCOUNT_STATES = frozenset({"unconfigured", "needs_connection", "needs_verification", "ready", "verified"})
SUPPORTED_CONNECTION_KINDS = frozenset({"organic", "advertising"})
SUPPORTED_TIKTOK_PUBLICATION_MODES = frozenset({"creator_inbox_draft", "direct_publish"})
ORGANIC_CONNECTION_KIND = "organic"
ADVERTISING_CONNECTION_KIND = "advertising"
NATIVE_SCHEDULER_PROVIDER = "native"
SCHEDULER_PROVIDER_KEY = "scheduler_provider"
SCHEDULER_URL_KEY = "scheduler_url"
PLATFORM_KEY = "platform"
BROWSER_PROFILE_KEY = "browser_profile"
HTTPS_SCHEME = "https"
NATIVE_SCHEDULER_HOSTS_BY_ACCOUNT = {
    ("facebook", ORGANIC_CONNECTION_KIND): frozenset({"business.facebook.com"}),
    ("facebook", ADVERTISING_CONNECTION_KIND): frozenset({"business.facebook.com"}),
    ("instagram", ORGANIC_CONNECTION_KIND): frozenset({"business.facebook.com"}),
    ("linkedin", ORGANIC_CONNECTION_KIND): frozenset({"www.linkedin.com"}),
    ("tiktok", ORGANIC_CONNECTION_KIND): frozenset({"www.tiktok.com"}),
    ("tiktok", ADVERTISING_CONNECTION_KIND): frozenset({"ads.tiktok.com"}),
}
IMAGE_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".webp"})
VIDEO_EXTENSIONS = frozenset({".mp4", ".mov", ".m4v", ".webm"})
DOCUMENT_EXTENSIONS = frozenset({".pdf"})
MEDIA_KIND_EXTENSIONS = {
    "image": IMAGE_EXTENSIONS,
    "video": VIDEO_EXTENSIONS,
    "document": DOCUMENT_EXTENSIONS,
}
CONNECTED_ACCOUNT_STATES = frozenset({"ready", "verified"})
APPROVAL_CONFIRMATION = "user"
ISO_UTC_SUFFIX = "Z"
ISO_UTC_OFFSET = "+00:00"
FFPROBE_COMMAND = "ffprobe"
FFPROBE_ARGUMENTS = (
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,width,height,duration:format=duration",
    "-of",
    "json",
)
COMMAND_TIMEOUT_SECONDS = 30
MINIMUM_FUTURE_SECONDS = 1
EXIT_OK = 0
EXIT_INVALID = 1
EXIT_USAGE = 2
RECEIPT_VERIFIED_AT_KEY = "verified_at"
RECEIPT_NATIVE_REFERENCE_KEY = "native_reference"
NOW_KEYWORD = "now"


class SocialQueueError(Exception):
    """User-facing queue or registry error."""


def registry_path() -> Path:
    configured = os.environ.get(REGISTRY_ENV_NAME)
    return Path(configured).expanduser().resolve() if configured else DEFAULT_REGISTRY_PATH


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding=UTF8))
    except FileNotFoundError as exc:
        raise SocialQueueError(f"Fichier introuvable : {path}") from exc
    except json.JSONDecodeError as exc:
        raise SocialQueueError(f"JSON invalide dans {path} : {exc}") from exc
    if not isinstance(value, dict):
        raise SocialQueueError(f"La racine JSON doit être un objet : {path}")
    return value


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(value, ensure_ascii=False, indent=DEFAULT_INDENT) + JSON_SUFFIX
    with tempfile.NamedTemporaryFile(mode="w", encoding=UTF8, dir=path.parent, delete=False) as handle:
        handle.write(serialized)
        temporary_path = Path(handle.name)
    os.replace(temporary_path, path)


def parse_datetime(value: str) -> datetime:
    normalized = value.removesuffix(ISO_UTC_SUFFIX) + ISO_UTC_OFFSET if value.endswith(ISO_UTC_SUFFIX) else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise SocialQueueError(f"Date ISO 8601 invalide : {value}") from exc
    if parsed.tzinfo is None:
        raise SocialQueueError(f"La date doit inclure un fuseau horaire : {value}")
    return parsed


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat(timespec="seconds")


def find_project(registry: dict[str, Any], project_id: str) -> dict[str, Any]:
    for project in registry.get("projects", []):
        if project.get("id") == project_id:
            return project
    raise SocialQueueError(f"Projet non enregistré : {project_id}")


def find_account(registry: dict[str, Any], account_ref: str) -> dict[str, Any] | None:
    return next((account for account in registry.get("accounts", []) if account.get("id") == account_ref), None)


def project_paths(registry: dict[str, Any], project_id: str) -> tuple[dict[str, Any], Path, Path]:
    project = find_project(registry, project_id)
    root = Path(project["root"]).expanduser().resolve()
    queue_path = (root / project.get("queue_path", str(DEFAULT_QUEUE_PATH))).resolve()
    return project, root, queue_path


def find_post(queue: dict[str, Any], post_id: str) -> dict[str, Any]:
    for post in queue.get("posts", []):
        if post.get("id") == post_id:
            return post
    raise SocialQueueError(f"Publication inconnue : {post_id}")


def find_delivery(post: dict[str, Any], delivery_id: str) -> dict[str, Any]:
    for delivery in post.get("deliveries", []):
        if delivery.get("id") == delivery_id:
            return delivery
    raise SocialQueueError(f"Diffusion inconnue pour {post.get('id')} : {delivery_id}")


def issue(level: str, location: str, message: str) -> dict[str, str]:
    return {"level": level, "location": location, "message": message}


def is_identifier(value: Any) -> bool:
    return isinstance(value, str) and bool(ID_PATTERN.fullmatch(value))


def native_scheduler_url_issue(platform: str, connection_kind: str, scheduler_url: Any) -> str | None:
    if not isinstance(scheduler_url, str) or urlparse(scheduler_url).scheme != HTTPS_SCHEME:
        return "URL HTTPS requise"
    allowed_hosts = NATIVE_SCHEDULER_HOSTS_BY_ACCOUNT.get((platform, connection_kind))
    if allowed_hosts is None:
        return "Combinaison plateforme/type de connexion non prise en charge"
    if urlparse(scheduler_url).hostname not in allowed_hosts:
        return f"Domaine natif requis : {', '.join(sorted(allowed_hosts))}"
    return None


def validate_registry(registry: dict[str, Any]) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    if registry.get("schema_version") != SCHEMA_VERSION:
        issues.append(issue("error", "registry.schema_version", f"Version attendue : {SCHEMA_VERSION}"))
    project_ids: set[str] = set()
    for index, project in enumerate(registry.get("projects", [])):
        location = f"registry.projects[{index}]"
        project_id = project.get("id")
        if not is_identifier(project_id):
            issues.append(issue("error", f"{location}.id", "Identifiant kebab-case requis"))
        elif project_id in project_ids:
            issues.append(issue("error", f"{location}.id", "Identifiant dupliqué"))
        else:
            project_ids.add(project_id)
        root_value = project.get("root")
        if not isinstance(root_value, str) or not Path(root_value).expanduser().is_dir():
            issues.append(issue("error", f"{location}.root", "Dossier projet introuvable"))
    account_ids: set[str] = set()
    for index, account in enumerate(registry.get("accounts", [])):
        location = f"registry.accounts[{index}]"
        account_id = account.get("id")
        if not is_identifier(account_id):
            issues.append(issue("error", f"{location}.id", "Identifiant kebab-case requis"))
        elif account_id in account_ids:
            issues.append(issue("error", f"{location}.id", "Identifiant dupliqué"))
        else:
            account_ids.add(account_id)
        if account.get("project_id") not in project_ids:
            issues.append(issue("error", f"{location}.project_id", "Projet de compte inconnu"))
        platform = account.get(PLATFORM_KEY)
        if platform not in SUPPORTED_PLATFORMS:
            issues.append(issue("error", f"{location}.platform", "Plateforme non prise en charge"))
        if account.get("connection_state") not in SUPPORTED_ACCOUNT_STATES:
            issues.append(issue("error", f"{location}.connection_state", "État de connexion invalide"))
        connection_kind = account.get("connection_kind", ORGANIC_CONNECTION_KIND)
        if connection_kind not in SUPPORTED_CONNECTION_KINDS:
            issues.append(issue("error", f"{location}.connection_kind", "Type de connexion invalide"))
        if platform == "tiktok" and connection_kind == ORGANIC_CONNECTION_KIND:
            publication_mode = account.get("publication_mode")
            if account.get("connection_state") != "unconfigured" and publication_mode not in SUPPORTED_TIKTOK_PUBLICATION_MODES:
                issues.append(issue("error", f"{location}.publication_mode", "Mode de publication TikTok requis"))
        if connection_kind == ADVERTISING_CONNECTION_KIND:
            if platform not in {"facebook", "tiktok"}:
                issues.append(issue("error", f"{location}.platform", "Publicité API prise en charge sur Meta et TikTok"))
            provider_subject = account.get("api_provider_subject")
            if not isinstance(provider_subject, str) or not provider_subject.strip():
                issues.append(issue("error", f"{location}.api_provider_subject", "Identifiant annonceur requis"))
        browser_profile = account.get(BROWSER_PROFILE_KEY)
        if browser_profile is not None and (not isinstance(browser_profile, str) or not browser_profile.strip()):
            issues.append(issue("error", f"{location}.{BROWSER_PROFILE_KEY}", "Nom de profil navigateur invalide"))
        horizon = account.get("native_horizon_days")
        if not isinstance(horizon, int) or horizon <= 0:
            issues.append(issue("error", f"{location}.native_horizon_days", "Entier positif requis"))
        scheduler_provider = account.get(SCHEDULER_PROVIDER_KEY)
        if scheduler_provider != NATIVE_SCHEDULER_PROVIDER:
            issues.append(issue("error", f"{location}.{SCHEDULER_PROVIDER_KEY}", "Scheduler natif requis"))
        scheduler_url = account.get(SCHEDULER_URL_KEY)
        if platform in SUPPORTED_PLATFORMS:
            scheduler_issue = native_scheduler_url_issue(platform, connection_kind, scheduler_url)
            if scheduler_issue:
                issues.append(issue("error", f"{location}.scheduler_url", scheduler_issue))
    return issues


def validate_queue(
    registry: dict[str, Any], project: dict[str, Any], project_root: Path, queue_path: Path, queue: dict[str, Any]
) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    if queue.get("schema_version") != SCHEMA_VERSION:
        issues.append(issue("error", "queue.schema_version", f"Version attendue : {SCHEMA_VERSION}"))
    if queue.get("project_id") != project.get("id"):
        issues.append(issue("error", "queue.project_id", "Le projet ne correspond pas au registre"))
    timezone_name = queue.get("timezone")
    if not isinstance(timezone_name, str):
        issues.append(issue("error", "queue.timezone", "Fuseau IANA invalide"))
    else:
        try:
            ZoneInfo(timezone_name)
        except ZoneInfoNotFoundError:
            issues.append(issue("error", "queue.timezone", "Fuseau IANA invalide"))
    post_ids: set[str] = set()
    for post_index, post in enumerate(queue.get("posts", [])):
        post_location = f"queue.posts[{post_index}]"
        post_id = post.get("id")
        if not is_identifier(post_id):
            issues.append(issue("error", f"{post_location}.id", "Identifiant kebab-case requis"))
        elif post_id in post_ids:
            issues.append(issue("error", f"{post_location}.id", "Identifiant dupliqué"))
        else:
            post_ids.add(post_id)
        media_items = post.get("media")
        if not isinstance(media_items, list) or not media_items:
            issues.append(issue("error", f"{post_location}.media", "Au moins un média est requis"))
        else:
            for media_index, media in enumerate(media_items):
                media_location = f"{post_location}.media[{media_index}]"
                media_path_value = media.get("path") if isinstance(media, dict) else None
                media_kind = media.get("kind") if isinstance(media, dict) else None
                if not isinstance(media_path_value, str):
                    issues.append(issue("error", f"{media_location}.path", "Chemin requis"))
                    continue
                resolved_media = (queue_path.parent / media_path_value).resolve()
                if not resolved_media.is_relative_to(project_root):
                    issues.append(issue("error", f"{media_location}.path", "Le média sort du projet"))
                elif not resolved_media.is_file():
                    issues.append(issue("error", f"{media_location}.path", f"Fichier introuvable : {resolved_media}"))
                allowed_extensions = MEDIA_KIND_EXTENSIONS.get(media_kind)
                if allowed_extensions is None:
                    issues.append(issue("error", f"{media_location}.kind", "Type de média invalide"))
                elif resolved_media.suffix.lower() not in allowed_extensions:
                    issues.append(issue("error", f"{media_location}.kind", "Extension incompatible avec le type"))
        delivery_ids: set[str] = set()
        deliveries = post.get("deliveries")
        if not isinstance(deliveries, list) or not deliveries:
            issues.append(issue("error", f"{post_location}.deliveries", "Au moins une diffusion est requise"))
            continue
        for delivery_index, delivery in enumerate(deliveries):
            delivery_location = f"{post_location}.deliveries[{delivery_index}]"
            delivery_id = delivery.get("id")
            if not is_identifier(delivery_id):
                issues.append(issue("error", f"{delivery_location}.id", "Identifiant kebab-case requis"))
            elif delivery_id in delivery_ids:
                issues.append(issue("error", f"{delivery_location}.id", "Identifiant dupliqué dans la publication"))
            else:
                delivery_ids.add(delivery_id)
            platform = delivery.get("platform")
            if platform not in SUPPORTED_PLATFORMS:
                issues.append(issue("error", f"{delivery_location}.platform", "Plateforme non prise en charge"))
            account_ref = delivery.get("account_ref")
            account = find_account(registry, account_ref) if isinstance(account_ref, str) else None
            if account is None:
                issues.append(issue("error", f"{delivery_location}.account_ref", "Compte inconnu"))
            elif account.get("project_id") != project.get("id") or account.get("platform") != platform:
                issues.append(issue("error", f"{delivery_location}.account_ref", "Compte incompatible avec le projet ou la plateforme"))
            caption = delivery.get("caption")
            if not isinstance(caption, str) or not caption.strip():
                issues.append(issue("error", f"{delivery_location}.caption", "Légende non vide requise"))
            state = delivery.get("state")
            if state not in SUPPORTED_STATES:
                issues.append(issue("error", f"{delivery_location}.state", "État invalide"))
            publish_at = delivery.get("publish_at")
            if state != "draft" and publish_at is None:
                issues.append(issue("error", f"{delivery_location}.publish_at", "Date requise hors brouillon"))
            elif publish_at is not None:
                try:
                    parse_datetime(publish_at)
                except SocialQueueError as exc:
                    issues.append(issue("error", f"{delivery_location}.publish_at", str(exc)))
            receipt = delivery.get("receipt")
            if state in {"scheduled", AWAITING_CREATOR_STATE, "published"}:
                if not isinstance(receipt, dict):
                    issues.append(issue("error", f"{delivery_location}.receipt", "Reçu natif requis"))
                elif not receipt.get(RECEIPT_VERIFIED_AT_KEY) or not receipt.get(RECEIPT_NATIVE_REFERENCE_KEY):
                    issues.append(issue("error", f"{delivery_location}.receipt", "Référence native et date de vérification requises"))
    return issues


def media_probe(path: Path, media_kind: str) -> dict[str, Any]:
    if media_kind == "document":
        return {"path": str(path), "probe": "not_applicable", "size_bytes": path.stat().st_size}
    if shutil.which(FFPROBE_COMMAND) is None:
        return {"path": str(path), "probe": "unavailable"}
    completed = subprocess.run(
        (FFPROBE_COMMAND, *FFPROBE_ARGUMENTS, str(path)),
        check=False,
        capture_output=True,
        text=True,
        timeout=COMMAND_TIMEOUT_SECONDS,
    )
    if completed.returncode != EXIT_OK:
        return {"path": str(path), "probe": "failed", "detail": completed.stderr.strip()}
    result = json.loads(completed.stdout)
    streams = result.get("streams", [])
    first_stream = streams[0] if streams else {}
    format_metadata = result.get("format", {})
    return {
        "path": str(path),
        "probe": "ok",
        "metadata": {
            "kind": media_kind,
            "width": first_stream.get("width"),
            "height": first_stream.get("height"),
            "duration_seconds": first_stream.get("duration") or format_metadata.get("duration"),
            "size_bytes": path.stat().st_size,
        },
    }


def plan_delivery(account: dict[str, Any] | None, delivery: dict[str, Any], now: datetime) -> str:
    state = delivery.get("state")
    if state != "approved":
        return str(state)
    if account is None or account.get("connection_state") not in CONNECTED_ACCOUNT_STATES:
        return "account_not_ready"
    publish_at_value = delivery.get("publish_at")
    if not isinstance(publish_at_value, str):
        return "missing_publish_at"
    publish_at = parse_datetime(publish_at_value).astimezone(timezone.utc)
    if publish_at <= now:
        return "overdue"
    horizon = timedelta(days=account["native_horizon_days"])
    return "ready_to_schedule" if publish_at <= now + horizon else "outside_native_window"


def command_projects(registry: dict[str, Any], _: argparse.Namespace) -> dict[str, Any]:
    return {"projects": registry.get("projects", []), "accounts": registry.get("accounts", [])}


def command_validate(registry: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    registry_issues = validate_registry(registry)
    project, root, queue_path = project_paths(registry, args.project)
    queue = load_json(queue_path)
    queue_issues = validate_queue(registry, project, root, queue_path, queue)
    issues = [*registry_issues, *queue_issues]
    return {
        "valid": not any(item["level"] == "error" for item in issues),
        "project": args.project,
        "queue": str(queue_path),
        "issues": issues,
    }


def command_plan(registry: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    project, root, queue_path = project_paths(registry, args.project)
    queue = load_json(queue_path)
    issues = validate_queue(registry, project, root, queue_path, queue)
    errors = [item for item in issues if item["level"] == "error"]
    if errors:
        raise SocialQueueError(f"File invalide : {len(errors)} erreur(s). Lancez validate.")
    now = parse_datetime(args.now).astimezone(timezone.utc) if args.now else utc_now()
    items: list[dict[str, Any]] = []
    for post in queue.get("posts", []):
        for delivery in post.get("deliveries", []):
            account = find_account(registry, delivery.get("account_ref"))
            items.append(
                {
                    "post_id": post["id"],
                    "title": post.get("title"),
                    "delivery_id": delivery["id"],
                    "platform": delivery["platform"],
                    "account_ref": delivery["account_ref"],
                    "publish_at": delivery.get("publish_at"),
                    "state": delivery["state"],
                    "action": plan_delivery(account, delivery, now),
                }
            )
    return {"project": args.project, "evaluated_at": now.isoformat(timespec="seconds"), "items": items}


def command_payload(registry: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    project, root, queue_path = project_paths(registry, args.project)
    queue = load_json(queue_path)
    issues = validate_queue(registry, project, root, queue_path, queue)
    errors = [item for item in issues if item["level"] == "error"]
    if errors:
        raise SocialQueueError(f"File invalide : {len(errors)} erreur(s). Lancez validate.")
    post = find_post(queue, args.post)
    delivery = find_delivery(post, args.delivery)
    account = find_account(registry, delivery["account_ref"])
    media = []
    for item in post["media"]:
        absolute_path = (queue_path.parent / item["path"]).resolve()
        media.append(
            {
                **item,
                "absolute_path": str(absolute_path),
                "inspection": media_probe(absolute_path, item["kind"]),
            }
        )
    return {
        "project": project,
        "post": {"id": post["id"], "title": post.get("title")},
        "delivery": delivery,
        "account": account,
        "media": media,
    }


def command_set_time(registry: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    _, _, queue_path = project_paths(registry, args.project)
    queue = load_json(queue_path)
    delivery = find_delivery(find_post(queue, args.post), args.delivery)
    parsed = parse_datetime(args.publish_at)
    delivery["publish_at"] = parsed.isoformat(timespec="minutes")
    if delivery.get("state") not in {"scheduled", "published"}:
        delivery["state"] = "draft"
        delivery["receipt"] = None
    atomic_write_json(queue_path, queue)
    return {"updated": True, "publish_at": delivery["publish_at"], "state": delivery["state"]}


def command_approve(registry: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    if args.confirmed_by != APPROVAL_CONFIRMATION:
        raise SocialQueueError("L’approbation explicite de l’utilisateur est requise (--confirmed-by user).")
    _, _, queue_path = project_paths(registry, args.project)
    queue = load_json(queue_path)
    delivery = find_delivery(find_post(queue, args.post), args.delivery)
    if delivery.get("publish_at") is None:
        raise SocialQueueError("Définissez publish_at avant l’approbation.")
    delivery["state"] = "approved"
    delivery["approved_at"] = iso_now()
    delivery["receipt"] = None
    atomic_write_json(queue_path, queue)
    return {"approved": True, "post": args.post, "delivery": args.delivery}


def command_mark_scheduled(registry: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    _, _, queue_path = project_paths(registry, args.project)
    queue = load_json(queue_path)
    delivery = find_delivery(find_post(queue, args.post), args.delivery)
    if delivery.get("state") != "approved":
        raise SocialQueueError("Seule une diffusion approuvée peut devenir programmée.")
    delivery["state"] = "scheduled"
    delivery["receipt"] = {
        RECEIPT_NATIVE_REFERENCE_KEY: args.native_reference,
        RECEIPT_VERIFIED_AT_KEY: iso_now(),
    }
    atomic_write_json(queue_path, queue)
    return {"scheduled": True, "post": args.post, "delivery": args.delivery, "receipt": delivery["receipt"]}


def command_mark_published(registry: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    _, _, queue_path = project_paths(registry, args.project)
    queue = load_json(queue_path)
    delivery = find_delivery(find_post(queue, args.post), args.delivery)
    if delivery.get("state") not in {"scheduled", AWAITING_CREATOR_STATE}:
        raise SocialQueueError("Seule une diffusion programmée ou en attente du créateur peut devenir publiée.")
    receipt = delivery.get("receipt")
    if not isinstance(receipt, dict):
        raise SocialQueueError("Le reçu de programmation est absent.")
    delivery["state"] = "published"
    delivery["published_verified_at"] = iso_now()
    if args.native_reference:
        receipt[RECEIPT_NATIVE_REFERENCE_KEY] = args.native_reference
    atomic_write_json(queue_path, queue)
    return {"published": True, "post": args.post, "delivery": args.delivery, "receipt": receipt}


def command_register_project(registry: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    if not is_identifier(args.project):
        raise SocialQueueError("L’identifiant projet doit être en kebab-case.")
    if any(project.get("id") == args.project for project in registry.get("projects", [])):
        raise SocialQueueError(f"Projet déjà enregistré : {args.project}")
    root = Path(args.root).expanduser().resolve()
    if not root.is_dir():
        raise SocialQueueError(f"Dossier projet introuvable : {root}")
    project = {"id": args.project, "brand": args.brand, "root": str(root), "queue_path": args.queue_path}
    registry.setdefault("projects", []).append(project)
    atomic_write_json(registry_path(), registry)
    queue_path = (root / args.queue_path).resolve()
    if not queue_path.exists():
        atomic_write_json(
            queue_path,
            {
                "schema_version": SCHEMA_VERSION,
                "project_id": args.project,
                "brand": args.brand,
                "timezone": args.timezone,
                "posts": [],
            },
        )
    return {"registered": True, "project": project, "queue": str(queue_path)}


def command_register_account(registry: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    find_project(registry, args.project)
    if not is_identifier(args.account):
        raise SocialQueueError("L’identifiant compte doit être en kebab-case.")
    if args.platform not in SUPPORTED_PLATFORMS:
        raise SocialQueueError(f"Plateforme non prise en charge : {args.platform}")
    if args.connection_kind == ADVERTISING_CONNECTION_KIND:
        if args.platform not in {"facebook", "tiktok"}:
            raise SocialQueueError("Les connexions publicitaires API utilisent Meta/Facebook ou TikTok.")
        if not args.api_provider_subject:
            raise SocialQueueError("L’identifiant annonceur est requis pour une connexion publicitaire.")
    if args.platform == "tiktok" and args.connection_kind == ORGANIC_CONNECTION_KIND and not args.publication_mode:
        raise SocialQueueError("Le mode de publication TikTok est requis.")
    if find_account(registry, args.account) is not None:
        raise SocialQueueError(f"Compte déjà enregistré : {args.account}")
    scheduler_issue = native_scheduler_url_issue(args.platform, args.connection_kind, args.scheduler_url)
    if scheduler_issue:
        raise SocialQueueError(scheduler_issue)
    account = {
        "id": args.account,
        "project_id": args.project,
        "platform": args.platform,
        "connection_kind": args.connection_kind,
        "publication_mode": args.publication_mode,
        "expected_identity": args.identity,
        "connection_state": "unconfigured",
        "native_horizon_days": args.horizon,
        SCHEDULER_PROVIDER_KEY: NATIVE_SCHEDULER_PROVIDER,
        SCHEDULER_URL_KEY: args.scheduler_url,
    }
    if args.api_provider_subject:
        account["api_provider_subject"] = args.api_provider_subject
    if args.connection_kind == ADVERTISING_CONNECTION_KIND:
        account["execution_provider"] = "api"
        account["api_connection_state"] = "needs_connection"
    if args.browser_profile:
        account[BROWSER_PROFILE_KEY] = args.browser_profile
    registry.setdefault("accounts", []).append(account)
    atomic_write_json(registry_path(), registry)
    return {"registered": True, "account": account}


def command_set_account_state(registry: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    account = find_account(registry, args.account)
    if account is None:
        raise SocialQueueError(f"Compte inconnu : {args.account}")
    if args.state not in SUPPORTED_ACCOUNT_STATES:
        raise SocialQueueError(f"État de compte invalide : {args.state}")
    if args.state in CONNECTED_ACCOUNT_STATES:
        if not args.observed_identity:
            raise SocialQueueError("L’identité observée dans l’interface est requise pour valider un compte.")
        expected_identity = str(account.get("expected_identity", ""))
        if args.observed_identity.casefold() != expected_identity.casefold():
            raise SocialQueueError(
                f"Identité inattendue : {args.observed_identity}. Identité attendue : {expected_identity}."
            )
        account["observed_identity"] = args.observed_identity
        account["verified_at"] = iso_now()
    else:
        account.pop("observed_identity", None)
        account.pop("verified_at", None)
    account["connection_state"] = args.state
    atomic_write_json(registry_path(), registry)
    return {"updated": True, "account": account}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Pilote local cross-projet pour les schedulers sociaux natifs.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("projects", help="Lister les projets et comptes enregistrés.")

    validate_parser = subparsers.add_parser("validate", help="Valider une file projet et ses médias.")
    validate_parser.add_argument("project")

    plan_parser = subparsers.add_parser("plan", help="Afficher les diffusions prêtes à programmer.")
    plan_parser.add_argument("project")
    plan_parser.add_argument("--now", help="Date ISO utilisée pour une simulation.")

    payload_parser = subparsers.add_parser("payload", help="Préparer le paquet d’une diffusion.")
    payload_parser.add_argument("project")
    payload_parser.add_argument("post")
    payload_parser.add_argument("delivery")

    time_parser = subparsers.add_parser("set-time", help="Définir la date d’une diffusion.")
    time_parser.add_argument("project")
    time_parser.add_argument("post")
    time_parser.add_argument("delivery")
    time_parser.add_argument("publish_at")

    approve_parser = subparsers.add_parser("approve", help="Approuver explicitement une diffusion.")
    approve_parser.add_argument("project")
    approve_parser.add_argument("post")
    approve_parser.add_argument("delivery")
    approve_parser.add_argument("--confirmed-by", required=True)

    scheduled_parser = subparsers.add_parser("mark-scheduled", help="Enregistrer la preuve du scheduler natif.")
    scheduled_parser.add_argument("project")
    scheduled_parser.add_argument("post")
    scheduled_parser.add_argument("delivery")
    scheduled_parser.add_argument("--native-reference", required=True)

    published_parser = subparsers.add_parser("mark-published", help="Confirmer qu’une diffusion est visible en ligne.")
    published_parser.add_argument("project")
    published_parser.add_argument("post")
    published_parser.add_argument("delivery")
    published_parser.add_argument("--native-reference")

    project_parser = subparsers.add_parser("register-project", help="Enregistrer un nouveau projet.")
    project_parser.add_argument("project")
    project_parser.add_argument("root")
    project_parser.add_argument("--brand", required=True)
    project_parser.add_argument("--queue-path", default=str(DEFAULT_QUEUE_PATH))
    project_parser.add_argument("--timezone", default=DEFAULT_TIMEZONE)

    account_parser = subparsers.add_parser("register-account", help="Enregistrer un compte social sans secret.")
    account_parser.add_argument("project")
    account_parser.add_argument("account")
    account_parser.add_argument("platform", choices=sorted(SUPPORTED_PLATFORMS))
    account_parser.add_argument("--identity", required=True)
    account_parser.add_argument("--horizon", type=int, required=True)
    account_parser.add_argument("--scheduler-url", required=True)
    account_parser.add_argument("--browser-profile")
    account_parser.add_argument(
        "--connection-kind",
        choices=sorted(SUPPORTED_CONNECTION_KINDS),
        default=ORGANIC_CONNECTION_KIND,
    )
    account_parser.add_argument("--api-provider-subject")
    account_parser.add_argument("--publication-mode", choices=sorted(SUPPORTED_TIKTOK_PUBLICATION_MODES))

    account_state_parser = subparsers.add_parser("set-account-state", help="Consigner l’état vérifié d’un compte.")
    account_state_parser.add_argument("account")
    account_state_parser.add_argument("state", choices=sorted(SUPPORTED_ACCOUNT_STATES))
    account_state_parser.add_argument("--observed-identity")

    return parser


COMMANDS = {
    "projects": command_projects,
    "validate": command_validate,
    "plan": command_plan,
    "payload": command_payload,
    "set-time": command_set_time,
    "approve": command_approve,
    "mark-scheduled": command_mark_scheduled,
    "mark-published": command_mark_published,
    "register-project": command_register_project,
    "register-account": command_register_account,
    "set-account-state": command_set_account_state,
}


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        registry = load_json(registry_path())
        result = COMMANDS[args.command](registry, args)
        print(json.dumps(result, ensure_ascii=False, indent=DEFAULT_INDENT))
        if args.command == "validate" and not result["valid"]:
            return EXIT_INVALID
        return EXIT_OK
    except SocialQueueError as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return EXIT_USAGE


if __name__ == "__main__":
    raise SystemExit(main())
